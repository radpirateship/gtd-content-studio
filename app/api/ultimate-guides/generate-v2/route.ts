// ============================================================================
// POST /api/ultimate-guides/generate-v2
//
// The guide pipeline on the blog v2 footing. One route, five actions, all
// keyed on the guide row the wizard sends:
//
//   picks      live Shopify products through the blog picker (price floor,
//              top-band cap, vendor and type caps, vendor exclusions)
//   section    one plan section: product brief + catalogue research + link
//              inventory in the prompt, then the full guard chain on the reply
//   takeaways  six takeaways as JSON, from a digest of every written section
//   faq        eight FAQ pairs as JSON, repaired the way the blog repairs them
//   meta       meta description and the deck line
//
// Nothing here names a product category. The plan briefs in lib/guide-v2.ts
// carry {topic}; the prompts below carry the guide's own words.
// ============================================================================

import { type NextRequest, NextResponse } from "next/server";
import { callAI, looksLikeReasoning } from "@/lib/ai";
import { WRITING_RULES, validateBrandRules, stripEmDashes, scrubUncarriedBrands, scrubSeoJargon } from "@/lib/brandRules";
import { repairBodyBlocks } from "@/lib/body-repair";
import {
  V2_FAQ_SPEC, V2_TAKEAWAYS_SPEC,
  parseJsonArrayTolerant, buildLinkInventory, buildV2ProductBrief, buildV2CatalogueResearch,
  linkComparisonTable, sealTruncatedBody, dedupeV2Links, splitAdjacentLinks, linkKey, auditAnchorText,
} from "@/lib/article-v2";
import { fillPlan, normalisePlan, sealGuideLinks, toGuideProduct, type GuidePlanItem, type GuideV2Product } from "@/lib/guide-v2";
import { fetchAdminProducts, listLiveCollectionHandles } from "@/lib/shopify/products-admin";
import { listPublishedArticlePaths } from "@/lib/shopify/blog-admin";
import { DEFAULT_MIN_PRICE, extractSearchTerms, selectRelevantProducts } from "@/lib/product-picker";
import { isExcludedVendor, liftedVendors } from "@/lib/product-exclusions";
import { asHub } from "@/lib/collection-category";
import { getSQL } from "@/lib/db";
import type { Product } from "@/lib/product-store";

export const maxDuration = 300;

type GuideRow = {
  id?: string;
  title: string;
  slug?: string;
  topic_short: string;
  topic_short_plural?: string;
  topic_full?: string;
  description?: string;
  collection_slug?: string;
  breadcrumb_l2_name?: string;
  section_plan?: unknown;
  selected_products?: GuideV2Product[];
  cluster_links?: { url: string; anchor?: string; title?: string }[];
};

type Body = {
  action: "picks" | "section" | "takeaways" | "faq" | "meta";
  guide: GuideRow;
  section?: GuidePlanItem;
  sections?: Record<string, string>;
  feedback?: string;
  clusterLinks?: { url?: string; slug?: string; title?: string; anchor?: string }[];
  minPrice?: number;
  maxPicks?: number;
};

// ── Live product pool, cached briefly per collection ────────────────────────
// Nine section calls in a row would otherwise fetch 250 listings nine times.
const POOL_TTL_MS = 10 * 60 * 1000;
const poolCache = new Map<string, { at: number; pool: Product[] }>();

async function productPool(handle: string): Promise<Product[]> {
  const h = (handle || "").toLowerCase();
  if (!h || h === "all") return [];
  const hit = poolCache.get(h);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.pool;
  try {
    const pool = await fetchAdminProducts({ collectionHandle: h, limit: 250 });
    if (pool.length) poolCache.set(h, { at: Date.now(), pool });
    return pool;
  } catch (e) {
    console.warn("[guide-v2] product pool fetch failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// ── Collections: own record plus ranked siblings, validated against Shopify ──

type Coll = { slug: string; label: string; hub: string; keywords: string };

async function collectionContext(guide: GuideRow): Promise<{ own?: Coll; candidates: { title: string; url: string }[] }> {
  const slug = (guide.collection_slug || "").toLowerCase();
  let rows: { slug: string; category?: string | null; title_tag?: string | null; primary_keyword?: string | null; secondary_keywords?: unknown; is_hidden?: boolean | null }[] = [];
  try {
    const sql = getSQL();
    rows = Array.from(await sql`
      SELECT slug, category, title_tag, primary_keyword, secondary_keywords, is_hidden
      FROM ppw_collections`) as typeof rows;
  } catch (e) {
    console.warn("[guide-v2] ppw_collections query failed:", e instanceof Error ? e.message : e);
  }
  const labelOf = (r: (typeof rows)[number]) =>
    (r.title_tag || "").split(/[|:]|\s-\s/)[0].split(/\s+for\s+/i)[0].trim()
    || r.slug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  let all: Coll[] = rows.filter((r) => r.slug && !r.is_hidden).map((r) => ({
    slug: r.slug.toLowerCase(),
    label: labelOf(r),
    hub: asHub(r.category) || "",
    keywords: `${r.primary_keyword || ""} ${Array.isArray(r.secondary_keywords) ? r.secondary_keywords.join(" ") : r.secondary_keywords || ""} ${r.category || ""}`.toLowerCase(),
  }));

  try {
    const { handles, titles } = await listLiveCollectionHandles();
    if (handles.size) {
      all = all.filter((c) => handles.has(c.slug)).map((c) => ({ ...c, label: titles.get(c.slug) || c.label }));
      if (slug && !all.some((c) => c.slug === slug) && handles.has(slug)) {
        all.unshift({ slug, label: titles.get(slug) || guide.breadcrumb_l2_name || slug, hub: "", keywords: "" });
      }
    }
  } catch (e) {
    console.warn("[guide-v2] could not validate collection handles:", e instanceof Error ? e.message : e);
  }

  const own = all.find((c) => c.slug === slug) || (slug ? { slug, label: guide.breadcrumb_l2_name || slug, hub: "", keywords: "" } : undefined);
  const topicWords = new Set(`${guide.title} ${guide.topic_short} ${guide.topic_full || ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const score = (c: Coll) => { let n = 0; for (const w of topicWords) if (`${c.label} ${c.keywords}`.toLowerCase().includes(w)) n++; return n; };
  const siblings = all
    .filter((c) => c.slug !== slug)
    .filter((c) => !own?.hub || c.hub === own.hub || score(c) > 0)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 11);
  const candidates = [
    ...(own ? [{ title: own.label, url: `/collections/${own.slug}` }] : []),
    ...siblings.map((c) => ({ title: c.label, url: `/collections/${c.slug}` })),
  ];
  return { own, candidates };
}

// ── Articles the guide may link: the cluster, validated against Shopify ─────

async function articleInventory(guide: GuideRow, clientLinks: Body["clusterLinks"]): Promise<{ title: string; url: string }[]> {
  const out = new Map<string, { title: string; url: string }>();
  const add = (title: string, url: string) => {
    const u = (url || "").trim();
    if (!u || !title) return;
    const rel = u.startsWith("http") ? u.replace(/^https?:\/\/(www\.)?peakprimalwellness\.com/i, "") : u.startsWith("/") ? u : `/blogs/wellness/${u}`;
    const k = linkKey(rel);
    if (!k.startsWith("/blogs/")) return;
    if (!out.has(k)) out.set(k, { title: title.trim(), url: rel });
  };
  for (const l of clientLinks || []) add(l.title || l.anchor || "", l.url || l.slug || "");
  for (const l of guide.cluster_links || []) add(l.title || l.anchor || "", l.url);
  try {
    const sql = getSQL();
    // The cluster lives in content_brain, keyed on the live Shopify collection
    // handle, with blog_post_tracking holding what is actually published. The
    // old query read the `articles` table filtered to status='published', and
    // on treatment tables that returned ZERO: all 12 rows there are drafts,
    // while the 12 real cluster articles are live on Shopify. An empty
    // inventory is why that guide shipped no internal links at all and filled
    // the gap with PubMed.
    const rows = Array.from(await sql`
      SELECT COALESCE(NULLIF(t.current_title, ''), b.title) AS title, b.url_slug AS slug
      FROM content_brain b
      LEFT JOIN blog_post_tracking t ON t.slug = b.url_slug
      WHERE b.collection_slug = ${guide.collection_slug || ""}
        AND b.url_slug IS NOT NULL AND b.url_slug <> ''
        AND (b.status = 'live' OR t.slug IS NOT NULL)
      ORDER BY t.shopify_published_at DESC NULLS LAST, b.id DESC
      LIMIT 60`) as { title: string; slug: string }[];
    for (const r of rows) add(r.title, `/blogs/wellness/${r.slug}`);
    // Legacy fallback: older collections still have their cluster in `articles`.
    if (!rows.length) {
      const legacy = Array.from(await sql`
        SELECT title, slug FROM articles
        WHERE category = ${guide.collection_slug || ""} AND status = 'published'
        ORDER BY updated_at DESC LIMIT 60`) as { title: string; slug: string }[];
      for (const r of legacy) add(r.title, `/blogs/wellness/${r.slug}`);
    }
  } catch (e) {
    console.warn("[guide-v2] articles query failed:", e instanceof Error ? e.message : e);
  }
  let list = Array.from(out.values());
  try {
    const live = await listPublishedArticlePaths();
    if (live.size) {
      const before = list.length;
      list = list.filter((l) => live.has(linkKey(l.url)));
      if (list.length !== before) console.warn(`[guide-v2] dropped ${before - list.length} article link(s) not published in Shopify`);
    }
  } catch (e) {
    console.warn("[guide-v2] could not validate article inventory:", e instanceof Error ? e.message : e);
  }
  return list.slice(0, 16);
}

// ── Citation check ──────────────────────────────────────────────────────────
// A URL on an allowlisted host still has to exist. HEAD first; a host that
// refuses HEAD gets a GET. Six seconds each, in parallel, failures drop.

async function verifyUrls(urls: string[]): Promise<Set<string>> {
  const ok = new Set<string>();
  await Promise.all(Array.from(new Set(urls)).map(async (u) => {
    for (const method of ["HEAD", "GET"] as const) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        const res = await fetch(u, { method, redirect: "follow", signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; PPW citation check)" } });
        clearTimeout(t);
        if (res.ok) { ok.add(u); return; }
        // A 404 or a 410 is final. Anything else (405 on HEAD, a 403 from a
        // bot filter, a 5xx) earns the GET attempt.
        if (res.status === 404 || res.status === 410) return;
      } catch { /* try the next method, then give up */ }
    }
  }));
  return ok;
}

// ── Prompt pieces ───────────────────────────────────────────────────────────

const GUIDE_SECTION_SPEC = `
OUTPUT FORMAT. You are writing ONE section of a long guide. Return the section
BODY only: no <h2>, no title, no <article>, no <style>, no markdown, no
preamble, no closing remark. Your reply is inserted into the page verbatim.

Use these classes and no others. They are defined in the theme.
  Paragraph:       <p class="ppwb-p">...</p>
  Lead paragraph:  <p class="ppwb-lead">...</p> (first paragraph only, optional)
  Sub-heading:     <h3 class="ppwb-h3">...</h3>
  Bullets:         <ul class="ppwb-ul"><li class="ppwb-li">...</li></ul>
  Numbered:        <ol class="ppwb-ol"><li class="ppwb-li">...</li></ol>
  Callout:         <aside class="ppwb-call"><span class="ppwb-call-label">Label</span><p>...</p></aside>
  Warning callout: <aside class="ppwb-call ppwb-call-warn"><span class="ppwb-call-label">Label</span><p>...</p></aside>
  Steps:           <ol class="ppwb-steps"><li class="ppwb-step"><div><h3 class="ppwb-step-title">Title</h3><p class="ppwb-step-body">...</p></div></li></ol>
  Spec strip:      <div class="ppwb-specs"><div class="ppwb-spec"><div class="ppwb-spec-num">1.3</div><div class="ppwb-spec-label">ATA</div><p class="ppwb-spec-note">...</p></div></div> (three specs)
  Comparison:      <div class="ppwb-cmp-wrap"><table class="ppwb-cmp"><thead><tr><th>Model</th><th>Best for</th><th>Key trade-off</th></tr></thead><tbody><tr><td class="ppwb-cmp-model">Exact model name</td><td data-ppwb-col="Best for">...</td><td data-ppwb-col="Key trade-off">...</td></tr></tbody></table></div>
                   Every cell except the first in a row carries data-ppwb-col. A table is never the last thing in a section.
                   THE FIRST COLUMN IS THE MODEL, spelled exactly as PRODUCT DATA spells it. It is turned
                   into a link and a thumbnail after you write, and only an exact name resolves. Do not put
                   a category ("Multi-section Hi-Lo") in the first column and hide the model in a later one:
                   that row ships as dead text. Keep the editorial columns you need after it. Up to SIX rows,
                   one per product in PRODUCT DATA, never more than six.
  Link:            <a class="ppwb-a" href="/blogs/wellness/slug">natural anchor text</a>

No inline styles. No <img>. No emoji. No <strong> runs inside paragraphs except
a single key phrase where it earns it. Paragraphs are 2 to 4 sentences.
Write in second person where it helps, as the dealer who handles this
equipment every day. Never refer to "the product data", "the listing" or "the
research above"; when a figure is not published, say the manufacturer does not
publish it.

BRANDS: name only the brands and models in the PRODUCT DATA and CATALOGUE
RESEARCH. Never "brands like X, Y or Z" with names you have seen elsewhere;
those are competitors PPW does not stock. Describe the tier instead.

CLAIMS: no years of experience, no certifications, no "medically reviewed", no
"clinically proven". Never mention shipping cost in any form. No
"white-glove" or "assembly included". HSA/FSA eligibility may be mentioned
as something to check with the provider.

NEVER use our trade vocabulary (SERP, keyword, search intent, E-E-A-T, PAA,
meta description, anchor text).`;

const CITATION_SPEC = `
CITATIONS, this section only. You may link to a primary source when a claim
rests on a specific study or body: a journal article, a government health
body, a standards body. Inline, on the claim, as
<a class="ppwb-a" href="https://...">journal or body, year</a>. Only URLs you
are confident exist on these hosts: pubmed.ncbi.nlm.nih.gov, nih.gov, who.int,
cdc.gov, cochrane.org, bmj.com, nature.com, sciencedirect.com, springer.com,
wiley.com, tandfonline.com, jamanetwork.com, nejm.org, thelancet.com,
frontiersin.org, mdpi.com, plos.org, mayoclinic.org, clevelandclinic.org,
health.harvard.edu, hopkinsmedicine.org, nhs.uk, fda.gov. Every URL is checked
before publication and a dead one is removed, so a guessed URL costs you the
citation. Two to five citations is right; zero is acceptable if you are not
confident. Never a sources list at the end of the section.`;

const NO_CITATION_SPEC = `
EXTERNAL LINKS: none in this section. You may still say what the research
shows in the sentence, naming the body of work rather than linking to it.`;

function linkBrief(articles: { title: string; url: string }[], collections: { title: string; url: string }[], section: GuidePlanItem): string {
  const a = articles.length
    ? articles.map((x, i) => `  A${i + 1}. ${x.url}\n        "${x.title}"`).join("\n")
    : "  (none: write no article links)";
  const collRule =
    section.key === "types" && collections[0]
      ? `COLLECTION LINK: exactly ONE in this section, to C1 (${collections[0].url}), inside a paragraph where a reader would naturally start browsing.`
      : section.key === "buying" && collections[1]
        ? `COLLECTION LINK: exactly ONE in this section, to the collection a reader of this guide would most plausibly cross-shop. Candidates, ranked:\n${collections.slice(1, 8).map((c, i) => `  C${i + 2}. ${c.url}  "${c.title}"`).join("\n")}\nPlace it where that cross-shop comes up in the argument, never in a bolted-on sentence.`
        : "COLLECTION LINKS: none in this section. Other sections carry them.";
  return `LINK INVENTORY. The only site URLs that exist; copy them character for character. Anything else is stripped.

ARTICLES (${articles.length >= 4 ? "link 1 to 2 in this section" : "link 0 to 2 in this section"}, each a different entry, never two in one paragraph, anchor text is 2 to 5 words that were already going to be in the sentence, never the article's title, never "best", "guide", "ultimate" or a year${articles.length >= 4 ? ". A section with none is a section that failed to place one, not a style choice: with this many cluster articles available there is always a sentence that earns a link" : ""}):
${a}

${collRule}`;
}

function digest(sections: Record<string, string>, plan: GuidePlanItem[], perSection = 700, cap = 14000): string {
  const parts: string[] = [];
  for (const item of plan) {
    const html = sections[item.key];
    if (!html) continue;
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, perSection);
    if (text) parts.push(`## ${item.heading}\n${text}`);
  }
  return parts.join("\n\n").slice(0, cap);
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { action, guide } = body;
  if (!action || !guide?.title || !guide?.topic_short) {
    return NextResponse.json({ error: "action, guide.title and guide.topic_short are required" }, { status: 400 });
  }

  const topic = guide.topic_short.trim();
  const topicPlural = (guide.topic_short_plural || `${topic}s`).trim();
  const plan = fillPlan(normalisePlan(guide.section_plan), topic, topicPlural).filter((p) => p.enabled);
  const handle = (guide.collection_slug || "").toLowerCase();

  try {
    // ── picks ───────────────────────────────────────────────────────────────
    if (action === "picks") {
      const pool = await productPool(handle);
      if (!pool.length) return NextResponse.json({ error: `no live products for collection "${handle}"` }, { status: 422 });
      const lifted = liftedVendors({ title: guide.title, keyword: topic, collection: handle, instructions: guide.description });
      const terms = extractSearchTerms(`${guide.title} ${topic} ${topicPlural}`);
      const max = Math.min(8, Math.max(2, Number(body.maxPicks) || 6));
      // The one-product-per-vendor rule is a BLOG rule (Ryan, 22 Aug 2026).
      // A guide covers a whole category across types, so two models from one
      // vendor can be legitimate there; guides run with the old cap of two.
      // Within a vendor the picker still errs to the most expensive model.
      const picked = selectRelevantProducts(pool, terms.length ? terms : handle.split("-"), max, Number(body.minPrice) || DEFAULT_MIN_PRICE, { lifted, vendorCap: 2 });
      // Interleave by type so the first row shows the range, as the blog does.
      const keyOf = (p: Product) => (p.productType || p.vendor || "").toLowerCase();
      if (picked.length >= 3 && keyOf(picked[0]) === keyOf(picked[1])) {
        const idx = picked.findIndex((p, i) => i > 1 && keyOf(p) !== keyOf(picked[0]));
        if (idx > 1) { const [o] = picked.splice(idx, 1); picked.splice(1, 0, o); }
      }
      return NextResponse.json({ products: picked.map(toGuideProduct), poolSize: pool.length, source: "shopify-admin-live" });
    }

    // ── shared context for the writing actions ──────────────────────────────
    const pool = await productPool(handle);
    const lifted = liftedVendors({ title: guide.title, keyword: topic, collection: handle, instructions: guide.description });
    const featured = (guide.selected_products || []).filter((p) => p?.title);
    const featuredExcluded = featured.some((p) => isExcludedVendor({ vendor: p.vendor, title: p.title }, lifted));
    const researchPool = featuredExcluded ? pool : pool.filter((p) => !isExcludedVendor(p, lifted));
    // The featured products with their full listings, for the brief.
    const featuredFull = featured.map((f) => {
      const live = pool.find((p) => p.handle === f.handle);
      // imageUrl rides along so linkComparisonTable can add the thumbnail;
      // its absence here is why the first guide's linked rows had no image.
      return live
        ? { title: live.title, vendor: live.vendor, price: live.price, description: live.description, handle: live.handle, tags: live.tags, productType: live.productType, imageUrl: live.imageUrl }
        : { title: f.title, vendor: f.vendor, price: String(f.price ?? ""), handle: f.handle, productType: f.productType, imageUrl: f.image_url };
    });
    const knownVendors: string[] = [
      ...researchPool.flatMap((p) => [p.vendor || "", p.title || ""]),
      ...featured.flatMap((p) => [p.vendor || "", p.title || ""]),
      guide.title, topic, topicPlural, guide.topic_full || "", guide.breadcrumb_l2_name || "",
    ].filter(Boolean);
    const productBrief = buildV2ProductBrief(featuredFull);

    // ── takeaways ───────────────────────────────────────────────────────────
    if (action === "takeaways") {
      const d = digest(body.sections || {}, plan);
      if (!d) return NextResponse.json({ error: "no sections to summarise" }, { status: 400 });
      const raw = await callAI(
        `You are a Senior Content Editor at Peak Primal Wellness.\n${V2_TAKEAWAYS_SPEC.replace("Exactly 5 items", "Exactly 6 items")}\n${WRITING_RULES}`,
        `Guide title: "${guide.title}". Subject: ${topic}.\n\nTHE GUIDE, SECTION BY SECTION, IS BELOW. Your six takeaways carry its conclusions in order, one per major section where possible. Every figure you state must appear in it.\n\n---- GUIDE SECTIONS ----\n${d}`,
        { maxTokens: 1400 },
      ).then(stripEmDashes);
      const items = parseJsonArrayTolerant<{ label: string; text: string }>(raw)
        .filter((t) => t && typeof t.label === "string" && typeof t.text === "string")
        .slice(0, 6);
      return NextResponse.json({ takeaways: items });
    }

    // ── faq ─────────────────────────────────────────────────────────────────
    if (action === "faq") {
      const d = digest(body.sections || {}, plan, 600, 10000);
      const consistency = `\n\nTHE GUIDE BODY IS BELOW. Every figure you state must match it. If the body gives a range, use that range.\n\n${productBrief}\n\n---- GUIDE BODY ----\n${d}`;
      const ask = () => callAI(
        `You are a Senior Content Editor at Peak Primal Wellness.\n${V2_FAQ_SPEC}\n${WRITING_RULES}`,
        `Guide title: "${guide.title}". Subject: ${topic}.${consistency}`,
        { maxTokens: 2600 },
      ).then(stripEmDashes);
      const toPairs = (raw: string) => parseJsonArrayTolerant<{ q: unknown; a: unknown }>(raw)
        .filter((f): f is { q: string; a: string } => !!f && typeof f.q === "string" && typeof f.a === "string")
        .slice(0, 8);
      let pairs = toPairs(await ask());
      if (pairs.length < 4) { try { const again = toPairs(await ask()); if (again.length > pairs.length) pairs = again; } catch { /* ship what we have */ } }
      const warnings: string[] = [];
      pairs = pairs.map((f) => {
        const a0 = f.a.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
        const s1 = scrubUncarriedBrands(a0, knownVendors);
        const j = scrubSeoJargon(s1.text);
        if (s1.removed.length) warnings.push(`removed "${s1.removed.join('", "')}"`);
        return { q: scrubSeoJargon(f.q).text, a: j.text };
      });
      for (const f of pairs) {
        const check = validateBrandRules(f.a, false, { knownVendors });
        if (check.passed) continue;
        try {
          const fixed = await callAI(
            `You are rewriting one FAQ answer for Peak Primal Wellness. The answer below breaks a house rule. Rewrite it so it names NO brand outside the approved list and makes no health-efficacy claim in marketing language. Keep the length, facts and plain tone. Return ONLY the rewritten answer.`,
            `PROBLEM: ${check.warnings.join(" | ")}\n\nAPPROVED BRANDS: ${knownVendors.join(", ")}\n\nQUESTION: ${f.q}\n\nANSWER TO FIX:\n${f.a}`,
            { maxTokens: 600 },
          );
          const cand = stripEmDashes(fixed.trim().replace(/^["']|["']$/g, ""));
          if (cand && validateBrandRules(cand, false, { knownVendors }).passed) { f.a = cand; warnings.push(`rewrote an answer: ${check.warnings[0]}`); }
        } catch { /* dropped below */ }
      }
      const before = pairs.length;
      pairs = pairs.filter((f) => validateBrandRules(f.a, false, { knownVendors }).passed);
      if (pairs.length < before) warnings.push(`dropped ${before - pairs.length} answer(s) that still broke a rule after a rewrite`);
      return NextResponse.json({ faq: pairs, warnings });
    }

    // ── meta ────────────────────────────────────────────────────────────────
    if (action === "meta") {
      const d = digest(body.sections || {}, plan, 300, 5000);
      const raw = await callAI(
        `You write page metadata for Peak Primal Wellness, a wellness equipment retailer. Return ONLY JSON: {"metaDescription":"...","deck":"..."}. metaDescription is 140 to 160 characters, plain, names the subject and what the guide covers, no hype, no health-efficacy promise. deck is one sentence under 150 characters that sits under the title and says what the reader will be able to decide after reading. No double quotes inside the strings. No em dashes.`,
        `Guide title: "${guide.title}". Subject: ${topic}.\n\n${d}`,
        { maxTokens: 300 },
      ).then(stripEmDashes);
      let meta = "", deck = "";
      try {
        const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
        meta = String(j.metaDescription || "").trim();
        deck = String(j.deck || "").trim();
      } catch { meta = raw.replace(/^[^:]*:\s*/, "").replace(/["{}]/g, "").trim().slice(0, 160); }
      for (const s of [meta, deck]) {
        const c = validateBrandRules(s);
        if (!c.passed) console.warn("[guide-v2] meta check:", c.warnings.join(" | "));
      }
      return NextResponse.json({ metaDescription: meta.slice(0, 160), deck: deck.slice(0, 160) });
    }

    // ── section ─────────────────────────────────────────────────────────────
    if (action !== "section" || !body.section?.key) {
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    const section = fillPlan([body.section], topic, topicPlural)[0];
    const [{ own, candidates }, articles] = await Promise.all([
      collectionContext(guide),
      articleInventory(guide, body.clusterLinks),
    ]);
    const inventory = buildLinkInventory(articles, candidates);
    const titles = new Map<string, string>([...articles, ...candidates].map((x) => [linkKey(x.url), x.title]));

    const research = buildV2CatalogueResearch(researchPool, {
      title: `${guide.title} ${section.heading}`,
      keyword: topic,
      articleType: "ultimate-guide",
      budgetChars: 6000,
    });

    const otherHeadings = plan.filter((p) => p.key !== section.key).map((p) => `  - ${p.heading}`).join("\n");
    const previous = digest(body.sections || {}, plan.filter((p) => p.key !== section.key), 350, 6000);

    const system = `You are a Senior Content Editor at Peak Primal Wellness, writing the ultimate guide to ${topicPlural.toLowerCase()}. PPW is an authorized dealer that sells, ships and supports this equipment; that is the authority you write from.
${GUIDE_SECTION_SPEC}
${section.citations ? CITATION_SPEC : NO_CITATION_SPEC}

${productBrief}

${research.text}

${linkBrief(articles, candidates, section)}

${WRITING_RULES}`;

    const user = `GUIDE: "${guide.title}"
SUBJECT: ${topic} (plural: ${topicPlural})${own ? `\nCOLLECTION: ${own.label} (/collections/${own.slug})` : ""}

SECTION TO WRITE: "${section.heading}"
WHAT THE READER NEEDS FROM IT: ${section.brief}
LENGTH: ${section.words - 100} to ${section.words + 150} words. Stop when the section is complete.

THE OTHER SECTIONS OF THIS GUIDE (do not cover their ground; one sentence of hand-off is fine):
${otherHeadings}
${previous ? `\nWHAT HAS ALREADY BEEN WRITTEN (stay consistent with every figure; do not repeat it):\n${previous}` : ""}${body.feedback ? `\n\nEDITOR'S FEEDBACK ON THE LAST DRAFT, apply it:\n${body.feedback}` : ""}

Return the section body only.`;

    const maxTokens = Math.min(6000, Math.round((section.words / 0.75) * 1.9) + 400);
    let html = stripEmDashes(await callAI(system, user, { maxTokens, timeoutMs: 200_000, retryOnTimeout: false }));
    const warnings: string[] = [];

    if (looksLikeReasoning(html)) warnings.push("reply read like narration; review the opening");
    html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
    html = html.replace(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi, "");
    html = html.replace(/<img\b[^>]*>/gi, "");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    const sealed = sealTruncatedBody(html);
    if (sealed.truncated) warnings.push(sealed.note);
    html = sealed.html;

    const jargon = scrubSeoJargon(html);
    html = jargon.text;
    if (jargon.removed.length) warnings.push(`removed trade jargon: ${jargon.removed.join(" | ")}`);

    // Block-level repair, as the blog does it: each offending paragraph or
    // list item is rewritten once with its links required to survive.
    const repaired = await repairBodyBlocks(html, { knownVendors, cap: 8, docLabel: "guide" });
    html = repaired.html;
    warnings.push(...repaired.notes);

    // Links: site links must be in the inventory; citations must be on an
    // allowlisted host AND answer a live request.
    let verified: Set<string> | undefined;
    if (section.citations) {
      const outbound = Array.from(html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)).map((m) => m[1]).filter((u) => !/peakprimalwellness\.com/i.test(u));
      if (outbound.length) {
        verified = await verifyUrls(outbound);
        const dead = outbound.filter((u) => !verified!.has(u));
        if (dead.length) warnings.push(`dropped ${dead.length} citation(s) that did not resolve: ${[...new Set(dead)].join(", ")}`);
      }
    }
    const seal = sealGuideLinks(html, inventory, { allowCitations: !!section.citations, verified });
    html = seal.html;
    if (seal.stripped.length) warnings.push(`stripped ${seal.stripped.length} invented or off-list link(s): ${seal.stripped.join(", ")}`);
    html = dedupeV2Links(html).html;
    html = splitAdjacentLinks(html).html;
    const table = linkComparisonTable(html, [...featuredFull, ...researchPool].map((p) => ({ title: p.title, handle: p.handle, imageUrl: (p as { imageUrl?: string }).imageUrl, vendor: p.vendor })), featuredFull.length);
    html = table.html;
    const lazy = auditAnchorText(html, titles);
    if (lazy.length) warnings.push(...lazy.map((l) => `anchor text: ${l}`));

    const final = validateBrandRules(html, false, { knownVendors });
    if (!final.passed) warnings.push(...final.warnings);

    return NextResponse.json({
      html,
      warnings,
      citations: seal.citations,
      words: html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length,
      research: { passages: research.passages, products: research.productsUsed, scanned: research.productsScanned },
      inventory: { articles: articles.length, collections: candidates.length },
      // The per-section budget used to allow zero, and nine sections of zero is
      // a guide with no internal links: the treatment tables guide shipped 3
      // across 9 sections from an inventory of 14. The floor above is a
      // request; this line makes a thin result visible in the run.
      articleLinksPlaced: (html.match(/href="\/blogs\/wellness\//g) || []).length,
    });
  } catch (error) {
    console.error("[guide-v2]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "generation failed" }, { status: 500 });
  }
}
