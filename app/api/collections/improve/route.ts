import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ensureCollectionColumns } from "@/lib/ensureCollectionColumns";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import { gradeCollection } from "@/lib/collectionGrade";
import { computeSeoGrade } from "@/lib/seoGrade";
import { enforceTitleRules, metaSpec, titleSpec } from "@/lib/keyword-audit";
import { stripPricesFromHtml } from "@/lib/keyword-content-prices";
import { callAI } from "@/lib/ai";
import { WRITING_RULES, stripEmDashes } from "@/lib/brandRules";

// Em-dash strip for generated fragments. The first-H2 separator em dash is
// re-inserted by the H2 spec itself, so a plain strip is safe for fragments.
const stripEmDashesKeep = (h: string) => (/^[^<]*—[^<]*$/.test(h.trim()) ? h : stripEmDashes(h));
import { COLLECTION_TO_CATEGORY } from "@/lib/collections";
import { fetchAdminProducts } from "@/lib/shopify/products-admin";
import { BRAND_COLLECTIONS } from "@/lib/collection-link-map";
import {
  blocksOf, findBlock, replaceBlock, removeBlock, insertAfterBlock,
  extractFaqItems, cloneFaqItem, extractAndStripSchema, buildUnifiedSchema,
} from "@/lib/collection-improve-engine";
import { enforceTasks, buildSchemaForTasks } from "@/lib/collection-task-enforcer";

/**
 * POST /api/collections/improve   Body: { slug }
 *
 * EXPAND, don't scrap: grades the live collection against
 * docs/GTD_Collection_Page_Rules.md, then generates ONLY the missing or
 * broken pieces (sections, meta, FAQ top-up, schema sync) using live product
 * data. Existing copy is preserved untouched apart from a deterministic
 * em-dash cleanup. Returns a preview; the UI publishes via the existing
 * PUT /api/shopify/collection-revamp/[handle] and re-grades.
 */

export const maxDuration = 300;

async function ensureDraftsTable(sql: ReturnType<typeof getSQL>) {
  await sql`
    CREATE TABLE IF NOT EXISTS collection_improve_drafts (
      slug TEXT PRIMARY KEY,
      title TEXT,
      body_html TEXT,
      seo_title TEXT,
      seo_description TEXT,
      plan JSONB,
      manual_items JSONB,
      score_before INTEGER,
      score_after INTEGER,
      created_at TIMESTAMPTZ DEFAULT now()
    )`;
}

/** GET ?list=1 -> slugs with drafts; GET ?slug=x -> the stored draft. */
export async function GET(request: NextRequest) {
  try {
    const sql = getSQL();
    await ensureDraftsTable(sql);
    const { searchParams } = new URL(request.url);
    if (searchParams.get("list")) {
      const rows = (await sql`SELECT slug FROM collection_improve_drafts`) as Array<{ slug: string }>;
      return NextResponse.json({ slugs: rows.map((r) => r.slug) });
    }
    const slug = searchParams.get("slug");
    if (!slug) return NextResponse.json({ error: "slug or list required" }, { status: 400 });
    const rows = (await sql`SELECT * FROM collection_improve_drafts WHERE slug = ${slug}`) as Array<Record<string, unknown>>;
    if (!rows[0]) return NextResponse.json({ error: "no draft" }, { status: 404 });
    const d = rows[0];
    return NextResponse.json({
      slug, title: d.title, bodyHtml: d.body_html, seoTitle: d.seo_title, seoDescription: d.seo_description,
      plan: (d.plan as any)?.plan ?? d.plan ?? [], steps: (d.plan as any)?.steps ?? [], manualItems: d.manual_items || [], scoreBefore: d.score_before, scoreAfter: d.score_after,
      changed: true, fromDraft: true, createdAt: d.created_at,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "draft read failed" }, { status: 500 });
  }
}

/** DELETE ?slug=x -> discard a draft (after publish, or deliberately). */
export async function DELETE(request: NextRequest) {
  try {
    const sql = getSQL();
    await ensureDraftsTable(sql);
    const params = new URL(request.url).searchParams;
    if (params.get("all")) {
      const rows = (await sql`DELETE FROM collection_improve_drafts RETURNING slug`) as Array<{ slug: string }>;
      // leftover-notes banners describe the drafts we just deleted — clear them too
      try { await sql`UPDATE gtd_collections SET improve_notes = NULL WHERE improve_notes IS NOT NULL`; } catch { /* non-fatal */ }
      return NextResponse.json({ ok: true, deleted: rows.length });
    }
    const slug = params.get("slug");
    if (!slug) return NextResponse.json({ error: "slug or all=1 required" }, { status: 400 });
    await sql`DELETE FROM collection_improve_drafts WHERE slug = ${slug}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "draft delete failed" }, { status: 500 });
  }
}

const API_VERSION = "2024-10";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shopifyGet(path: string, token: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${API_VERSION}/${path}`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await sleep(Number(res.headers.get("retry-after") || 2) * 1000);
      continue;
    }
    return null;
  }
  return null;
}

function toText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Visible FAQ Q&A pairs in either markup style (details or accordion). */
function extractFaqPairs(html: string): { q: string; a: string }[] {
  const pairs: { q: string; a: string }[] = [];
  for (const m of html.matchAll(/<details[^>]*>[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi)) {
    pairs.push({ q: toText(m[1]), a: toText(m[2]) });
  }
  for (const m of html.matchAll(/<button[^>]*gtd-acc-btn[^>]*>([\s\S]*?)<\/button>\s*<div[^>]*gtd-acc-panel[^>]*>([\s\S]*?)<\/div>/gi)) {
    pairs.push({ q: toText(m[1]).replace(/[+−]\s*$/, "").trim(), a: toText(m[2]) });
  }
  return pairs.filter((p) => p.q);
}

function buildFaqSchema(pairs: { q: string; a: string }[]): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((p) => ({
      "@type": "Question",
      name: p.q,
      acceptedAnswer: { "@type": "Answer", text: p.a.split(/\s+/).slice(0, 200).join(" ") },
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

export async function POST(request: NextRequest) {
  try {
    const { slug } = await request.json();
    if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });

    const sql = getSQL();
    const token = await getShopifyAccessToken();

    // ── Load collection + keywords + products ────────────────────────────────
    let collection: any = null;
    for (const type of ["custom", "smart"] as const) {
      const d = await shopifyGet(`${type}_collections.json?handle=${encodeURIComponent(slug)}&limit=1`, token);
      const hit = d?.[`${type}_collections`]?.[0];
      if (hit) { collection = hit; break; }
      await sleep(600);
    }
    if (!collection) return NextResponse.json({ error: `Collection '${slug}' not found on Shopify` }, { status: 404 });

    const mf = await shopifyGet(`collections/${collection.id}/metafields.json`, token);
    const metafields: Array<{ namespace: string; key: string; value: string }> = mf?.metafields || [];
    const seoTitle = metafields.find((m) => m.namespace === "global" && m.key === "title_tag")?.value || collection.title || "";
    const seoDescription = metafields.find((m) => m.namespace === "global" && m.key === "description_tag")?.value || "";

    const kwRow = (await sql`SELECT primary_keyword, secondary_keywords, collection_type, category FROM gtd_collections WHERE slug = ${slug}`) as Array<{ primary_keyword: string | null; secondary_keywords: unknown; collection_type: string | null; category?: string | null }>;
    const hubCategory: string | null = kwRow[0]?.category ?? null;
    const isBrand = (kwRow[0]?.collection_type || "").toLowerCase() === "brand" || BRAND_COLLECTIONS.some((b) => b.handle === slug);
    const brandEntry = BRAND_COLLECTIONS.find((b) => b.handle === slug);
    const pk = kwRow[0]?.primary_keyword || collection.title || "";
    let secondaries: string[] = [];
    try {
      const raw = kwRow[0]?.secondary_keywords;
      secondaries = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? JSON.parse(raw) : [];
    } catch { /* none */ }

    await sleep(600);
    // v2 pattern: live product data via the shared Admin reader (active products
    // only, normalized shape) — same plumbing the article pipelines use.
    const products = await fetchAdminProducts({ collectionHandle: slug, limit: 50 });
    const brands = [...new Set(products.map((p) => p.vendor).filter(Boolean))];
    const brandName = isBrand ? (brandEntry?.name || brands[0] || collection.title.split(" ").slice(0, 2).join(" ")) : null;
    // Competitor pool for brand Q2: doc brands + every live product vendor,
    // so weekly-onboarded brands are usable immediately.
    let vendorNames: string[] = [];
    try {
      const vRows = (await sql`SELECT DISTINCT vendor FROM products WHERE vendor IS NOT NULL AND vendor <> ''`) as Array<{ vendor: string }>;
      vendorNames = vRows.map((r) => r.vendor);
    } catch { /* optional */ }
    const allBrandNames = [...new Set([...BRAND_COLLECTIONS.map((b) => b.name), ...vendorNames])];
    const prices = products
      .map((p) => parseFloat(p.price))
      .filter((n) => Number.isFinite(n) && n > 0);
    const priceMin = prices.length ? Math.min(...prices) : null;
    const priceMax = prices.length ? Math.max(...prices) : null;
    const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

    // ── Grade to find the gaps ───────────────────────────────────────────────
    const bodyBefore = collection.body_html || "";
    const sg = gradeCollection({ title: collection.title, seoTitle, seoDescription, bodyHtml: bodyBefore, productCount: products.length, primaryKeyword: pk, isBrand });
    const seo = computeSeoGrade({ body_html: bodyBefore, seo_title: seoTitle, seo_description: seoDescription, primary_keyword: pk, keywords: [pk, ...secondaries] });
    const scoreBefore = Math.round(seo.total * 0.5 + sg.score * 0.5);

    const failing = new Set(sg.checks.filter((c) => c.status !== "pass").map((c) => c.id));

    // Full pipeline checklist — every intended step reports whether it was
    // followed, so the preview shows compliance per rule, not just a diff.
    type StepStatus = "done" | "not-needed" | "skipped" | "manual";
    const steps: { id: string; label: string; status: StepStatus; detail: string }[] = [];
    const step = (id: string, label: string, status: StepStatus, detail = "") =>
      steps.push({ id, label, status, detail });
    const faqPairs = extractFaqPairs(bodyBefore);
    const plan: string[] = [];

    // ── Learning Center source articles (deterministic, from articles DB) ────
    const category = COLLECTION_TO_CATEGORY[slug] || slug;
    const articles = (await sql`
      SELECT title, slug FROM articles WHERE category = ${category} AND status = 'published'
      ORDER BY created_at DESC LIMIT 6
    `) as Array<{ title: string; slug: string }>;

    // ── Section-replacement generation (see eval doc) ────────────────────────
    // Every rewrite receives the ORIGINAL section HTML and must return a full
    // replacement preserving the exact wrapper tag and every class name, so
    // the page's own CSS keeps working. Nothing is appended below existing
    // versions of a section — blocks are swapped in place.
    const blocks = blocksOf(bodyBefore);
    const buyingBlock = findBlock(blocks, /buying guide/i);
    const benefitsBlock = findBlock(blocks, /key benefits/i);
    const careBlock = findBlock(blocks, /care|warranty|maintenance/i);
    const faqBlock = findBlock(blocks, /frequently asked|faq/i);
    const featuredBlock = findBlock(blocks, /featured|types|picks/i);
    const learningBlock = findBlock(blocks, /learning center|resources/i);
    const compareBlock = findBlock(blocks, /compare/i);

    const { items: faqItems } = faqBlock ? extractFaqItems(faqBlock.html) : { items: [] as { html: string; q: string; a: string }[] };
    const q1Bad = faqItems.length > 0 && !/^what is the best/i.test(faqItems[0].q);
    const q2Bad = faqItems.length > 1 && !/compare/i.test(faqItems[1].q);
    const faqNeeded = Math.max(0, 12 - faqItems.length);

    const wants: string[] = [];
    if (failing.has("buying_guide") && buyingBlock) wants.push("buying_guide");
    if (failing.has("key_benefits") && benefitsBlock) wants.push("key_benefits");
    if (failing.has("care_structure") && careBlock) wants.push("care");
    if ((failing.has("buying_guide") && !buyingBlock) || (failing.has("key_benefits") && !benefitsBlock) || (failing.has("care_structure") && !careBlock)) wants.push("new_sections");
    let auditOwnsMeta = false;
    try {
      const ka = (await sql`SELECT applied_shopify_at FROM collection_keyword_research WHERE slug = ${slug}`) as Array<{ applied_shopify_at: string | null }>;
      auditOwnsMeta = !!ka[0]?.applied_shopify_at;
    } catch { /* table may not exist yet */ }
    if ((failing.has("meta_title") || failing.has("meta_description")) && !auditOwnsMeta) wants.push("meta");
    if (failing.has("first_h2")) wants.push("first_h2");
    if (failing.has("intro_rules")) wants.push("intro");
    if (failing.has("overview_bullets")) wants.push("bullets");
    if (q1Bad || q2Bad) wants.push("faq_q1q2");
    if (faqNeeded > 0) wants.push("faq_new");
    // The 14-task enforcer verifies compliance itself and needs material to
    // apply, so always generate these regardless of what the grader thought.
    for (const k of ["meta", "intro", "bullets", "faq_q1q2"]) if (!wants.includes(k)) wants.push(k);

    const catLabel = collection.title.replace(/ for sale.*/i, "");
    const firstBlock = blocks[0] || null;
    const firstH2Match = bodyBefore.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const introPMatch = firstH2Match
      ? bodyBefore.slice(bodyBefore.indexOf(firstH2Match[0])).match(/<p[^>]*>[\s\S]*?<\/p>/i)
      : bodyBefore.match(/<p[^>]*>[\s\S]*?<\/p>/i);
    const firstUlMatch = bodyBefore.match(/<ul[^>]*>[\s\S]*?<\/ul>/i);

    let gen: any = {};
    if (wants.length > 0) {
      const system = `You are the senior SEO copywriter at Green Thumb Depot, a premium wellness equipment retailer. You rewrite collection-page sections following the GTD Collection Page Rules exactly.
${WRITING_RULES}
NON-NEGOTIABLE OUTPUT RULES:
- When given ORIGINAL HTML for a section, return the COMPLETE replacement using the SAME outer wrapper tag and EVERY class name from the original. Change text and inner structure only as the spec requires. Never invent new class names.
- Colons (not dashes) as bullet label separators; "to" for ranges ("$4,495 to $21,995"); no em dashes anywhere except the single first-H2 separator; never start a sentence with "Discover".
- Every sentence must carry a brand, keyword, feature, or trust signal.
- NEVER write a dollar figure, price range, "from $X" or "under $X". Prices change and sales come and go; the product grid shows live prices. Describe cost qualitatively.`;

      const specs: string[] = [];
      if (wants.includes("first_h2") && firstH2Match) specs.push(`"first_h2": rewrite this H2's inner text to the format "[Keyword Variant] — [Differentiator]" containing "${pk}" and a real brand or product type, no price. Return ONLY the inner text (no tags). Current: ${JSON.stringify(stripEmDashesKeep(firstH2Match[1]))}`);
      if (wants.includes("intro") && introPMatch) specs.push(`"intro": rewrite this intro paragraph: brands (${brands.slice(0, 3).join(", ")}) named in the first two sentences, no price figure, zero filler sentences. Return the full <p> element with the ORIGINAL tag attributes. Original: ${JSON.stringify(introPMatch[0].slice(0, 900))}`);
      if (wants.includes("bullets") && firstUlMatch) specs.push(`"bullets": rewrite this <ul> to exactly six <li> covering in order: ${isBrand ? "1 entry model BY NAME (no price), 2 flagship model BY NAME (no price), 3 brand certification/manufacturing signal, 4 athletic use case, 5 lifestyle/home setup use case, 6 brand warranty/support differentiator" : "1 entry product BY NAME (no price), 2 premium product BY NAME (no price), 3 certification/regulatory signal, 4 athletic use case, 5 wellness/longevity use case, 6 support differentiator"}. Each li starts <strong>Label:</strong>. Keep the original ul/li classes. Original: ${JSON.stringify(firstUlMatch[0].slice(0, 1200))}`);
      if (wants.includes("buying_guide") && buyingBlock) specs.push(`"buying_guide": full replacement of this section. 3 cards only, H3 headings verb+noun, exactly 3 bullets per card with <strong>Label:</strong>, reference real models (${products.slice(0, 6).map((p) => p.title).join("; ")}). SAME wrapper + classes. Original: ${JSON.stringify(buyingBlock.html.slice(0, 2500))}`);
      if (wants.includes("key_benefits") && benefitsBlock) specs.push(`"key_benefits": full replacement. Exactly 4 cards: emoji, H3 naming the OUTCOME, 3-4 sentences each mentioning "${pk}" or the category. SAME wrapper + classes. Original: ${JSON.stringify(benefitsBlock.html.slice(0, 2500))}`);
      if (wants.includes("care") && careBlock) specs.push(`"care": full replacement. Three H3 subsections "Cleaning and Daily Care", "Routine Maintenance", "Warranty Coverage", each a <ul> max 5 bullets with <strong>Label:</strong>${isBrand ? `. Warranty Coverage MUST state ${brandName}'s actual coverage periods and what is covered, never "see product pages"` : `, brand-specific warranty facts where known (${brands.join(", ")})`}. SAME wrapper + classes. Original: ${JSON.stringify(careBlock.html.slice(0, 2500))}`);
      if (wants.includes("new_sections")) specs.push(`"new_sections": object with any of keys buying_guide/key_benefits/care that do NOT exist on the page yet (missing: ${["buying_guide","key_benefits","care"].filter((k) => (k === "buying_guide" && !buyingBlock) || (k === "key_benefits" && !benefitsBlock) || (k === "care" && !careBlock)).join(", ")}). Build each as a <section> reusing the page's existing section classes (reference structure: ${JSON.stringify((firstBlock?.html || "").slice(0, 600))}).`);
      if (wants.includes("meta")) specs.push(`"meta": { "title": ${JSON.stringify(titleSpec(isBrand && brandName ? `${brandName} ${catLabel}` : pk))}, "description": ${JSON.stringify(metaSpec({ primary: isBrand && brandName ? `${brandName} ${catLabel}` : pk, hub: hubCategory, isBrand, brandName, vendors: brands as string[], prices })) } }`);
      if (wants.includes("faq_q1q2")) specs.push(isBrand
        ? `"faq_q1q2": { "q1": { "q": "What is the best ${brandName} ${catLabel.toLowerCase()}?", "a": recommend 2-3 specific ${brandName} models with brief rationale, 50-90 words }, "q2": { "q": "How does ${brandName} compare to [pick 2 honest competitors from: ${allBrandNames.filter((b) => b !== brandName).slice(0, 20).join(", ")}]?", "a": genuine buyer-useful comparison covering key differentiators, not marketing copy, 50-90 words } }`
        : `"faq_q1q2": { "q1": { "q": "What is the best ${pk}?", "a": 50-90 word answer naming real models }, "q2": { "q": brand comparison question using ${brands.slice(0, 3).join(", ")}, "a": 50-90 word comparison } }`);
      if (isBrand) specs.push(`"brand_description": 2-3 sentence description of ${brandName} covering what they make and their key differentiator (for Brand schema)`);
      if (wants.includes("faq_new")) specs.push(`"faq_new": array of exactly ${Math.min(faqNeeded, 14 - faqItems.length)} {"q","a"} (40-90 word answers) covering topics NOT already asked. Existing questions: ${faqItems.map((i) => i.q).join(" | ") || "none"}`);

      const user = `Collection: "${collection.title}" (primary keyword: "${pk}")
Secondary keywords: ${secondaries.join(", ") || "none"}
Brands carried: ${brands.join(", ") || "unknown"}
Prices: do not quote any.

Return ONE JSON object (no markdown fences) with ONLY these keys:
${specs.join("\n\n")}`;

      const raw = await callAI(system, user, { maxTokens: 8000, timeoutMs: 280000 });
      const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      try {
        gen = JSON.parse(cleaned);
      } catch {
        const s0 = cleaned.indexOf("{"); const e0 = cleaned.lastIndexOf("}");
        if (s0 >= 0 && e0 > s0) gen = JSON.parse(cleaned.slice(s0, e0 + 1));
      }
    }

    // ── Assemble: REPLACE in place, never append duplicates ──────────────────
    let body = bodyBefore;
    const put = (label: string) => plan.push(label);

    // Checklist entries for stages resolved before assembly.
    step("keywords", "Keywords loaded (primary + secondaries feed generation)", "done", `${pk}${secondaries.length ? ` + ${secondaries.length} secondaries` : ""}`);

    // Section replacements (recompute blocks after each splice).
    const swapSection = (re: RegExp, html: string | undefined, label: string) => {
      if (!html || typeof html !== "string" || !/<(section|div|h2)/i.test(html)) return;
      const blk = findBlock(blocksOf(body), re);
      if (blk) {
        body = replaceBlock(body, blk, stripEmDashesKeep(html));
        put(`Replaced ${label} section in place`);
      }
    };
    const trackSwap = (id: string, label: string, wanted: boolean, genHtml: unknown, re: RegExp) => {
      if (!wanted) { step(id, label, "not-needed", "passed the grader already"); return; }
      const before = body;
      swapSection(re, genHtml as string | undefined, label);
      step(id, label, body !== before ? "done" : "skipped", body !== before ? "replaced in place, original classes kept" : "generation missing or section not found");
    };
    trackSwap("buying_guide", "Buying Guide: 3 cards, verb+noun headings", wants.includes("buying_guide"), gen.buying_guide, /buying guide/i);
    trackSwap("key_benefits", "Key Benefits: 4 cards with emoji + outcomes", wants.includes("key_benefits"), gen.key_benefits, /key benefits/i);
    trackSwap("care", "Care: Cleaning/Maintenance/Warranty H3s", wants.includes("care"), gen.care, /care|warranty|maintenance/i);

    // Brand-new sections (only those genuinely absent) go after the featured/FAQ area.
    if (gen.new_sections && typeof gen.new_sections === "object") {
      for (const key of ["buying_guide", "key_benefits", "care"]) {
        const htmlPiece = gen.new_sections[key];
        if (!htmlPiece || findBlock(blocksOf(body), key === "buying_guide" ? /buying guide/i : key === "key_benefits" ? /key benefits/i : /care|warranty/i)) continue;
        const anchor = findBlock(blocksOf(body), /featured|types|picks/i) || findBlock(blocksOf(body), /frequently asked|faq/i);
        body = anchor ? insertAfterBlock(body, anchor, stripEmDashesKeep(String(htmlPiece))) : body + "\n" + stripEmDashesKeep(String(htmlPiece));
        put(`Added missing ${key.replace("_", " ")} section`);
      }
    }

    // First H2 text swap (tag + attributes untouched).
    if (!wants.includes("first_h2")) step("first_h2", "First H2: [Keyword] — [Differentiator]", "not-needed", "already compliant");
    else if (gen.first_h2 && typeof gen.first_h2 === "string" && firstH2Match) {
      body = body.replace(firstH2Match[0], () => firstH2Match[0].replace(firstH2Match[1], () => gen.first_h2));
      put(`First H2 rewritten: "${gen.first_h2.slice(0, 70)}"`);
      step("first_h2", "First H2: [Keyword] — [Differentiator]", "done", gen.first_h2.slice(0, 80));
    } else step("first_h2", "First H2: [Keyword] — [Differentiator]", "skipped", "no rewrite returned");
    // Intro paragraph swap.
    if (!wants.includes("intro")) step("intro", "Intro: brands in first 2 sentences + price anchor", "not-needed", "already compliant");
    else if (gen.intro && typeof gen.intro === "string" && introPMatch && /<p/i.test(gen.intro)) {
      body = body.replace(introPMatch[0], () => stripEmDashesKeep(gen.intro));
      put("Intro paragraph rewritten (brands, no price)");
      step("intro", "Intro: brands in first 2 sentences + price anchor", "done");
    } else step("intro", "Intro: brands in first 2 sentences + price anchor", "skipped", "no rewrite returned");
    // Bullets swap.
    if (!wants.includes("bullets")) step("bullets", "Overview bullets: six required slots with prices", "not-needed", "already compliant");
    else if (gen.bullets && typeof gen.bullets === "string" && firstUlMatch && /<li/i.test(gen.bullets)) {
      body = body.replace(firstUlMatch[0], () => stripEmDashesKeep(gen.bullets));
      put("Overview bullets rebuilt to the six-slot structure");
      step("bullets", "Overview bullets: six required slots with prices", "done");
    } else step("bullets", "Overview bullets: six required slots with prices", "skipped", "no rewrite returned");

    // FAQ: replace Q1/Q2 in place and append new items INSIDE the container,
    // cloning the page's own item markup so styling carries over.
    {
      const blk = findBlock(blocksOf(body), /frequently asked|faq/i);
      if (blk) {
        const { items } = extractFaqItems(blk.html);
        let faqHtml = blk.html;
        if (items.length > 0) {
          const template = items[0].html;
          if (gen.faq_q1q2?.q1?.q && items[0]) {
            faqHtml = faqHtml.replace(items[0].html, () => cloneFaqItem(template, gen.faq_q1q2.q1.q, gen.faq_q1q2.q1.a || ""));
            put(`FAQ Q1 replaced with commercial-intent question`);
          }
          if (gen.faq_q1q2?.q2?.q && items[1]) {
            faqHtml = faqHtml.replace(items[1].html, () => cloneFaqItem(template, gen.faq_q1q2.q2.q, gen.faq_q1q2.q2.a || ""));
            put(`FAQ Q2 replaced with brand comparison`);
          }
          if (Array.isArray(gen.faq_new) && gen.faq_new.length > 0) {
            const lastItem = items[items.length - 1].html;
            const additions = gen.faq_new
              .filter((f: any) => f?.q && f?.a)
              .map((f: any) => cloneFaqItem(template, String(f.q), String(f.a)))
              .join("\n");
            faqHtml = faqHtml.replace(lastItem, () => lastItem + "\n" + additions);
            put(`FAQ: ${gen.faq_new.length} question(s) added using the page's own item markup`);
          }
          body = replaceBlock(body, blk, faqHtml);
        }
      }
      const q1q2Wanted = wants.includes("faq_q1q2");
      const q1q2Done = plan.some((x) => x.includes("FAQ Q1") || x.includes("FAQ Q2"));
      step("faq_q1q2", "FAQ Q1/Q2: commercial intent + brand comparison (replaced, not appended)", q1q2Wanted ? (q1q2Done ? "done" : "skipped") : "not-needed", q1q2Wanted && !q1q2Done ? "no replacement returned or FAQ items not found" : "");
      const newWanted = wants.includes("faq_new");
      const newDone = plan.some((x) => x.includes("question(s) added using the page's own item markup"));
      step("faq_topup", "FAQ topped up to 12-14 using the page's own item markup", newWanted ? (newDone ? "done" : "skipped") : "not-needed", "");
    }

    // Comparison-table removal moved into the 14-task enforcer (T8) so the
    // section and its nav link are always removed as a PAIRED operation.

    // Learning Center (deterministic, from articles DB) — inserted after the
    // featured/types section, styled with a wrapper cloned from the page.
    if (!findBlock(blocksOf(body), /learning center|resources/i) && articles.length >= 1) {
      const [pillar, ...rest] = articles;
      const cluster = rest.slice(0, 3);
      const wrapperClass = (blocksOf(body)[0]?.html.match(/<section\b[^>]*class="([^"]*)"/i)?.[1]) || "";
      const lc = `<section${wrapperClass ? ` class="${wrapperClass}"` : ""}><h2>Complete ${catLabel} Learning Center</h2>
<p><a href="/blogs/guides/${pillar.slug}"><strong>${pillar.title}</strong></a></p>
<ul>
${cluster.map((a) => `<li><a href="/blogs/guides/${a.slug}">${a.title}</a></li>`).join("\n")}
</ul></section>`;
      const anchor = findBlock(blocksOf(body), /featured|types|picks/i) || findBlock(blocksOf(body), /frequently asked|faq/i);
      body = anchor ? insertAfterBlock(body, anchor, lc) : body + "\n" + lc;
      put(`Added Complete ${catLabel} Learning Center (${1 + cluster.length} article links)`);
      step("learning_center", "Complete [Category] Learning Center with 4 article links", "done", `${1 + cluster.length} links`);
    } else if (findBlock(blocksOf(body), /learning center|resources/i)) {
      step("learning_center", "Complete [Category] Learning Center with 4 article links", "not-needed", "already present");
    } else {
      step("learning_center", "Complete [Category] Learning Center with 4 article links", "skipped", `only ${articles.length} published article(s) found for category ${category}`);
    }

    // Deterministic em-dash cleanup outside the first H2.
    {
      const h2Now = body.match(/<h2[^>]*>[\s\S]*?<\/h2>/i)?.[0] || "";
      const ph = "___FIRSTH2___";
      if (h2Now) body = body.replace(h2Now, ph);
      const n = (body.replace(/<script[\s\S]*?<\/script>/gi, "").match(/—/g) || []).length;
      if (n > 0) {
        body = body.replace(/\s*—\s*/g, ", ");
        put(`Removed ${n} em dash(es) outside the first H2`);
        step("em_dashes", "Em dashes removed everywhere except the first H2", "done", `${n} removed`);
      } else step("em_dashes", "Em dashes removed everywhere except the first H2", "not-needed", "none found");
      if (h2Now) body = body.replace(ph, h2Now);
    }

    // ── Featured Products: BUILD from live products when the page has none ──
    // Root cause of T6/T11 failures on sparse pages: nothing to sync or add
    // CTAs to. Four .gtd-type tiles spanning entry -> premium, inserted
    // between the overview and the FAQ.
    {
      const blksNow = blocksOf(body);
      const hasTiles = /class="[^"]*gtd-type/i.test(body) || blksNow.some((b) => /featured|types|picks/i.test(b.heading) && /\/products\//.test(b.html));
      const priced = products
        .map((pr) => ({ ...pr, priceNum: parseFloat(pr.price) }))
        .filter((pr) => Number.isFinite(pr.priceNum) && pr.priceNum > 0)
        .sort((a, b) => a.priceNum - b.priceNum);
      if (!hasTiles && priced.length >= 2) {
        const pickAt = (r: number) => priced[Math.min(priced.length - 1, Math.round(r * (priced.length - 1)))];
        const seen = new Set<string>();
        const tiers = [pickAt(0), pickAt(0.4), pickAt(0.72), pickAt(1)].filter((t) => !seen.has(t.handle) && seen.add(t.handle));
        const CTA = `<span style="display:block;margin-top:.75rem;padding:.6rem 1rem;background:#1E40AF;color:#fff;border-radius:8px;text-align:center;font-weight:700;font-size:.9rem;">View Product Details &rarr;</span>`;
        const shortDesc = (d: string) => d.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(/\s+/).slice(0, 18).join(" ");
        const tiles = tiers.map((t) => `<a class="gtd-type" href="/products/${t.handle}" style="display:block;text-decoration:none;color:inherit;border:1px solid #e2e2e2;border-radius:10px;padding:14px;background:#fff">
<div class="gtd-type__img">${t.imageUrl ? `<img src="${t.imageUrl}" alt="${t.title}" style="width:100%;border-radius:8px" loading="lazy" />` : ""}</div>
<strong style="display:block;margin-top:8px">${t.title}</strong>
<span style="display:block;margin-top:4px;font-weight:600">${fmt(t.priceNum)}</span>
<p style="font-size:.9rem;margin:.5rem 0 0;color:#444">${shortDesc(t.description || "")}</p>
${CTA}</a>`).join("\n");
        const wrapperClass = blksNow[0]?.html.match(/<section\b[^>]*class="([^"]*)"/i)?.[1] || "";
        const section = `<section${wrapperClass ? ` class="${wrapperClass}"` : ""} id="featured-products"><h2>Featured ${catLabel}</h2>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">
${tiles}
</div></section>`;
        const overviewBlk = blksNow[0] || null;
        body = overviewBlk ? insertAfterBlock(body, overviewBlk, section) : section + "\n" + body;
        plan.push(`Built Featured Products section from live catalog (${tiers.length} tiles, entry to premium)`);
        step("featured_build", "Featured Products built from live product feed", "done", `${tiers.length} tiles with images, prices, CTAs`);
      } else {
        step("featured_build", "Featured Products built from live product feed", hasTiles ? "not-needed" : "skipped", hasTiles ? "tiles already present" : `only ${priced.length} priced product(s)`);
      }
    }

    // ── 14-task deterministic enforcement pass (docs/GTD_Collection_14_Tasks.md) ──
    // Verifies every rule on the FINAL html and fixes what it can; the AI is
    // never trusted to have complied.
    {
      const enforced = enforceTasks(body, {
        pk,
        catLabel,
        brands,
        priceMin,
        isBrand,
        brandName: brandName || undefined,
        allBrandNames,
        collectionUrl: `https://greenthumbdepot.com/collections/${slug}`,
        collectionTitle: collection.title,
        products: products.map((p) => ({ title: p.title, handle: p.handle, price: p.price, imageUrl: p.imageUrl })),
        gen: {
          faqQ1: gen.faq_q1q2?.q1 || null,
          faqQ2: gen.faq_q1q2?.q2 || null,
          intro: typeof gen.intro === "string" ? gen.intro : null,
          bullets: typeof gen.bullets === "string" ? gen.bullets : null,
          brandDescription: typeof gen.brand_description === "string" ? gen.brand_description : null,
        },
      });
      body = enforced.html;
      for (const r of enforced.results) {
        step(r.task, `${r.task} — ${r.label}`, r.status === "failed" ? "skipped" : r.status === "fixed" ? "done" : "not-needed", r.detail);
        if (r.status === "fixed") plan.push(`${r.task}: ${r.label} — ${r.detail}`);
      }

      // T9 retry: when buying-guide headings fail the verb check, rewrite
      // ONLY the headings with a targeted generation call, then re-verify.
      const t9 = enforced.results.find((r) => r.task === "T9");
      if (t9 && t9.status === "failed" && !/no buying guide/i.test(t9.detail)) {
        try {
          const bgBlk = findBlock(blocksOf(body), /buying guide/i);
          if (bgBlk) {
            const cards = [...bgBlk.html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]{0,400})/gi)]
              .map((m) => ({ heading: m[1].replace(/<[^>]+>/g, "").trim(), context: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200) }));
            const raw = await callAI(
              "You write buying-guide card headings. Each MUST start with an action verb (Define, Choose, Set, Assess, Select, Plan, Measure, Compare, Match, Decide).",
              `Rewrite each heading to start with an action verb matching the buyer decision in its card. Return ONLY a JSON array of strings, same order.\n${cards.map((c, i) => `${i + 1}. "${c.heading}" (card content: ${c.context})`).join("\n")}`,
              { maxTokens: 500 }
            );
            const cleaned = raw.trim().replace(/^\x60{3}(json)?/i, "").replace(/\x60{3}$/, "").trim();
            const newHeads = JSON.parse(cleaned);
            if (Array.isArray(newHeads) && newHeads.length === cards.length) {
              let newBg = bgBlk.html;
              cards.forEach((c, i) => {
                const nh = String(newHeads[i]);
                if (/^[A-Z][a-z]+\s/.test(nh)) newBg = newBg.replace(c.heading, () => nh);
              });
              body = replaceBlock(body, bgBlk, newBg);
              t9.status = "fixed";
              t9.detail = `headings rewritten: ${newHeads.slice(0, 3).join("; ")}`;
              const stepT9 = steps.find((st) => st.id === "T9");
              if (stepT9) { stepT9.status = "done"; stepT9.detail = t9.detail; }
              plan.push(`T9: buying guide headings rewritten to verb-led (${newHeads.length})`);
            }
          }
        } catch (t9err) {
          console.warn("[improve] T9 heading rewrite failed:", t9err);
        }
      }

      // Schema (T5/T6/T13): strip everything, emit the one @graph.
      const stripped = extractAndStripSchema(body);
      body = stripped.html.trim();
      const finalBlk = findBlock(blocksOf(body), /frequently asked|faq/i);
      const finalPairs = finalBlk ? extractFaqItems(finalBlk.html).items.map((i) => ({ q: i.q, a: i.a })) : [];
      const schemaRes = buildSchemaForTasks(body, finalPairs, {
        collectionUrl: `https://greenthumbdepot.com/collections/${slug}`,
        collectionTitle: collection.title,
        catLabel,
        isBrand,
        brandName: brandName || undefined,
        brandDescription: typeof gen.brand_description === "string" ? gen.brand_description : null,
      });
      body += "\n" + schemaRes.schemaTag;
      for (const r of schemaRes.results) {
        step(r.task, `${r.task} — ${r.label}`, r.status === "failed" ? "skipped" : "done", r.detail);
        if (r.status !== "failed") plan.push(`${r.task}: ${r.label} — ${r.detail}`);
      }
    }

    const newSeoTitle = gen.meta?.title ? enforceTitleRules(stripEmDashesKeep(String(gen.meta.title)), isBrand && brandName ? `${brandName} ${catLabel}` : pk) : seoTitle;
    const newSeoDescription = gen.meta?.description ? stripEmDashesKeep(String(gen.meta.description)) : seoDescription;
    if (gen.meta?.title) plan.push(`Meta title: "${newSeoTitle}"`);
    if (gen.meta?.description) plan.push(`Meta description rewritten (${newSeoDescription.length} chars)`);
    step("meta_title", "Meta title: [keyword] | [signal], ≤60 chars", wants.includes("meta") ? (gen.meta?.title ? "done" : "skipped") : "not-needed", newSeoTitle.slice(0, 70));
    step("meta_description", "Meta description: 150-160, price anchor, brand, CTA", wants.includes("meta") ? (gen.meta?.description ? "done" : "skipped") : "not-needed", `${newSeoDescription.length} chars`);

    // Items the tool intentionally leaves to a human.
    const manual = sg.checks
      .filter((c) => c.status !== "pass" && ["banned_phrases", "featured_products"].includes(c.id))
      .map((c) => `${c.label}: ${c.detail}`);
    if (failing.has("featured_products")) manual.push("Product tiles: add live prices + \"View Product Details\" CTAs (page-specific markup — review layout before automating)");
    for (const m of manual) step("manual_" + steps.length, m.split(":")[0], "manual", m.split(":").slice(1).join(":").trim());

    const sgAfter = gradeCollection({ title: collection.title, seoTitle: newSeoTitle, seoDescription: newSeoDescription, bodyHtml: body, productCount: products.length, primaryKeyword: pk, isBrand });
    const seoAfter = computeSeoGrade({ body_html: body, seo_title: newSeoTitle, seo_description: newSeoDescription, primary_keyword: pk, keywords: [pk, ...secondaries] });
    const scoreAfter = Math.round(seoAfter.total * 0.5 + sgAfter.score * 0.5);

    // Persist leftover work to gtd_collections so the Revamp Tool shows it
    // even after the draft is published and deleted.
    try {
      await ensureCollectionColumns(sql);
      const leftovers = {
        skipped: steps.filter((st) => st.status === "skipped").map((st) => `${st.label}${st.detail ? ` — ${st.detail}` : ""}`),
        manual,
        at: new Date().toISOString(),
      };
      await sql`UPDATE gtd_collections SET improve_notes = ${JSON.stringify(leftovers)} WHERE slug = ${slug}`;
    } catch (nErr) {
      console.error("[collections/improve] notes save failed:", nErr);
    }

    // Persist as a draft — closing the preview never loses generated work.
    try {
      await ensureDraftsTable(sql);
      await sql`
        INSERT INTO collection_improve_drafts (slug, title, body_html, seo_title, seo_description, plan, manual_items, score_before, score_after, created_at)
        VALUES (${slug}, ${collection.title}, ${body}, ${newSeoTitle}, ${newSeoDescription}, ${JSON.stringify({ plan, steps })}, ${JSON.stringify(manual)}, ${scoreBefore}, ${scoreAfter}, now())
        ON CONFLICT (slug) DO UPDATE SET
          title = ${collection.title}, body_html = ${body}, seo_title = ${newSeoTitle}, seo_description = ${newSeoDescription},
          plan = ${JSON.stringify({ plan, steps })}, manual_items = ${JSON.stringify(manual)}, score_before = ${scoreBefore}, score_after = ${scoreAfter}, created_at = now()
      `;
    } catch (draftErr) {
      console.error("[collections/improve] draft save failed (result still returned):", draftErr);
    }

    return NextResponse.json({
      slug,
      title: collection.title,
      template: isBrand ? "brand" : "category",
      plan,
      steps,
      manualItems: manual,
      scoreBefore,
      scoreAfter,
      bodyHtml: body,
      seoTitle: newSeoTitle,
      seoDescription: newSeoDescription,
      changed: body !== bodyBefore || newSeoTitle !== seoTitle || newSeoDescription !== seoDescription,
    });
  } catch (error) {
    console.error("[collections/improve] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Improve failed" },
      { status: 500 }
    );
  }
}
