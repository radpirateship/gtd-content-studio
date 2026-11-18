import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import { fetchAdminProducts } from "@/lib/shopify/products-admin";
import { gradeCollection } from "@/lib/collectionGrade";
import { computeSeoGrade } from "@/lib/seoGrade";
import { callAI } from "@/lib/ai";
import { WRITING_RULES, stripEmDashes } from "@/lib/brandRules";
import { BRAND_COLLECTIONS } from "@/lib/collection-link-map";
import { keywordOverview, matchingTerms, serpOverview } from "@/lib/ahrefs";
import { enforceTitleRules, metaSpec, titleSpec } from "@/lib/keyword-audit";
import { stripPricesFromHtml } from "@/lib/keyword-content-prices";
import { extractPreserved, selectFeatured, selectFeaturedDetailed, selectLearningLinks, assemblePage, validateGenerated, shouldIncludeCompare, detectOwnershipVariant, findFieldsContaining, setFieldAtPath, keywordCoverage, type GenProduct, type GeneratedSections, type CatalogArticle } from "@/lib/collection-generate";
import { extractFaqItems, blocksOf, findBlock } from "@/lib/collection-improve-engine";
import { ensureCollectionColumns } from "@/lib/ensureCollectionColumns";

/**
 * POST /api/collections/generate   Body: { slug }
 *
 * GENERATE mode (docs/GTD_Collection_Generator_Cowork_Instructions.md):
 * full-page rewrite from a fixed skeleton + live Shopify products + Ahrefs
 * research. Primary mode for all collections; Improve is legacy (8+ pages).
 * Saves a DRAFT (never publishes); pre-publish validation runs here AND in
 * the publish route.
 */

export const maxDuration = 300;

const API_VERSION = "2024-10";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

async function shopifyGet(path: string, token: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${API_VERSION}/${path}`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(Number(res.headers.get("retry-after") || 2) * 1000); continue; }
    return null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { slug } = await request.json();
    if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });

    const sql = getSQL();
    const token = await getShopifyAccessToken();
    const steps: { id: string; label: string; status: "done" | "not-needed" | "skipped" | "manual"; detail: string }[] = [];
    const step = (id: string, label: string, status: "done" | "not-needed" | "skipped" | "manual", detail = "") =>
      steps.push({ id, label, status, detail });
    const plan: string[] = [];

    // ── Load collection + DB row ─────────────────────────────────────────────
    let collection: any = null;
    for (const type of ["custom", "smart"] as const) {
      const d = await shopifyGet(`${type}_collections.json?handle=${encodeURIComponent(slug)}&limit=1`, token);
      const hit = d?.[`${type}_collections`]?.[0];
      if (hit) { collection = hit; break; }
      await sleep(500);
    }
    if (!collection) return NextResponse.json({ error: `Collection '${slug}' not found on Shopify` }, { status: 404 });
    // limit=250 + any-namespace fallback: app metafields can push the SEO
    // tags past the default 50-per-page, which made generation think there
    // was no title tag and fabricate "[Keyword] | Green Thumb Depot".
    const mf = await shopifyGet(`collections/${collection.id}/metafields.json?limit=250`, token);
    const metafields: Array<{ namespace: string; key: string; value: string }> = mf?.metafields || [];
    const mfPick = (keys: string[]) => {
      for (const key of keys) {
        const v = metafields.find((m) => m.namespace === "global" && m.key === key)?.value ||
          metafields.find((m) => m.key === key)?.value;
        if (v) return v;
      }
      return undefined;
    };
    const seoTitle = mfPick(["title_tag", "seo_title", "meta_title"]) || collection.title || "";
    const seoDescription = mfPick(["description_tag", "seo_description", "meta_description"]) || "";
    const bodyBefore: string = collection.body_html || "";

    await ensureCollectionColumns(sql);
    const kwRow = (await sql`SELECT primary_keyword, secondary_keywords, collection_type, featured_handles, category FROM gtd_collections WHERE slug = ${slug}`) as Array<{ primary_keyword: string | null; secondary_keywords: unknown; collection_type: string | null; featured_handles: string[] | null; category?: string | null }>;
    const hubCategory: string | null = kwRow[0]?.category ?? null;
    let secondaries: string[] = [];
    try {
      const raw = kwRow[0]?.secondary_keywords;
      secondaries = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? JSON.parse(raw) : [];
    } catch { /* none */ }

    // ── Products + type detection (vendor count; DB tag wins when set) ───────
    const rawProducts = await fetchAdminProducts({ collectionHandle: slug, limit: 250 });
    const products: GenProduct[] = rawProducts.map((p) => ({
      title: p.title, handle: p.handle, price: parseFloat(p.price),
      imageUrl: p.imageUrl, vendor: p.vendor, description: p.description || "",
      productType: p.productType || "",
    }));
    const vendors = [...new Set(products.map((p) => p.vendor).filter(Boolean))];
    const dbType = (kwRow[0]?.collection_type || "").toLowerCase();
    // Brand detection: the DB tag always wins in BOTH directions. Auto-detect
    // requires the collection to actually be NAMED for its single vendor (or
    // be in the known brand list) — a category that happens to carry one
    // vendor (e.g. steam showers = all Kohler) is still a category.
    const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const soleVendor = vendors.length === 1 ? vendors[0] : null;
    const namedForVendor = !!soleVendor && (
      normName(collection.title).includes(normName(soleVendor)) ||
      normName(slug).includes(normName(soleVendor)) ||
      BRAND_COLLECTIONS.some((b) => b.handle === slug)
    );
    const isBrand = dbType === "brand" ? true
      : dbType === "standard" || dbType === "category" ? false
      : !!soleVendor && products.length > 0 && namedForVendor;
    const brandEntry = BRAND_COLLECTIONS.find((b) => b.handle === slug);
    const brandName = isBrand ? (brandEntry?.name || vendors[0] || collection.title.split(" ").slice(0, 2).join(" ")) : null;
    const catLabel = collection.title.replace(/ for sale.*/i, "").trim();
    step("type", "Template detected", "done", `${isBrand ? `BRAND (${brandName})` : "CATEGORY"} — ${vendors.length} vendor(s), ${products.length} product(s)`);
    if (products.length < 10) step("depth", "Product depth", "manual", `THIN: ${products.length} products — generated anyway per standing instruction; not a link-building target until 10+`);

    // ── July 31 rules: compare-table median gate + ownership variant ─────────
    const compareDecision = shouldIncludeCompare(products);
    const ownershipVariant = detectOwnershipVariant(products);
    step("compare_rule", "Compare table (median-price rule)", "done",
      isBrand ? "brand page — compare table always included" : compareDecision.reason);
    step("ownership_variant", "Ownership variant", "done",
      `${ownershipVariant.toUpperCase()} (from Shopify product types: ${[...new Set(products.map((p) => p.productType).filter(Boolean))].slice(0, 4).join(", ") || "none set — fell back to median price"})`);

    // ── Preserved elements ───────────────────────────────────────────────────
    const preserved = extractPreserved(bodyBefore);
    step("preserved", "Preserved elements extracted", "done",
      `${preserved.learningLinks.length} learning link(s) on the old page${preserved.quiz ? `, quiz CTA (${preserved.quiz.url})` : ""} — styling via theme asset gtd-collections.css (no embedded stylesheet)`);
    // NOTE: Learning Center gap is judged AFTER catalog selection below —
    // the old page having 0 links means nothing when the article catalog
    // fills the section. Flagging here produced a false leftover on every run.

    // 2026-08-13: the "Shop by Type" sub-collection tile block (and the live
    // Shopify verification pass that kept its images fresh) was removed at
    // Ryan's request. Regenerating a page that still has one drops it.
    const oldSubNav = /href="[^"]*\/collections\/[^"]+"/i.test(bodyBefore)
      && (bodyBefore.match(/href="[^"]*\/collections\/[^"]+"/gi) || []).length >= 2;
    if (oldSubNav) {
      step("subnav_removed", "Sub-collection tiles", "done",
        "old page linked 2+ other collections in tiles — that section is no longer carried forward and has been dropped from this rebuild");
    }

    // original Q1/Q2 for bleed validation
    const oldFaqBlk = findBlock(blocksOf(bodyBefore), /frequently asked|faq/i);
    const oldItems = oldFaqBlk ? extractFaqItems(oldFaqBlk.html).items : [];
    const originalQ1 = oldItems[0]?.q || null;
    const originalQ2 = oldItems[1]?.q || null;

    // ── Step 1: Ahrefs research (best-effort) ────────────────────────────────
    const researchLog: string[] = [];
    let pk = kwRow[0]?.primary_keyword || `${catLabel.toLowerCase()}${isBrand ? "" : " for sale"}`;
    let longTailQs: string[] = [];
    if (process.env.AHREFS_API_KEY) {
      try {
        const [ov, serp, terms] = await Promise.all([
          keywordOverview(pk),
          serpOverview(pk),
          matchingTerms(pk, { limit: 20 }),
        ]);
        if (ov) researchLog.push(`"${pk}": volume ${(ov as any).volume ?? "?"}, KD ${(ov as any).difficulty ?? "?"}, traffic potential ${(ov as any).traffic_potential ?? (ov as any).trafficPotential ?? "?"}`);
        if (serp.length) {
          researchLog.push(`SERP top ${serp.length}: ${serp.slice(0, 3).map((s) => `${s.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]} (DR ${s.domainRating ?? "?"})`).join(", ")}`);
          const gtd = serp.find((s) => s.url.includes("greenthumbdepot"));
          researchLog.push(gtd ? `GTD currently ranks #${gtd.position}` : "GTD not in top 10");
        }
        const termList: any[] = Array.isArray(terms) ? terms : [];
        if (termList.length) {
          const byVol = termList.filter((t) => t.keyword && t.volume).sort((a, b) => b.volume - a.volume);
          const found = byVol.slice(0, 5).map((t) => String(t.keyword)).filter((k) => k !== pk && !secondaries.includes(k));
          // YOUR selected keywords are used AS-IS — extra opportunities are
          // reported, never silently merged (they used to inflate 5 picks to
          // 9-10 and dilute the curated set). Auto-adopt ONLY when the
          // collection has no secondaries at all (unattended bulk runs).
          if (secondaries.length === 0 && found.length) {
            secondaries = found.slice(0, 5);
            researchLog.push(`No stored secondaries — adopted top ${secondaries.length} matching terms: ${secondaries.join(", ")}`);
          } else if (found.length) {
            researchLog.push(`${found.length} further opportunity(ies) found but NOT added — your ${secondaries.length} selected keyword(s) are used as-is. To include any, add them in Step 1: ${found.join(", ")}`);
          }
          longTailQs = byVol.filter((t) => /^(how|what|which|best|is|are|can|do)\b/i.test(t.keyword)).slice(0, 8).map((t) => String(t.keyword));
          researchLog.push(`${longTailQs.length} question keywords routed to FAQ only`);
        }
        step("ahrefs", "Ahrefs research", "done", researchLog[0] || "completed");
      } catch (aErr) {
        step("ahrefs", "Ahrefs research", "skipped", `failed: ${aErr instanceof Error ? aErr.message : "error"} — using stored keywords`);
      }
    } else {
      step("ahrefs", "Ahrefs research", "skipped", "AHREFS_API_KEY not configured — using stored keywords");
    }

    // persist refined keywords
    try {
      await sql`UPDATE gtd_collections SET primary_keyword = ${pk}, secondary_keywords = ${secondaries} WHERE slug = ${slug}`;
    } catch { /* non-fatal */ }

    // ── Learning Center: pick the most RELEVANT articles from the full blog
    // catalog (keyword-scored, rare words weighted) instead of carrying the
    // old page's links; old links remain the fallback pool.
    try {
      const arts = (await sql`
        SELECT current_title, source_url, category FROM blog_post_tracking
        WHERE current_title IS NOT NULL AND source_url IS NOT NULL
      `) as Array<{ current_title: string; source_url: string; category: string | null }>;
      const catalog: CatalogArticle[] = arts
        .map((a) => ({ title: a.current_title, url: a.source_url.replace(/^https?:\/\/[^/]+/, ""), category: a.category }))
        .filter((a) => a.url.includes("/blogs/"));
      // Ultimate-guide PAGES (/pages/*-ultimate-guide): the matching one always
      // takes the pillar slot (per Ryan; index at /pages/ultimate-guides).
      let guides: CatalogArticle[] = [];
      try {
        const pg = await shopifyGet("pages.json?limit=250&fields=title,handle", token);
        guides = (pg?.pages || [])
          .filter((p: { title: string; handle: string }) => /ultimate.?guide/i.test(p.handle) || /ultimate/i.test(p.title))
          .filter((p: { handle: string }) => p.handle !== "ultimate-guides")
          .map((p: { title: string; handle: string }) => ({ title: p.title, url: `/pages/${p.handle}` }));
      } catch { /* pages fetch is best-effort */ }
      const chosen = selectLearningLinks(catalog, [pk, ...secondaries, collection.title], preserved.learningLinks, 4, guides);
      if (chosen.length >= 3) {
        preserved.learningLinks = chosen;
        const pillarIsGuide = chosen[0] && chosen[0].url.startsWith("/pages/");
        step("learning_pick", "Learning Center articles selected", "done",
          `${pillarIsGuide ? `pillar = ultimate guide "${chosen[0].title.slice(0, 50)}"; ` : ""}keyword-matched from ${catalog.length} articles + ${guides.length} ultimate guide(s): ${chosen.map((c) => `"${c.title.slice(0, 45)}"`).join("; ")}`);
      } else if (catalog.length > 0) {
        // July 31 rule: fewer than 3 TOPICALLY relevant posts = omit the
        // section and flag the content gap — never fill with off-topic posts.
        preserved.learningLinks = [];
        step("learning_pick", "Learning Center", "skipped",
          `only ${chosen.length} topically relevant post(s) in a ${catalog.length}-article catalog — section omitted, CONTENT GAP: write ${3 - chosen.length}+ posts for "${pk}"`);
      }
    } catch (lErr) {
      // catalog unavailable: old-page links are the fallback — only a real
      // problem if THEY are also too few, which the final check below flags
      console.warn("[collections/generate] article catalog unavailable:", lErr);
    }
    // final verdict on the section, based on what will actually render
    if (preserved.learningLinks.length < 3 && !steps.some((s) => s.id === "learning_pick")) {
      step("learning_gap", "Learning Center", "skipped",
        `only ${preserved.learningLinks.length} relevant link(s) available — section omitted, content gap`);
    }

    // ── Step 2: product selection ────────────────────────────────────────────
    // v2 design: 3 pick cards on both templates (brand compare table shows all
    // models). Manual override: featured_handles on the collection row pins
    // specific products (in order); auto-selection fills any remaining slots.
    // Accept raw handles OR full product URLs; normalize before matching.
    const normHandle = (h: string) => h.trim().toLowerCase()
      .replace(/^https?:\/\/[^/]+/, "").replace(/^.*\/products\//, "")
      .replace(/[?#].*$/, "").replace(/\/+$/, "");
    const overrideHandles = (kwRow[0]?.featured_handles || []).map(normHandle).filter(Boolean);
    const pinned = overrideHandles.map((h) => products.find((p) => p.handle.toLowerCase() === h)).filter((p): p is GenProduct => !!p).slice(0, 3);
    const badHandles = overrideHandles.filter((h) => !products.some((p) => p.handle.toLowerCase() === h));
    // Selection is product_type-first (see selectFeaturedDetailed): the page's
    // subject type decides the pool, so accessories can't take a pick card on
    // an equipment page. Context is the collection title + primary keyword.
    const selCtx = { title: collection.title, keyword: pk };
    let featured: GenProduct[];
    if (pinned.length > 0) {
      const fill = selectFeatured(products.filter((p) => !pinned.some((x) => x.handle === p.handle)), 3 - pinned.length, selCtx);
      featured = [...pinned, ...fill].sort((a, b) => a.price - b.price);
      step("products", "Featured products selected", "done",
        `MANUAL override: ${pinned.map((p) => p.handle).join(", ")}${fill.length ? ` + auto ${fill.map((p) => p.handle).join(", ")}` : ""}${badHandles.length ? ` (ignored, not in collection: ${badHandles.join(", ")})` : ""}`);
    } else {
      const sel = selectFeaturedDetailed(products, 3, selCtx);
      featured = sel.picks;
      if (overrideHandles.length > 0) {
        // an override was SET but nothing matched — never fail silently
        step("products", "Featured products selected", "skipped",
          `OVERRIDE IGNORED: none of [${overrideHandles.join(", ")}] match a live product handle in this collection. Valid handles: ${products.slice(0, 8).map((p) => p.handle).join(", ")}${products.length > 8 ? "..." : ""}. Auto-selected ${featured.map((f) => fmt(f.price)).join(", ")} instead.`);
      } else {
        step("products", "Featured products selected", featured.length > 0 ? "done" : "skipped",
          featured.length ? `${featured.length} pick cards: ${featured.map((f) => fmt(f.price)).join(", ")} — ${sel.reason}. Pin different ones via "Featured product handles", then regenerate` : "no priced products");
      }
      // A single-type collection with no usable subject is worth flagging:
      // it usually means product_type is unset on the products themselves.
      if (!sel.subjectType && products.length > 3) {
        step("products_untyped", "Product types missing", "skipped",
          "no product_type set on these products, so accessories could not be separated by type — selection fell back to title matching and price position. Setting product types in Shopify will fix this permanently.");
      }
    }
    const priceMin = featured.length ? featured[0].price : null;

    // ── Step 3: generation (one call, all section text) ──────────────────────
    const competitors = BRAND_COLLECTIONS.map((b) => b.name).filter((n) => n !== brandName).slice(0, 20);
    const system = `You are the senior SEO copywriter at Green Thumb Depot, a premium wellness equipment retailer. You write complete collection-page content following the GTD ${isBrand ? "Brand" : "Category"} Collection Page Rules exactly.
${WRITING_RULES}
FORMAT: colons as bullet label separators; "to" for ranges; NO em dashes anywhere except the single H2 separator; never start a sentence with "Discover"; every sentence carries a brand, keyword, feature, or trust signal. Return ONLY valid JSON.
PRICES: NEVER write a dollar figure, price range, "from $X" or "under $X" anywhere. Prices change and sales come and go; the product grid above this copy shows live prices and has a price filter. Talk about cost qualitatively (entry-level, mid-range, premium, what the extra money buys, per-session electricity in cents at most).
KEYWORDS: the primary keyword AND every secondary keyword must each appear at least once somewhere in the page copy (natural plural/singular variants count). Adding one keyword must never displace another.`;
    const featuredBrief = featured.map((f) => `- handle "${f.handle}": ${f.title} (${fmt(f.price)}) — ${f.description ? f.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(/\s+/).slice(0, 40).join(" ") : "no description"}`).join("\n");
    const ownershipSpec = ownershipVariant === "accessory"
      ? `"ownership": {"warranty":{"text":"2-3 sentences on warranty coverage${isBrand ? ` with ${brandName}'s ACTUAL coverage periods` : ""}","meta":[2 short "Label · value" lines]},"care":{"text":"2-3 sentences on cleaning and care (these are accessories: rinse, dry, store)","meta":[2]},"returns":{"text":"2-3 sentences on returns and size/material exchanges (30-day window on unused items)","meta":[2]}}`
      : `"ownership": {"shipping":{"text":"2-3 sentences on freight/ground shipping for this ${isBrand ? "brand" : "category"} (2 to 4 week timelines, NO cost claims)","meta":[2 short "Label · value" lines]},"install":{"text":"2-3 sentences on assembly + electrical","meta":[2]},"warranty":{"text":"2-3 sentences${isBrand ? ` with ${brandName}'s ACTUAL coverage periods` : ""}","meta":[2]},"care":{"text":"2-3 sentences on cleaning + maintenance","meta":[2]}}`;
    const categoryFields = `"picks": [3 objects {"handle","specs":[3 spec lines, 4 to 8 words each, FACTUAL from that product's description — no invented numbers]} for the featured products listed above],
 "buyingGuide": [3 cards {"heading" starting with an ACTION VERB, "bullets":[2-3 {"label","text"}]} covering placement, capacity, and the key technical decision],
 "benefits": [4 objects {"emoji","heading" naming an OUTCOME,"text" 2-3 sentences mentioning the category}],
 "spaceStats": [3 objects {"stat" a short measurement like "4 in" or "79 in" or "240V" DERIVED from the products,"heading","text" 1-2 sentences}],
 ${ownershipSpec}`;
    const brandFields = `"picks": [3 objects {"handle","specs":[3 spec lines, 4 to 8 words each, FACTUAL from that product's description]} for the featured products listed above],
 "brandGlance": [5 objects {"label","value"} at-a-glance facts: product types, sizes or capacities carried, warranty, HSA/FSA eligibility, model count ${products.length}],
 "tiers": [3 objects {"tierLabel" like "Tier 1 · Entry","name" a REAL model name,"specs":[4 {"label","value"}],"text" 1 sentence "Best for..."} entry/mid/flagship],
 "fit": {"yes":[4 short "A good fit if you..." completions],"no":[4 honest "Look elsewhere if you..." completions]},
 "certs": {"para":"2-3 sentences on construction/materials from product descriptions","items":[4 {"title" a certification or build fact,"text" 4-8 words}]},
 "story": [2 paragraph strings, 2-3 sentences each, on the brand's history and why GTD carries it — no invented dates or factory visits],
 "benefits": [4 objects {"emoji","heading" naming an OUTCOME,"text" 2-3 sentences mentioning ${brandName}}],
 "brandDescription": "2-3 sentences on what the brand makes + key differentiator",
 ${ownershipSpec}`;
    // Secondary keywords used to appear only as a header line here, so the
    // model treated them as context rather than a requirement and routinely
    // shipped a draft that used none of them — leaving the post-generation
    // coverage pass to bury them in FAQ answers, or Ryan to insert them by
    // hand afterwards. They are now an explicit, section-assigned deliverable.
    const kwSpec = secondaries.length
      ? `Secondary keywords (REQUIRED — every one of these must appear verbatim at least once in the copy you return; natural plural/singular variants count):
${secondaries.map((k, i) => `  ${i + 1}. "${k}"`).join("\n")}
Placement: spread them across DIFFERENT sections — bullets, benefits headings and text, ${isBrand ? "tiers, fit, story" : "buyingGuide, spaceStats"}, ownership text, and FAQ answers. Do not cluster them, do not stack two into one sentence, and never repeat one to hit a count. Each must read as the natural phrase for that sentence; if a keyword genuinely cannot fit a section, place it in the most relevant FAQ answer instead of forcing it. Using a secondary keyword must never push out the primary keyword or another secondary.`
      : `Secondary keywords: none`;
    const user = `Collection: "${collection.title}" (${isBrand ? `BRAND page for ${brandName}` : "CATEGORY page"})
Primary keyword: "${pk}"
${kwSpec}
${isBrand ? `Competitors to reference honestly in Q2: ${competitors.join(", ")}` : `Brands carried: ${vendors.join(", ")}`}
Products: ${products.slice(0, 12).map((p) => p.title).join("; ")}
Featured products (write "picks" specs for exactly these, keyed by handle):
${featuredBrief || "none"}
Question keywords for FAQ Q3+: ${longTailQs.join("; ") || "none — invent buyer-relevant ones"}

Return JSON exactly:
{
 "h2": "${isBrand ? `${brandName} [Primary Product Type] — [Differentiator]` : `[Keyword Variant] — [Differentiator with brand or type, no price]`}",
 "intro": "Overview paragraph 1: 2 sentences. ${isBrand ? `${brandName} in sentence 1, name primary product lines, no price` : `Brands in first 2 sentences, keyword in sentence 2, no price`}. No tags.",
 "intro2": "Overview paragraph 2: 2-3 sentences on who this ${isBrand ? "brand" : "category"} is for and how to think about the decision. No tags.",
 "bullets": [6 objects {"label","text"} covering in order: ${isBrand ? "entry model BY NAME (no price), flagship model BY NAME (no price), certification/manufacturing, athletic use, lifestyle use, warranty/support" : "entry product BY NAME (no price), premium product BY NAME (no price), certification, athletic use, wellness use, support differentiator"}],
 "faq": [${Math.min(14, Math.max(12, 12 + longTailQs.length > 12 ? 13 : 12))} objects {"q","a"}: Q1 = "What is the best ${isBrand ? `${brandName} ${catLabel.toLowerCase()}` : pk}?" recommending real models; Q2 = ${isBrand ? `"How does ${brandName} compare to [2 competitors]?" honest comparison` : `brand comparison among ${vendors.slice(0, 3).join(", ")}`}; Q3+ from the question keywords + buyer topics (cost, sizing, installation, safety, warranty). Answers 40-90 words],
 "seoTitle": ${JSON.stringify(titleSpec(pk))},
 "seoDescription": ${JSON.stringify(metaSpec({ primary: pk, hub: hubCategory, isBrand, brandName, vendors: vendors as string[], prices: products.map((p) => parseFloat(String(p.price))).filter((n) => Number.isFinite(n) && n > 0) }))},
 ${isBrand ? brandFields : categoryFields}
}`;

    // Regeneration must produce a FRESH take, not a re-roll of the same text.
    let isRegen = false;
    try {
      const prior = (await sql`SELECT 1 FROM collection_improve_drafts WHERE slug = ${slug}`) as unknown[];
      isRegen = prior.length > 0;
    } catch { /* drafts table may not exist yet */ }
    const userFinal = isRegen
      ? `${user}\n\nIMPORTANT — REGENERATION: a previous draft for this collection was REJECTED. Produce a substantially DIFFERENT take: different sentence structures, different angles in FAQ answers and benefits, different bullet phrasings, a different differentiator in the H2 and seoTitle. All factual/price/keyword rules still apply.`
      : user;
    if (isRegen) step("regen", "Regeneration mode", "done", "prior draft exists — instructed a substantially different take");
    const raw = await callAI(system, userFinal, { maxTokens: 12000, timeoutMs: 280000 });
    const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    let g: GeneratedSections;
    try {
      g = JSON.parse(cleaned);
    } catch {
      const s0 = cleaned.indexOf("{"); const e0 = cleaned.lastIndexOf("}");
      g = JSON.parse(cleaned.slice(s0, e0 + 1));
    }
    // sanitize + em-dash strip on text fields (keep the single H2 separator)
    const stripField = (t: unknown) => stripEmDashes(String(t ?? ""));
    g.intro = stripField(g.intro);
    if (g.intro2) g.intro2 = stripField(g.intro2);
    g.faq = (g.faq || []).map((f) => ({ q: stripField(f.q), a: stripField(f.a) }));
    g.bullets = (g.bullets || []).map((b) => ({ label: stripField(b.label), text: stripField(b.text) }));
    step("generate", "Page content generated", "done", `${g.faq.length} FAQs, ${g.bullets.length} bullets${g.buyingGuide ? `, ${g.buyingGuide.length} guide cards` : ""}`);
    plan.push(`Generated full ${isBrand ? "brand" : "category"} page from skeleton (${g.faq.length} FAQs)`);

    // ── Assemble ─────────────────────────────────────────────────────────────
    const collectionUrl = `https://greenthumbdepot.com/collections/${slug}`;
    const buildBody = () => assemblePage({
      isBrand, catLabel, sections: g, featured, allProducts: products, preserved,
      collectionUrl, collectionTitle: collection.title, brandName,
      heroImageUrl: collection.image?.src || featured[featured.length - 1]?.imageUrl || featured[0]?.imageUrl || null,
      includeCompare: !isBrand && compareDecision.include,
      ownershipVariant,
    });
    let body = buildBody();
    if (preserved.quiz) plan.push("Quiz CTA rebuilt in the standard section design (link and wording kept, old colours dropped)");
    if (preserved.learningLinks.length >= 3) plan.push(`Learning Center rebuilt from ${preserved.learningLinks.length} preserved links`);

    // ── Step 5: validation (also enforced again at publish) ──────────────────
    let blockers = validateGenerated(body, products, originalQ1, originalQ2);

    // ── Price correction pass (check → fix → verify): the AI sometimes
    //    invents cost figures ("$900 install", "$2,600 annual") that the price
    //    check rightly blocks. Rewrite ONLY the offending fields.
    //
    //    2026-08-13: this MUST be runnable more than once per generation. It
    //    used to run a single time, before the keyword-coverage pass. That
    //    pass makes its own AI call to weave keywords into intro2/FAQ answers,
    //    and it happily writes a fresh round-number threshold ("keeps every
    //    model under $5,000") while doing so — reintroducing a price blocker
    //    AFTER the only price fix had already run and logged "clean". The
    //    draft then failed at publish forever, and regenerating just repeated
    //    the sequence (tyent, blocked on $5,000 across three regenerations).
    //    Now it is a function, called again after the keyword pass. ──────────
    const runPriceFix = async (stepId: string, context: string): Promise<void> => {
      const priceIssues = blockers.filter((b) => b.startsWith("price(s)"));
      if (priceIssues.length === 0) return;
      const bad = [...new Set(priceIssues.join(" ").match(/\$[\d,]+/g) || [])];
      const fields = findFieldsContaining(g, bad);
      if (!bad.length || !fields.length) {
        step(stepId, `Invented-price correction pass${context}`, "skipped",
          `${bad.join(", ") || "figure(s)"} flagged but not found in any AI-written field — the figure is coming from assembled product data, review before publish`);
        return;
      }
      try {
        const fixUser = `These dollar figures are NOT live product prices and are blocked from publishing: ${bad.join(", ")}.
Live product prices you MAY reference: ${products.slice(0, 12).map((p) => `${p.title} ${fmt(p.price)}`).join("; ")}.
Rewrite each text below to make the same point WITHOUT those blocked figures — describe costs qualitatively (per-session cents, kWh, "varies by electrician") or use an actual live price. Do NOT introduce any other dollar figure of $200 or more, including round thresholds such as "under $5,000" or "starting around $3,000". Keep similar length and tone. Return ONLY JSON: {"fixes":[{"path":"<same path>","text":"<rewritten>"}]}
${JSON.stringify({ fields })}`;
        const fixRaw = await callAI(system, fixUser, { maxTokens: 4000, timeoutMs: 120000 });
        const fixCleaned = fixRaw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const fixed = JSON.parse(fixCleaned.slice(fixCleaned.indexOf("{"), fixCleaned.lastIndexOf("}") + 1));
        for (const f of fixed.fixes || []) {
          if (f.path && typeof f.text === "string") setFieldAtPath(g, f.path, stripEmDashes(f.text));
        }
        body = buildBody();
        blockers = validateGenerated(body, products, originalQ1, originalQ2);
        const stillBad = blockers.some((b) => b.startsWith("price(s)"));
        step(stepId, `Invented-price correction pass${context}`, stillBad ? "skipped" : "done",
          `${bad.join(", ")} found in ${fields.length} field(s) — ${stillBad ? "rewrite attempted but figures remain, review before publish" : "rewritten and re-validated clean"}`);
      } catch (fixErr) {
        step(stepId, `Invented-price correction pass${context}`, "skipped",
          `corrective call failed (${fixErr instanceof Error ? fixErr.message.slice(0, 60) : "error"}) — ${bad.join(", ")} remain flagged`);
      }
    };
    await runPriceFix("price_fix", "");

    // ── Keyword coverage pass (check → fix → verify): EVERY selected keyword
    //    must appear in the page. The AI otherwise trades keywords when new
    //    secondaries are added — weaving one in by dropping another. Missing
    //    ones get ADDED to the most relevant field; present ones are locked. ──
    const kwAll = [pk, ...secondaries].filter(Boolean);
    let cov = keywordCoverage(body, kwAll);
    if (cov.missing.length > 0) {
      try {
        const fields = [
          ...(g.intro2 ? [{ path: "intro2", text: g.intro2 }] : []),
          ...(g.faq || []).map((f, i) => ({ path: `faq.${i}.a`, text: f.a })),
        ];
        const kwUser = `These target keywords are MISSING from the page: ${cov.missing.join("; ")}.
Keywords already present that must NOT be removed, reworded, or displaced: ${cov.present.join("; ")}.
Weave EACH missing keyword naturally into exactly ONE of the texts below (pick the most topically relevant per keyword; plural/singular variants count). ADD a phrase or clause — never delete existing keyword phrases, never change facts or dollar amounts.
CRITICAL: do NOT introduce ANY new dollar figure of $200 or more while rewriting. That includes round thresholds and ranges such as "under $5,000", "from $3,000", or "around $4,000" — a figure that is not an exact live product price blocks the page from publishing. Keep every dollar amount that already appears exactly as written, and add none.
Return ONLY JSON: {"fixes":[{"path":"<same path>","text":"<rewritten full text>"}]}
${JSON.stringify({ fields })}`;
        const kwRaw = await callAI(system, kwUser, { maxTokens: 4000, timeoutMs: 120000 });
        const kwCleaned = kwRaw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const kwFixed = JSON.parse(kwCleaned.slice(kwCleaned.indexOf("{"), kwCleaned.lastIndexOf("}") + 1));
        for (const f of kwFixed.fixes || []) {
          if (f.path && typeof f.text === "string") setFieldAtPath(g, f.path, stripEmDashes(f.text));
        }
        body = buildBody();
        blockers = validateGenerated(body, products, originalQ1, originalQ2);
        const before = cov;
        cov = keywordCoverage(body, kwAll);
        step("kw_coverage", "Keyword coverage pass", cov.missing.length ? "skipped" : "done",
          `${before.present.length}/${kwAll.length} -> ${cov.present.length}/${kwAll.length} keywords present${cov.missing.length ? ` — still missing: ${cov.missing.join("; ")}` : ` (wove in: ${before.missing.join("; ")})`}`);
      } catch (kwErr) {
        step("kw_coverage", "Keyword coverage pass", "skipped",
          `corrective call failed (${kwErr instanceof Error ? kwErr.message.slice(0, 60) : "error"}) — missing: ${cov.missing.join("; ")}`);
      }
    } else {
      step("kw_coverage", "Keyword coverage", "done", `${kwAll.length}/${kwAll.length} selected keywords present in the page`);
    }

    // The keyword pass rewrites live text, so it can reintroduce a blocked
    // dollar figure after the first price fix already reported clean. Re-run
    // the price fix on whatever it left behind before the draft is saved.
    await runPriceFix("price_fix_2", " (after keyword pass)");
    // House rule (25 Oct 2026): no dollar figures in collection copy at all. Deterministic last pass.
    try {
      const sp = await stripPricesFromHtml(body, { mode: "all", handle: slug });
      if (sp.changed > 0) { body = sp.html; step("no_prices", "No prices in copy (house rule)", "done", `${sp.changed} price mention(s) rewritten`); }
      else step("no_prices", "No prices in copy (house rule)", "done", "none found");
    } catch (e) { step("no_prices", "No prices in copy (house rule)", "skipped", e instanceof Error ? e.message : String(e)); }

    for (const b of blockers) step("validate_" + steps.length, "Pre-publish check", "skipped", b);
    if (blockers.length === 0) step("validate", "Pre-publish checks (5)", "done", "single schema, unique ids, live prices, no Q1/Q2 bleed, live handles");

    // ── Meta ─────────────────────────────────────────────────────────────────
    // RESPECT any existing hand-written title tag regardless of format —
    // colon-style tags ("Air Purifiers: HEPA & Large Room...") are valid.
    // When there is no real tag: use the AI-written one (pk-first, concrete
    // differentiator, NO store-name suffix per Ryan Aug 3), else title-case pk.
    const hasRealTag = !!seoTitle && seoTitle.trim() !== "" && seoTitle.trim().toLowerCase() !== (collection.title || "").trim().toLowerCase();
    const aiTitle = stripEmDashes(String(g.seoTitle || "")).replace(/\s*[|\-–]\s*peak primal wellness\s*$/i, "").trim();
    // Rule (25 Oct 2026): a generated title always leads with the primary keyword and never carries a price.
    const newSeoTitle = hasRealTag
      ? seoTitle
      : enforceTitleRules(aiTitle.length >= 20 ? aiTitle : isBrand ? `${brandName} ${catLabel}` : pk.replace(/\b\w/g, (c) => c.toUpperCase()), isBrand && brandName ? `${brandName} ${catLabel}` : pk);
    // Generated meta description: price range in, shipping claims out (rule:
    // free shipping varies by product, never a meta focus). Deterministic
    // guard strips any shipping mention the AI sneaks in; falls back to the
    // existing description if the result comes out too short.
    let newSeoDescription = stripEmDashes(String(g.seoDescription || ""))
      .replace(/[^.!?]*\b(free|fast)?\s*(shipping|freight|delivery)\b[^.!?]*[.!?]?/gi, "")
      .replace(/\s{2,}/g, " ").trim();
    if (newSeoDescription.length < 100) newSeoDescription = seoDescription;
    // ENFORCE primary keyword within the first 60 chars — if the AI buried
    // it, prefix deterministically (title-case pk + colon) and trim to length.
    if (newSeoDescription && keywordCoverage(newSeoDescription.slice(0, 70), [pk]).missing.length > 0) {
      const pkTitle = pk.replace(/\b\w/g, (c) => c.toUpperCase());
      let prefixed = `${pkTitle}: ${newSeoDescription.charAt(0).toLowerCase()}${newSeoDescription.slice(1)}`;
      if (prefixed.length > 160) prefixed = prefixed.slice(0, 160).replace(/\s+\S*$/, "").replace(/[,;:]$/, "") + ".";
      newSeoDescription = prefixed;
      step("meta_pk", "Meta description keyword", "done", `primary keyword was not in the first 60 chars — prefixed "${pkTitle}:"`);
    }
    step("meta", "Meta title", "done", newSeoTitle);

    // ── Score ────────────────────────────────────────────────────────────────
    const sgB = gradeCollection({ title: collection.title, seoTitle, seoDescription, bodyHtml: bodyBefore, productCount: products.length, primaryKeyword: pk, isBrand });
    const seoB = computeSeoGrade({ body_html: bodyBefore, seo_title: seoTitle, seo_description: seoDescription, primary_keyword: pk, keywords: [pk, ...secondaries] });
    const scoreBefore = Math.round(seoB.total * 0.5 + sgB.score * 0.5);
    const sgA = gradeCollection({ title: collection.title, seoTitle: newSeoTitle, seoDescription: newSeoDescription, bodyHtml: body, productCount: products.length, primaryKeyword: pk, isBrand });
    const seoA = computeSeoGrade({ body_html: body, seo_title: newSeoTitle, seo_description: newSeoDescription, primary_keyword: pk, keywords: [pk, ...secondaries] });
    const scoreAfter = Math.round(seoA.total * 0.5 + sgA.score * 0.5);

    // ── Draft persistence (shared with Improve flow) ─────────────────────────
    const manual = blockers;
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS collection_improve_drafts (
          slug TEXT PRIMARY KEY, title TEXT, body_html TEXT, seo_title TEXT, seo_description TEXT,
          plan JSONB, manual_items JSONB, score_before INTEGER, score_after INTEGER, created_at TIMESTAMPTZ DEFAULT now()
        )`;
      await sql`
        INSERT INTO collection_improve_drafts (slug, title, body_html, seo_title, seo_description, plan, manual_items, score_before, score_after, created_at)
        VALUES (${slug}, ${collection.title}, ${body}, ${newSeoTitle}, ${newSeoDescription}, ${JSON.stringify({ plan, steps })}, ${JSON.stringify(manual)}, ${scoreBefore}, ${scoreAfter}, now())
        ON CONFLICT (slug) DO UPDATE SET
          title = ${collection.title}, body_html = ${body}, seo_title = ${newSeoTitle}, seo_description = ${newSeoDescription},
          plan = ${JSON.stringify({ plan, steps })}, manual_items = ${JSON.stringify(manual)}, score_before = ${scoreBefore}, score_after = ${scoreAfter}, created_at = now()
      `;
      const leftovers = { skipped: steps.filter((st) => st.status === "skipped").map((st) => `${st.label}${st.detail ? ` — ${st.detail}` : ""}`), manual, at: new Date().toISOString() };
      await sql`UPDATE gtd_collections SET improve_notes = ${JSON.stringify(leftovers)} WHERE slug = ${slug}`;
    } catch (dErr) {
      console.error("[collections/generate] draft save failed:", dErr);
    }

    return NextResponse.json({
      slug,
      title: collection.title,
      mode: "generate",
      template: isBrand ? "brand" : "category",
      plan,
      steps,
      manualItems: manual,
      researchLog,
      scoreBefore,
      scoreAfter,
      bodyHtml: body,
      seoTitle: newSeoTitle,
      seoDescription: newSeoDescription,
      changed: true,
      blockers,
    });
  } catch (error) {
    console.error("[collections/generate] Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Generate failed" }, { status: 500 });
  }
}
