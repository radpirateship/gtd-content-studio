// lib/keyword-audit.ts
//
// Collection keyword audit: per-collection research (GSC queries, Ahrefs
// candidates, competitor pages, SERPs) stored in collection_keyword_research,
// plus an AI recommendation (primary, secondaries, title, meta, H2 additions)
// that Ryan reviews and applies to the gtd_collections row and, optionally,
// to the live Shopify SEO fields. Research is pulled offline (Ahrefs API,
// GSC) and imported as JSON; see scripts/keyword-research/.

import { callAI } from "@/lib/ai";
import { NO_PRICES_IN_GENERATED_TEXT } from "@/lib/keyword-audit-facts";

export type Research = {
  handle: string;
  live: { title: string | null; meta: string | null; h1: string[]; h2s: string[] };
  gsc: { period: string; queries: number; impressions: number; clicks: number; top: Array<{ q: string; impr: number; clicks: number; pos: number }> };
  ahrefs_own: Array<{ kw: string; pos: number; vol: number | null; kd: number | null }>;
  candidates: Array<{ kw: string; vol: number | null; kd: number | null; cpc: number; intent: string[]; parent: string | null }>;
  competitor_pages: Array<{ domain: string; url: string; keywords: Array<{ kw: string; pos: number; vol: number | null }> }>;
  serps: Array<{ keyword: string; top: Array<{ pos: number; domain: string; url: string; dr: number | null; ur: number | null; rds: number | null; traffic: number | null; title: string | null; type: string[] | null }> }>;
  pulled: string;
};

export type Recommendation = {
  primary: string;
  secondaries: string[];
  title_tag: string;
  meta_description: string;
  h1: string;
  h2_additions: string[];
  rationale: string;
  head_term_verdict: string;
  risks: string;
};

export async function ensureKeywordResearchTable(sql: any) {
  await sql`
    CREATE TABLE IF NOT EXISTS collection_keyword_research (
      slug TEXT PRIMARY KEY,
      research JSONB NOT NULL,
      recommendation JSONB,
      generated_at TIMESTAMPTZ,
      applied_row_at TIMESTAMPTZ,
      applied_shopify_at TIMESTAMPTZ,
      reviewed BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE collection_keyword_research ADD COLUMN IF NOT EXISTS previous_shopify JSONB`;
  await sql`ALTER TABLE collection_keyword_research ADD COLUMN IF NOT EXISTS content_drafted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE collection_keyword_research ADD COLUMN IF NOT EXISTS keep_title BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE collection_keyword_research ADD COLUMN IF NOT EXISTS content_published_at TIMESTAMPTZ`;
  await sql`ALTER TABLE collection_keyword_research ADD COLUMN IF NOT EXISTS must_terms JSONB`;
}

const SYSTEM = `You are the SEO lead for Green Thumb Depot (greenthumbdepot.com), a US Shopify store selling high-ticket wellness equipment: saunas, cold plunges, hyperbaric chambers, recovery gear, home gym, and clinical rehab equipment. You are choosing the target keywords and the title tag, meta description and section headings for ONE collection page, from research that is given to you.

How to choose:
- Collection pages at this store get almost no organic traffic today. The goal is a page that can realistically win queries within months, not a vanity head term.
- Prefer commercial modifier terms the page already shows impressions for in Search Console (for sale, kits, price or cost, home, size terms, material, type) and terms that competing BRAND and retailer collection pages win. Treat the head term as the primary only when the SERP for it is retailers and brands of comparable authority (look at DR, which for this store is around 40) rather than medical sites, Wikipedia, big publishers, Amazon, Wayfair, Costco or Home Depot. If the head term SERP is medical or informational, say so in head_term_verdict and pick a commercial variant as primary.
- Never target a term whose intent is clearly informational (how to, what is, benefits, DIY, plans) on a collection page. Never target competitor brand names or brands we do not stock. Branded terms for brands we stock are allowed as secondaries only if the research shows the page already gets impressions for them.
- Ignore keyword ideas that are off topic for this collection even if the volume is high.
- Secondaries: 2 to 4, each a distinct query family (not plural or reorder variants of the primary).

Writing rules:
- title_tag: 50 to 60 characters, primary keyword near the front, one secondary woven in naturally, no brand suffix, no call to action ("Shop Now", "Buy"), no exclamation marks, no quotes, no em dashes or en dashes. SCOPE: the title must describe the whole collection. If the primary is a sub-type (e.g. "preacher curl machine" on an arm-machines page, "wood fired hot tub" on a hot-tubs page), the title still names the parent category and the range of types carried; never a single-brand title unless the collection is that brand's page. Use a pipe or a colon to separate parts. Match the house style of existing titles such as "Outdoor Saunas | Barrel, Cabin & Kit Models".
- meta_description: 140 to 158 characters, written for a first-time buyer. SCOPE: it describes the whole collection (the main product types carried), never one sub-type, one product or one brand. Lead with the primary keyword and a plain-language benefit or definition (what this kind of product does for them), then one concrete reason to click (range, sizes, a secondary keyword that is not already in the title, or the starting price when allowed), then a short call to action ("Shop the full range.", "Compare models.", "Find the right fit."). NEVER write the store name "Green Thumb Depot" or "at Peak" in the meta; Google shows the site name beside the result already and the words are wasted. Brands depend on the hub: on Gym, Clinical and Cardio pages buyers are often brand-led, so naming up to two brands this collection carries is the default; on Saunas, Recovery, Wellness and Sports pages do NOT list brands, name one only when the research shows people searching that brand together with this category (a brand term in the page's GSC queries or keyword candidates, e.g. Harvia or HUUM on sauna heaters), at most two. Only ever name brands from the AUTHORITATIVE FACTS list when one is given. A starting price ("from $X") is welcome ONLY when the AUTHORITATIVE FACTS say it is allowed, written exactly as given; never invent, round or guess a price, and never put a price in the title. No em dashes.
- h1: the plain category name, usually the current H1; change it only if the primary keyword requires it.
- h2_additions: 3 to 5 new section headings the page should add so the secondaries appear in headings and get real answers (for example a cost section with ranges, kits vs assembled, sizes, a type comparison). Write them as headings, not instructions.
- rationale: 2 to 4 sentences citing the specific numbers that drove the choice (our GSC position and impressions, volume, KD, who ranks).
- risks: one or two sentences on what could go wrong (cannibalisation with another collection or article, thin product count, a frozen URL).

Return ONLY a JSON object with keys: primary, secondaries (array), title_tag, meta_description, h1, h2_additions (array), rationale, head_term_verdict, risks. No prose before or after.`;

function compact(r: Research) {
  return {
    handle: r.handle,
    live: r.live,
    gsc: { ...r.gsc, top: r.gsc.top.slice(0, 30) },
    ahrefs_own: r.ahrefs_own,
    candidates: r.candidates.slice(0, 45),
    competitor_pages: r.competitor_pages.slice(0, 12).map((p) => ({ domain: p.domain, url: p.url, keywords: p.keywords.slice(0, 5) })),
    serps: r.serps.map((s) => ({ keyword: s.keyword, top: s.top.slice(0, 14).map((t) => ({ pos: t.pos, domain: t.domain, dr: t.dr, rds: t.rds, title: t.title })) })),
  };
}

const META_MAX = 158;
const TITLE_MAX = 60;

function trimAtBoundary(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
  if (sentence > max * 0.6) return cut.slice(0, sentence + 1).trim();
  const word = cut.lastIndexOf(" ");
  let out = (word > 0 ? cut.slice(0, word) : cut).replace(/[,;:\s]+$/, "").trim();
  // never leave a dangling fragment ("... at Peak", "... starting at", "... from")
  out = out.replace(/\s+(at|from|for|with|and|or|to|in|on|of|the|a|an|by|starting|priced|starting at|at Peak|at Green Thumb Depot)$/i, "").trim();
  return out + ".";
}

/** Rewrite an over-long meta description to 140-158 chars, keeping primary, brands and price. Falls back to a boundary trim. */
export async function tightenMeta(meta: string, primary: string): Promise<string> {
  let m = (meta || "").replace(/[\u2014\u2013]/g, "-").trim();
  if (m.length <= META_MAX) return m;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await callAI(
        "You shorten meta descriptions. Return only the rewritten text, nothing else. No em dashes, no en dashes, no quotes.",
        `Rewrite this meta description so it is between 140 and ${META_MAX} characters (it is currently ${m.length}). Keep the phrase "${primary}", keep any price figure exactly as written, keep the closing call to action short (for example "Shop the full range.") and never include the store name. Cut adjectives and secondary clauses first.\n\n${m}`,
        { maxTokens: 300, timeoutMs: 60000, retryOnTimeout: false }
      );
      const cand = out.replace(/^["']|["']$/g, "").replace(/[\u2014\u2013]/g, "-").trim();
      if (cand.length >= 100 && cand.length <= META_MAX) return cand;
      if (cand.length < m.length) m = cand;
    } catch { /* fall through to trim */ }
  }
  return trimAtBoundary(m, META_MAX);
}

/** Shorten an over-long title to 60 chars: drop the last pipe segment, else boundary trim. */
const TITLE_CTA_RE = /\s*[|:,-]?\s*(shop now|buy now|order today|order now|shop today|buy today|shop online)\s*$/i;
export function tightenTitle(title: string): string {
  let t = (title || "").replace(/[\u2014\u2013]/g, "-").replace(TITLE_CTA_RE, "").replace(/\s*\$\s?[\d,]+(?:\.\d{2})?(?:\s*(?:to|-)\s*\$?[\d,]+)?/g, "").replace(/\s*\b(from|starting at|under)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
  if (t.length <= TITLE_MAX) return t;
  const parts = t.split(/\s*\|\s*/);
  if (parts.length > 1) {
    const tail = parts[parts.length - 1].split(/\s*[,&]\s*/);
    while (tail.length > 1 && t.length > TITLE_MAX) { tail.pop(); t = `${parts.slice(0, -1).join(" | ")} | ${tail.join(" & ")}`; }
    if (t.length > TITLE_MAX) t = parts[0];
  }
  return t.length > TITLE_MAX ? trimAtBoundary(t, TITLE_MAX).replace(/\.$/, "") : t;
}

export async function enforceLengths(rec: Recommendation): Promise<{ rec: Recommendation; changed: string[] }> {
  const changed: string[] = [];
  const title = tightenTitle(rec.title_tag);
  if (title !== rec.title_tag) { rec.title_tag = title; changed.push("title_tag"); }
  if ((rec.meta_description || "").length > META_MAX) { rec.meta_description = await tightenMeta(rec.meta_description, rec.primary); changed.push("meta_description"); }
  // house rule (27 Oct 2026): no store name in metas
  const noStore = stripStoreName(rec.meta_description || "");
  if (noStore !== (rec.meta_description || "")) { rec.meta_description = noStore; changed.push("meta_description"); }
  // no dangling fragment on any meta, long or not
  const cleanedMeta = (rec.meta_description || "").replace(/\s+(at|from|for|with|and|or|to|in|on|of|the|a|an|by|starting|starting at|at Peak|at Green Thumb Depot)[.]?$/i, "").trim();
  if (cleanedMeta !== (rec.meta_description || "").trim()) { rec.meta_description = cleanedMeta.replace(/[,;:]$/, "") + (/[.!?]$/.test(cleanedMeta) ? "" : "."); changed.push("meta_description"); }
  const cleanedTitle = tightenTitle(rec.title_tag);
  if (cleanedTitle !== rec.title_tag) { rec.title_tag = cleanedTitle; if (!changed.includes("title_tag")) changed.push("title_tag"); }
  return { rec, changed };
}

export async function generateRecommendation(research: Research, extra?: { category?: string | null; productCount?: number | null; notes?: string | null; facts?: string | null }): Promise<Recommendation> {
  const user = `Collection: /collections/${research.handle}${extra?.category ? ` (hub: ${extra.category})` : ""}${extra?.productCount != null ? `, ${extra.productCount} products` : ""}.
${extra?.notes ? `Operator notes: ${extra.notes}\n` : ""}${extra?.facts ? `${extra.facts}\n` : ""}
Research (JSON):
${JSON.stringify(compact(research))}`;
  const raw = await callAI(SYSTEM, user, { maxTokens: 1800, timeoutMs: 120000, retryOnTimeout: false });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Model returned no JSON");
  const rec = JSON.parse(m[0]) as Recommendation;
  rec.secondaries = Array.isArray(rec.secondaries) ? rec.secondaries.map(String) : [];
  rec.h2_additions = Array.isArray(rec.h2_additions) ? rec.h2_additions.map(String) : [];
  for (const k of ["primary", "title_tag", "meta_description", "h1", "rationale", "head_term_verdict", "risks"] as const) rec[k] = String(rec[k] ?? "").replace(/[—–]/g, "-").trim();
  return rec;
}


/** Brands carried by the collection that searchers actually pair with the category, judged from GSC queries and keyword candidates. */
export function brandsWithDemand(research: Research, carried: string[]): string[] {
  const text = [
    ...(research.gsc?.top || []).map((q) => q.q),
    ...(research.candidates || []).map((c) => c.kw),
    ...(research.ahrefs_own || []).map((k) => k.kw),
  ].join(" \n ").toLowerCase();
  const out: string[] = [];
  for (const v of carried) {
    const first = v.toLowerCase().split(/\s+/)[0];
    if (first.length < 4) continue;
    if (new RegExp(`(^|[^a-z0-9])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`).test(text)) out.push(v);
    if (out.length >= 2) break;
  }
  return out;
}

/** Regenerate only the meta description under the benefit-led rule; primary, secondaries and title are kept. */
/** Hubs where buyers tend to shop by brand; metas there may name up to two carried brands by default. */
export const BRAND_LED_HUBS = ["gym", "clinical", "cardio"];
export const isBrandLedHub = (category?: string | null) => BRAND_LED_HUBS.includes((category || "").toLowerCase());

export async function rewriteMeta(rec: Recommendation, research: Research, opts: { facts?: string | null; allowedBrands: string[]; priceAllowed: boolean; minPrice: number | null; notes?: string | null; brandLed?: boolean }): Promise<string> {
  const money = opts.minPrice == null ? "" : `$${Math.round(opts.minPrice).toLocaleString("en-US")}`;
  const user = `Write ONE meta description for /collections/${research.handle}.
Primary keyword (must appear, plural is fine): "${rec.primary}". Title tag already live: "${rec.title_tag}". Secondaries: ${rec.secondaries.join("; ")}.
${opts.notes ? `Operator notes: ${opts.notes}\n` : ""}${opts.facts ? `${opts.facts}\n` : ""}
Rules: 140 to ${META_MAX} characters. It must describe the WHOLE collection (the range of product types carried, see facts), never one sub-type, one product or one brand. Written for someone buying their first one: open with the primary keyword and a plain-language benefit or definition, then one concrete reason to click (range, sizes, a secondary keyword not in the title${opts.priceAllowed && money ? `, or "from ${money}"` : ""}), then a short call to action ("Shop the full range." or similar). NEVER include the store name Green Thumb Depot or "at Peak"; the site name already shows beside the result. ${opts.allowedBrands.length ? (opts.brandLed ? `Buyers in this category shop by brand, so name one or two of these brands this collection carries: ${opts.allowedBrands.join(", ")}.` : `You MAY name at most these brands, because searchers pair them with this category: ${opts.allowedBrands.join(", ")}. Naming none is fine.`) : "Do NOT name any brand."} ${opts.priceAllowed && money ? `The only price you may use is "from ${money}".` : "No prices or dollar figures."} No em dashes, no en dashes, no quotes, no exclamation marks. Return only the meta description text.`;
  const raw = await callAI("You write meta descriptions for an ecommerce store. Return only the text.", user, { maxTokens: 300, timeoutMs: 60000, retryOnTimeout: false });
  let m = raw.replace(/^["']|["']$/g, "").replace(/[\u2014\u2013]/g, "-").replace(/\s+/g, " ").trim();
  if (m.length > META_MAX) m = await tightenMeta(m, rec.primary);
  return m;
}


// ── Shared title/meta rules for the collection Generate and Improve tools ──
// One source of truth so a new collection page follows the same rules as the
// keyword audit (Ryan, 25 Oct 2026: no more "Soak Deeper: Home Hot Tubs
// Starting at $2,490" titles; primary keyword first, no price in the title,
// meta for a first-time buyer, brands only where buyers shop by brand).

export type SeoRuleInput = {
  primary: string;
  hub?: string | null;          // gtd_collections.category
  isBrand?: boolean;            // brand collection page
  brandName?: string | null;
  vendors?: string[];           // carried vendors, most products first
  prices?: number[];            // live product prices
};

export function priceAllowance(prices: number[] | undefined): { allowed: boolean; min: number | null; reason: string } {
  const ps = (prices || []).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!ps.length) return { allowed: false, min: null, reason: "no prices" };
  const min = ps[0], median = ps[Math.floor(ps.length / 2)];
  const allowed = min >= median * 0.25;
  return { allowed, min, reason: allowed ? "lowest price is representative" : `lowest $${Math.round(min)} is an accessory outlier against a median of $${Math.round(median)}` };
}

export function titleSpec(primary: string): string {
  return `Title tag, 50 to 60 characters. MUST begin with the primary keyword "${primary}" in title case (plural is fine), then a pipe or colon and a concrete differentiator (a secondary keyword, types carried, sizes). Never a price or dollar figure, never a slogan or verb-first phrase ("Soak Deeper", "Discover", "Build Your"), never the store name, no em dashes or en dashes.`;
}

export function metaSpec(input: SeoRuleInput): string {
  const money = (n: number | null) => n == null ? "" : `$${Math.round(n).toLocaleString("en-US")}`;
  const pa = NO_PRICES_IN_GENERATED_TEXT ? { allowed: false, min: null, reason: "house rule: no prices in generated text, they go stale" } : priceAllowance(input.prices);
  const brandLed = !!input.isBrand || isBrandLedHub(input.hub);
  const allowed = input.isBrand && input.brandName ? [input.brandName] : brandLed ? (input.vendors || []).slice(0, 2) : [];
  return `Meta description, 140 to ${META_MAX} characters, written for someone buying their first one. Open with the primary keyword "${input.primary}" and a plain-language benefit or definition, then one concrete reason to click (range, sizes, a secondary keyword${pa.allowed && pa.min ? `, or "from ${money(pa.min)}"` : ""}), then a short call to action such as "Shop the full range." NEVER include the store name Green Thumb Depot; the site name already shows beside the result. ${allowed.length ? `Brands: you may name at most these, because buyers in this category shop by brand: ${allowed.join(", ")}. No others.` : "Do NOT name any brand."} ${pa.allowed && pa.min ? `The only price allowed is "from ${money(pa.min)}".` : `No prices or dollar figures (${pa.reason}).`} Never mention shipping. No em dashes or en dashes, no quotes, no exclamation marks.`;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Deterministic guard: primary keyword first, no price, no dashes, <= 60. */
export function enforceTitleRules(title: string, primary: string): string {
  let t = (title || "").replace(/[\u2014\u2013]/g, "-").replace(/\s*\$\s?[\d,]+(?:\.\d{2})?(?:\s*(?:to|-)\s*\$?[\d,]+)?/g, "").replace(/\b(starting|from|under|at)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).join(" ");
  const want = norm(primary).split(" ").filter((w) => !["for", "sale", "with", "and", "the", "a", "of", "to", "in", "on", "at", "from", "home"].includes(w));
  const head = norm(t.split(/\s*[|:]\s*/)[0]);
  const startsRight = want.length > 0 && want.every((w) => head.split(" ").includes(w)) && head.startsWith(norm(primary).split(" ")[0]);
  if (!startsRight) {
    const tail = t.split(/\s*[|:]\s*/).slice(1).join(" | ").trim() || t;
    t = `${titleCase(primary)} | ${tail}`.replace(/\s*\|\s*$/, "").trim();
  }
  if (t.length > TITLE_MAX) t = tightenTitle(t);
  return t.replace(/[.,:;|\s-]+$/, "").trim();
}


/** Vocabulary an expert page on this collection's topic uses (not keywords to rank for; terms whose absence reads thin). */
export async function suggestMustTerms(opts: { handle: string; primary: string; secondaries: string[]; category?: string | null; productTitles: string[]; candidates: string[] }): Promise<string[]> {
  const user = `Collection page: /collections/${opts.handle}${opts.category ? ` (hub: ${opts.category})` : ""}. Primary keyword: "${opts.primary}". Secondaries: ${opts.secondaries.join("; ") || "none"}.
Products carried: ${opts.productTitles.slice(0, 15).join("; ") || "none"}.
Search terms people use around this topic: ${opts.candidates.slice(0, 40).join("; ") || "none"}.
List 6 to 10 vocabulary terms a knowledgeable page about this category would naturally use at least once: technical specs, units, materials, mechanisms, regulatory or safety words (for example "near-infrared", "wavelength", "ATA", "kW", "low EMF", "FDA cleared"). Exclude the primary and secondary keywords themselves, brand names, and prices. Return ONLY a JSON array of strings, lower case except acronyms.`;
  try {
    const raw = await callAI("You are an SEO content strategist for a wellness equipment retailer. Return only JSON.", user, { maxTokens: 400, timeoutMs: 60000, retryOnTimeout: false });
    const m = raw.match(/\[[\s\S]*\]/);
    const arr = m ? (JSON.parse(m[0]) as unknown[]) : [];
    return Array.from(new Set(arr.map((x) => String(x).trim()).filter((x) => x && x.length <= 40))).slice(0, 10);
  } catch { return []; }
}


/** Remove the store name from a meta description, keeping the sentence whole. */
export function stripStoreName(meta: string): string {
  let m = meta || "";
  m = m.replace(/\s*(?:at|from|with|by)\s+Green Thumb Depot(?: Wellness)?(?:\.com)?/gi, "");
  m = m.replace(/\s*Green Thumb Depot(?: Wellness)?(?:\.com)?(?:'s)?\s*/g, " ");
  m = m.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/\s+(at|from|for|with|and|or|to|in|on|of|the|a|an|by)[.]?$/i, "").trim();
  if (m && !/[.!?]$/.test(m)) m += ".";
  return m;
}
