// app/api/collections/keyword-audit/[slug]/route.ts
//
// GET   detail: research, recommendation, current row, live Shopify SEO fields
// PATCH { recommendation?, reviewed?, notes? }   save edits to the recommendation
// POST  { action: "recommend" }                   generate a recommendation with the app's Anthropic key
//       { action: "fetch-ideas", seed: string }      pull Ahrefs matching-terms for a seed with the app's AHREFS_API_KEY
//                                                     and merge them into research.candidates (about 33 units a row, 120 rows)
//       { action: "validate-facts" }                check title/meta against the collection's live brands and prices; repair; re-apply row
//       { action: "fix-lengths" }                  shorten title (>60) and meta (>158) in place; re-applies to the row if it was applied
//       { action: "apply", toRow?: true, toShopify?: boolean }
//           toRow: write primary_keyword, secondary_keywords, title_tag, meta_description to ppw_collections
//           toShopify: write title_tag / description_tag metafields on the live collection
import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ensureCollectionColumns } from "@/lib/ensureCollectionColumns";
import { brandsWithDemand, enforceLengths, ensureKeywordResearchTable, generateRecommendation, isBrandLedHub, rewriteMeta, suggestMustTerms, type Recommendation, type Research } from "@/lib/keyword-audit";
import { readCollectionSeo, resolveCollectionId, updateCollectionBody, upsertCollectionSeoField } from "@/lib/shopify/collection-seo";
import { collectionFacts, factsBlock, findFactIssues, primaryMissing, reinstatePrimary, repairFacts } from "@/lib/keyword-audit-facts";
import { draftKeywordContent, keywordCoverage } from "@/lib/keyword-content";
import { stripPricesFromHtml } from "@/lib/keyword-content-prices";
import { fetchAdminProducts } from "@/lib/shopify/products-admin";
import { computeSeoGrade } from "@/lib/seoGrade";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

/** Live collection body plus SEO fields, for the content phase. */
async function loadLiveCollection(handle: string): Promise<{ id: number; title: string; body_html: string; seo_title: string; seo_description: string } | null> {
  const token = await getShopifyAccessToken();
  const get = async (path: string) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/2024-10/${path}`, { headers: { "X-Shopify-Access-Token": token } });
      if (res.ok) return res.json();
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after") || 2) * 1000)); continue; }
      return null;
    }
    return null;
  };
  let c: any = null;
  for (const type of ["custom", "smart"] as const) {
    const d = await get(`${type}_collections.json?handle=${encodeURIComponent(handle)}&limit=1`);
    const hit = d?.[`${type}_collections`]?.find((x: any) => x.handle === handle);
    if (hit) { c = hit; break; }
  }
  if (!c) return null;
  const mf = await get(`collections/${c.id}/metafields.json?namespace=global&limit=50`);
  const fields: Array<{ key: string; value: string }> = mf?.metafields || [];
  return {
    id: c.id, title: c.title || "", body_html: c.body_html || "",
    seo_title: fields.find((m) => m.key === "title_tag")?.value || c.title || "",
    seo_description: fields.find((m) => m.key === "description_tag")?.value || "",
  };
}

async function storeVendors(sql: any): Promise<string[]> {
  try {
    const rows = (await sql`SELECT DISTINCT vendor FROM products WHERE vendor IS NOT NULL AND vendor <> ''`) as Array<{ vendor: string }>;
    return rows.map((r) => r.vendor);
  } catch { return []; }
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ slug: string }> };

async function load(sql: any, slug: string) {
  const rows = (await sql`SELECT * FROM collection_keyword_research WHERE slug = ${slug}`) as Array<Record<string, any>>;
  return rows[0] || null;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { slug } = await params;
    const sql = getSQL();
    await ensureCollectionColumns(sql);
    await ensureKeywordResearchTable(sql);
    const r = await load(sql, slug);
    if (!r) return NextResponse.json({ error: "No research for this collection" }, { status: 404 });
    const col = ((await sql`SELECT slug, category, primary_keyword, secondary_keywords, title_tag, meta_description, product_count, notes, shopify_collection_id FROM ppw_collections WHERE slug = ${slug}`) as Array<Record<string, any>>)[0] || null;
    let shopify: { id: number; title: string; title_tag: string | null; description_tag: string | null } | null = null;
    try {
      const live = await resolveCollectionId(slug);
      if (live) shopify = { id: live.id, title: live.title, ...(await readCollectionSeo(live.id)) };
    } catch { /* Shopify optional for the read */ }
    return NextResponse.json({ ...r, collection: col, shopify });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "read failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { slug } = await params;
    const body = (await req.json()) as { recommendation?: Recommendation; reviewed?: boolean; keep_title?: boolean; notes?: string | null; must_terms?: string[] };
    const sql = getSQL();
    await ensureKeywordResearchTable(sql);
    if (body.recommendation !== undefined) await sql`UPDATE collection_keyword_research SET recommendation = ${JSON.stringify(body.recommendation)}::jsonb WHERE slug = ${slug}`;
    if (body.reviewed !== undefined) await sql`UPDATE collection_keyword_research SET reviewed = ${body.reviewed} WHERE slug = ${slug}`;
    if (body.keep_title !== undefined) await sql`UPDATE collection_keyword_research SET keep_title = ${!!body.keep_title} WHERE slug = ${slug}`;
    if (body.must_terms !== undefined) await sql`UPDATE collection_keyword_research SET must_terms = ${JSON.stringify((body.must_terms || []).map((t) => String(t).trim()).filter(Boolean))}::jsonb WHERE slug = ${slug}`;
    if (body.notes !== undefined) await sql`UPDATE collection_keyword_research SET notes = ${body.notes} WHERE slug = ${slug}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "save failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { slug } = await params;
    const body = (await req.json()) as { action: "recommend" | "apply" | "fetch-ideas" | "fix-lengths" | "validate-facts" | "revert-shopify" | "fix-primary" | "rewrite-meta" | "content-draft" | "coverage" | "snapshot-body" | "mark-content-published" | "strip-prices" | "suggest-terms"; mode?: "new" | "all"; toRow?: boolean; toShopify?: boolean; seed?: string };
    const sql = getSQL();
    await ensureCollectionColumns(sql);
    await ensureKeywordResearchTable(sql);
    const r = await load(sql, slug);
    if (!r) return NextResponse.json({ error: "No research for this collection" }, { status: 404 });
    const col = ((await sql`SELECT category, product_count, notes FROM ppw_collections WHERE slug = ${slug}`) as Array<Record<string, any>>)[0] || null;

    if (body.action === "fetch-ideas") {
      const seed = (body.seed || "").trim();
      if (!seed) return NextResponse.json({ error: "seed is required" }, { status: 400 });
      const key = process.env.AHREFS_API_KEY;
      if (!key) return NextResponse.json({ error: "AHREFS_API_KEY not configured" }, { status: 400 });
      const qs = new URLSearchParams({
        keywords: seed, country: "us", match_mode: "terms", limit: "120", order_by: "volume:desc",
        select: "keyword,volume,difficulty,cpc,parent_topic,intents",
        where: JSON.stringify({ field: "volume", is: ["gte", 40] }),
      }).toString();
      const res = await fetch(`https://api.ahrefs.com/v3/keywords-explorer/matching-terms?${qs}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
      const text = await res.text();
      if (!res.ok) return NextResponse.json({ error: `Ahrefs ${res.status}: ${text.slice(0, 300)}` }, { status: 502 });
      const data = JSON.parse(text) as { keywords?: Array<Record<string, any>> };
      const fresh = (data.keywords || []).map((k) => {
        const i = (k.intents || {}) as Record<string, boolean>;
        return { kw: String(k.keyword), vol: k.volume ?? null, kd: k.difficulty ?? null, cpc: Math.round((k.cpc || 0)) / 100, intent: ["commercial", "transactional", "informational", "navigational", "branded"].filter((n) => i[n]), parent: k.parent_topic ?? null, seed };
      });
      const research = r.research as Research;
      const seen = new Set(research.candidates.map((c) => c.kw));
      const merged = [...research.candidates, ...fresh.filter((c) => !seen.has(c.kw))].sort((a, b) => (b.vol || 0) - (a.vol || 0));
      const next = { ...research, candidates: merged, seeds_fetched: [...(((research as any).seeds_fetched as string[]) || []), seed] };
      await sql`UPDATE collection_keyword_research SET research = ${JSON.stringify(next)}::jsonb WHERE slug = ${slug}`;
      return NextResponse.json({ ok: true, added: fresh.filter((c) => !seen.has(c.kw)).length, total: merged.length });
    }

    if (body.action === "fix-lengths") {
      const rec = r.recommendation as Recommendation | null;
      if (!rec) return NextResponse.json({ error: "No recommendation" }, { status: 400 });
      const { rec: next, changed } = await enforceLengths({ ...rec });
      if (changed.length) {
        await sql`UPDATE collection_keyword_research SET recommendation = ${JSON.stringify(next)}::jsonb WHERE slug = ${slug}`;
        if (r.applied_row_at) {
          await sql`UPDATE ppw_collections SET title_tag = ${next.title_tag}, meta_description = ${next.meta_description}, keywords_updated_at = NOW() WHERE slug = ${slug}`;
          await sql`UPDATE collection_keyword_research SET applied_row_at = NOW() WHERE slug = ${slug}`;
        }
      }
      return NextResponse.json({ ok: true, changed, title_len: next.title_tag.length, meta_len: next.meta_description.length, reapplied: changed.length > 0 && !!r.applied_row_at });
    }

    if (body.action === "strip-prices") {
      // Operates on the page's draft if one exists, else on the live body (creating a draft).
      const mode = body.mode === "all" ? "all" : "new";
      const live = await loadLiveCollection(slug);
      if (!live) return NextResponse.json({ error: "Collection not found on Shopify" }, { status: 404 });
      const draftRows = (await sql`SELECT body_html, plan, manual_items, score_before, score_after FROM collection_improve_drafts WHERE slug = ${slug}`) as Array<Record<string, any>>;
      const source = draftRows[0]?.body_html || live.body_html;
      const res = await stripPricesFromHtml(source, { mode, baselineHtml: live.body_html, handle: slug });
      if (res.changed > 0) {
        const planObj = draftRows[0]?.plan && typeof draftRows[0].plan === "object" ? draftRows[0].plan : { plan: [], steps: [] };
        const steps = [...(planObj.steps || []), ...res.rewritten.map((r) => ({ id: "strip-price", label: `Price removed (${mode})`, status: "done", detail: r }))];
        const plan = [...(planObj.plan || []), `Removed ${res.changed} price figure(s) from the copy`];
        await sql`
          INSERT INTO collection_improve_drafts (slug, title, body_html, seo_title, seo_description, plan, manual_items, score_before, score_after, created_at)
          VALUES (${slug}, ${live.title}, ${res.html}, ${live.seo_title}, ${live.seo_description}, ${JSON.stringify({ ...planObj, plan, steps, source: "keyword-audit-content" })}::jsonb, ${JSON.stringify(draftRows[0]?.manual_items || [])}::jsonb, ${draftRows[0]?.score_before ?? null}, ${draftRows[0]?.score_after ?? null}, now())
          ON CONFLICT (slug) DO UPDATE SET body_html = EXCLUDED.body_html, plan = EXCLUDED.plan, created_at = now()
        `;
        if (!draftRows[0]) await sql`UPDATE collection_keyword_research SET content_drafted_at = NOW() WHERE slug = ${slug}`;
      }
      return NextResponse.json({ ok: true, mode, changed: res.changed, rewritten: res.rewritten, stillOnPage: Array.from(new Set(res.untouched)).length, hadDraft: !!draftRows[0] });
    }

    if (body.action === "mark-content-published") {
      await sql`UPDATE collection_keyword_research SET content_published_at = NOW() WHERE slug = ${slug}`;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "snapshot-body") {
      // Save the live body once (before the content phase publishes) so Revert can restore copy as well as title/meta.
      const prev = (r.previous_shopify || {}) as Record<string, unknown>;
      if (prev.body_html) return NextResponse.json({ ok: true, already: true });
      const live = await loadLiveCollection(slug);
      if (!live) return NextResponse.json({ error: "Collection not found on Shopify" }, { status: 404 });
      const merged = { ...prev, title_tag: prev.title_tag ?? live.seo_title, description_tag: prev.description_tag ?? live.seo_description, body_html: live.body_html, body_captured_at: new Date().toISOString(), captured_at: prev.captured_at ?? new Date().toISOString() };
      await sql`UPDATE collection_keyword_research SET previous_shopify = ${JSON.stringify(merged)}::jsonb WHERE slug = ${slug}`;
      return NextResponse.json({ ok: true, already: false });
    }

    if (body.action === "suggest-terms") {
      const rec = r.recommendation as Recommendation | null;
      if (!rec) return NextResponse.json({ error: "No recommendation" }, { status: 400 });
      const research = r.research as Research;
      const products = await fetchAdminProducts({ collectionHandle: slug, limit: 50 });
      const terms = await suggestMustTerms({ handle: slug, primary: rec.primary, secondaries: rec.secondaries || [], category: col?.category, productTitles: products.map((p) => p.title), candidates: (research?.candidates || []).map((c) => c.kw) });
      await sql`UPDATE collection_keyword_research SET must_terms = ${JSON.stringify(terms)}::jsonb WHERE slug = ${slug}`;
      return NextResponse.json({ ok: true, must_terms: terms });
    }

    if (body.action === "coverage" || body.action === "content-draft") {
      const rec = r.recommendation as Recommendation | null;
      if (!rec) return NextResponse.json({ error: "No recommendation" }, { status: 400 });
      const live = await loadLiveCollection(slug);
      if (!live) return NextResponse.json({ error: "Collection not found on Shopify" }, { status: 404 });
      const mustTerms: string[] = Array.isArray(r.must_terms) ? (r.must_terms as string[]) : [];
      if (body.action === "coverage") return NextResponse.json({ ok: true, coverage: keywordCoverage(live.body_html, rec.primary, rec.secondaries || [], mustTerms) });
      const products = await fetchAdminProducts({ collectionHandle: slug, limit: 50 });
      const draft = await draftKeywordContent({ handle: slug, bodyHtml: live.body_html, rec, products, category: col?.category, maxSections: 3, mustTerms });
      const changed = draft.bodyHtml !== live.body_html;
      const kws = [rec.primary, ...(rec.secondaries || [])];
      const scoreBefore = computeSeoGrade({ body_html: live.body_html, seo_title: live.seo_title, seo_description: live.seo_description, primary_keyword: rec.primary, keywords: kws }).total;
      const scoreAfter = computeSeoGrade({ body_html: draft.bodyHtml, seo_title: live.seo_title, seo_description: live.seo_description, primary_keyword: rec.primary, keywords: kws }).total;
      if (changed) {
        const steps = [
          ...draft.weaves.map((w) => ({ id: "weave", label: `Weave "${w.keyword}"`, status: w.status === "applied" ? "done" : "skipped", detail: w.status === "applied" ? w.sentence.slice(0, 120) : w.why })),
          ...draft.sections.map((x) => ({ id: "section", label: `New section: ${x.h2}`, status: x.status === "added" ? "done" : "skipped", detail: x.status === "added" ? x.keywords.join(", ") : x.why })),
        ];
        const plan = steps.filter((x) => x.status === "done").map((x) => x.label);
        const manual = draft.unplaced.map((k) => `Keyword not placed naturally: "${k}". Consider a product-level mention or a blog link.`);
        await sql`
          INSERT INTO collection_improve_drafts (slug, title, body_html, seo_title, seo_description, plan, manual_items, score_before, score_after, created_at)
          VALUES (${slug}, ${live.title}, ${draft.bodyHtml}, ${live.seo_title}, ${live.seo_description}, ${JSON.stringify({ plan, steps, source: "keyword-audit-content" })}::jsonb, ${JSON.stringify(manual)}::jsonb, ${scoreBefore}, ${scoreAfter}, now())
          ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, body_html = EXCLUDED.body_html, seo_title = EXCLUDED.seo_title, seo_description = EXCLUDED.seo_description, plan = EXCLUDED.plan, manual_items = EXCLUDED.manual_items, score_before = EXCLUDED.score_before, score_after = EXCLUDED.score_after, created_at = now()
        `;
        await sql`UPDATE collection_keyword_research SET content_drafted_at = NOW() WHERE slug = ${slug}`;
      }
      return NextResponse.json({ ok: true, changed, scoreBefore, scoreAfter, before: draft.before, after: draft.after, weaves: draft.weaves, sections: draft.sections, unplaced: draft.unplaced });
    }

    if (body.action === "rewrite-meta") {
      const rec = r.recommendation as Recommendation | null;
      if (!rec) return NextResponse.json({ error: "No recommendation" }, { status: 400 });
      const facts = await collectionFacts(slug);
      const research = r.research as Research;
      const brandLed = isBrandLedHub(col?.category);
      const demand = facts ? brandsWithDemand(research, facts.vendors) : [];
      const allowedBrands = facts ? (brandLed ? Array.from(new Set([...demand, ...facts.vendors])).slice(0, 2) : demand) : [];
      const meta = await rewriteMeta(rec, research, { facts: facts ? factsBlock(facts) : null, allowedBrands, priceAllowed: !!facts?.priceAllowed, minPrice: facts?.minPrice ?? null, notes: r.notes, brandLed });
      let next: Recommendation = { ...rec, meta_description: meta };
      if (facts) {
        const issues = findFactIssues(next, facts, await storeVendors(sql)).filter((i) => i.field === "meta_description");
        if (issues.length) next = await repairFacts(next, facts, issues);
      }
      next = (await enforceLengths(next)).rec;
      const changed = next.meta_description !== rec.meta_description;
      if (changed) {
        await sql`UPDATE collection_keyword_research SET recommendation = ${JSON.stringify(next)}::jsonb WHERE slug = ${slug}`;
        if (r.applied_row_at) {
          await sql`UPDATE ppw_collections SET meta_description = ${next.meta_description}, keywords_updated_at = NOW() WHERE slug = ${slug}`;
          await sql`UPDATE collection_keyword_research SET applied_row_at = NOW() WHERE slug = ${slug}`;
        }
      }
      return NextResponse.json({ ok: true, changed, live: !!r.applied_shopify_at, brands: allowedBrands, meta_description: next.meta_description, meta_len: next.meta_description.length });
    }

    if (body.action === "fix-primary") {
      const rec = r.recommendation as Recommendation | null;
      if (!rec) return NextResponse.json({ error: "No recommendation" }, { status: 400 });
      if (!primaryMissing(rec)) return NextResponse.json({ ok: true, changed: false, title_tag: rec.title_tag, meta_description: rec.meta_description });
      const facts = await collectionFacts(slug);
      let next = await reinstatePrimary(rec, facts);
      next = (await enforceLengths(next)).rec;
      const changed = next.title_tag !== rec.title_tag || next.meta_description !== rec.meta_description;
      if (changed) {
        await sql`UPDATE collection_keyword_research SET recommendation = ${JSON.stringify(next)}::jsonb WHERE slug = ${slug}`;
        if (r.applied_row_at) {
          await sql`UPDATE ppw_collections SET title_tag = ${next.title_tag}, meta_description = ${next.meta_description}, keywords_updated_at = NOW() WHERE slug = ${slug}`;
          await sql`UPDATE collection_keyword_research SET applied_row_at = NOW() WHERE slug = ${slug}`;
        }
      }
      return NextResponse.json({ ok: true, changed, still_missing: primaryMissing(next), live: !!r.applied_shopify_at, title_tag: next.title_tag, meta_description: next.meta_description });
    }

    if (body.action === "validate-facts") {
      const rec = r.recommendation as Recommendation | null;
      if (!rec) return NextResponse.json({ error: "No recommendation" }, { status: 400 });
      const facts = await collectionFacts(slug);
      if (!facts) return NextResponse.json({ error: "Could not read the collection from Shopify" }, { status: 502 });
      const vendors = await storeVendors(sql);
      const issues = findFactIssues(rec, facts, vendors);
      if (!issues.length) return NextResponse.json({ ok: true, issues: [], facts: { vendors: facts.vendors.slice(0, 8), minPrice: facts.minPrice, maxPrice: facts.maxPrice } });
      let next = await repairFacts({ ...rec }, facts, issues);
      next = (await enforceLengths(next)).rec;
      const remaining = findFactIssues(next, facts, vendors);
      await sql`UPDATE collection_keyword_research SET recommendation = ${JSON.stringify(next)}::jsonb WHERE slug = ${slug}`;
      if (r.applied_row_at) {
        await sql`UPDATE ppw_collections SET title_tag = ${next.title_tag}, meta_description = ${next.meta_description}, keywords_updated_at = NOW() WHERE slug = ${slug}`;
        await sql`UPDATE collection_keyword_research SET applied_row_at = NOW() WHERE slug = ${slug}`;
      }
      return NextResponse.json({ ok: true, issues, remaining, title_tag: next.title_tag, meta_description: next.meta_description, facts: { vendors: facts.vendors.slice(0, 8), minPrice: facts.minPrice, maxPrice: facts.maxPrice } });
    }

    if (body.action === "recommend") {
      const facts = await collectionFacts(slug);
      let rec = await generateRecommendation(r.research as Research, { category: col?.category, productCount: col?.product_count, notes: r.notes, facts: facts ? factsBlock(facts) : null });
      if (facts) {
        const issues = findFactIssues(rec, facts, await storeVendors(sql));
        if (issues.length) rec = (await enforceLengths(await repairFacts(rec, facts, issues))).rec;
      }
      await sql`UPDATE collection_keyword_research SET recommendation = ${JSON.stringify(rec)}::jsonb, generated_at = NOW() WHERE slug = ${slug}`;
      return NextResponse.json({ ok: true, recommendation: rec });
    }

    if (body.action === "apply") {
      const rec = r.recommendation as Recommendation | null;
      if (!rec) return NextResponse.json({ error: "Generate a recommendation first" }, { status: 400 });
      const result: Record<string, unknown> = {};
      // keep_title: Ryan prefers the live title on this page; push keywords and meta only.
      const keepTitle = !!r.keep_title;
      if (body.toRow !== false) {
        if (keepTitle) {
          await sql`
            UPDATE ppw_collections SET
              primary_keyword = ${rec.primary},
              secondary_keywords = ${rec.secondaries},
              meta_description = ${rec.meta_description},
              keywords_updated_at = NOW()
            WHERE slug = ${slug}
          `;
        } else {
          await sql`
            UPDATE ppw_collections SET
              primary_keyword = ${rec.primary},
              secondary_keywords = ${rec.secondaries},
              title_tag = ${rec.title_tag},
              meta_description = ${rec.meta_description},
              keywords_updated_at = NOW()
            WHERE slug = ${slug}
          `;
        }
        await sql`UPDATE collection_keyword_research SET applied_row_at = NOW() WHERE slug = ${slug}`;
        result.row = "updated";
      }
      if (body.toShopify) {
        const live = await resolveCollectionId(slug);
        if (!live) return NextResponse.json({ ...result, error: "Collection not found on Shopify" }, { status: 404 });
        // Keep the first pre-push title/meta so a rollout can be reverted; never overwrite an existing snapshot.
        if (!r.previous_shopify) {
          const before = await readCollectionSeo(live.id);
          await sql`UPDATE collection_keyword_research SET previous_shopify = ${JSON.stringify({ ...before, captured_at: new Date().toISOString() })}::jsonb WHERE slug = ${slug}`;
        }
        const e1 = keepTitle ? null : await upsertCollectionSeoField(live.id, "title_tag", rec.title_tag);
        const e2 = await upsertCollectionSeoField(live.id, "description_tag", rec.meta_description);
        if (e1 || e2) return NextResponse.json({ ...result, error: `Shopify write failed: ${e1 || ""} ${e2 || ""}`.trim() }, { status: 502 });
        await sql`UPDATE collection_keyword_research SET applied_shopify_at = NOW() WHERE slug = ${slug}`;
        result.kept_title = keepTitle;
        result.shopify = { id: live.id, title_tag: rec.title_tag, description_tag: rec.meta_description };
      }
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "revert-shopify") {
      const prev = r.previous_shopify as { title_tag: string | null; description_tag: string | null } | null;
      if (!prev) return NextResponse.json({ error: "No pre-push snapshot for this collection" }, { status: 400 });
      const live = await resolveCollectionId(slug);
      if (!live) return NextResponse.json({ error: "Collection not found on Shopify" }, { status: 404 });
      const e1 = await upsertCollectionSeoField(live.id, "title_tag", prev.title_tag || "");
      const e2 = await upsertCollectionSeoField(live.id, "description_tag", prev.description_tag || "");
      const prevBody = (r.previous_shopify as { body_html?: string }).body_html;
      const e3 = prevBody ? await updateCollectionBody(live.id, live.type, prevBody) : null;
      if (e1 || e2 || e3) return NextResponse.json({ error: `Shopify write failed: ${e1 || ""} ${e2 || ""} ${e3 || ""}`.trim() }, { status: 502 });
      await sql`UPDATE collection_keyword_research SET applied_shopify_at = NULL, content_published_at = NULL WHERE slug = ${slug}`;
      return NextResponse.json({ ok: true, restored: { title_tag: prev.title_tag, description_tag: prev.description_tag, body: !!prevBody } });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "action failed" }, { status: 500 });
  }
}
