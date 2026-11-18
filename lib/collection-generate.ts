// ============================================================================
// lib/collection-generate.ts — pure helpers for Generate mode
// (docs/PPW_Collection_Generator_Cowork_Instructions.md).
//
// v2 (July 30 2026): assemblePage emits the approved Claude Design Studio
// templates (docs/design-templates/category-template.html + brand-template.html).
// All static styling is INLINE; hover states, the FAQ accordion, and
// responsive grid collapses come from the THEME asset ppw-collections.css
// via the ppw-hv-* / ppw-g* / ppw-split-* / faq-modern classes.
// Pages no longer embed a <style> block.
// Everything here is deterministic and testable; the route supplies AI text.
// ============================================================================

import { BRAND_COLLECTIONS } from "./collection-link-map";
import { brandLogo } from "./brand-logos";

export type PreservedElements = {
  learningLinks: { url: string; title: string }[];
  /** Quiz CTA: the LINK and its wording are preserved, the markup is not.
   *  Old quiz blocks each carried their own palette (red for red light,
   *  wood-brown for sauna) and depended on the removed embedded stylesheet,
   *  so carrying the raw HTML forward left one off-theme box on every page.
   *  It is re-emitted in the standard section design instead. */
  quiz: { url: string; title: string; desc: string } | null;
  styleBlock: string | null;
};

const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const escAttr = (s: string) => String(s).replace(/"/g, "&quot;");

/** Extract elements that must survive a full rewrite. */
export function extractPreserved(html: string): PreservedElements {
  const learningLinks: { url: string; title: string }[] = [];
  // cluster cards
  for (const m of html.matchAll(/<[^>]*class="[^"]*ppw-cluster-card[^"]*"[\s\S]*?<\/a>/gi)) {
    const href = m[0].match(/href="([^"]+)"/i)?.[1];
    const title = m[0].match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)?.[1] || m[0].match(/<(?:strong|h3)[^>]*>([\s\S]*?)<\/(?:strong|h3)>/i)?.[1];
    if (href && title) learningLinks.push({ url: href, title: strip(title) });
  }
  // resources/learning sections
  for (const sec of html.matchAll(/<section\b[^>]*id="[^"]*(?:resources|learning)[^"]*"[\s\S]*?<\/section>/gi)) {
    for (const a of sec[0].matchAll(/<a\b[^>]*href="([^"]*\/blogs\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const title = strip(a[2]);
      if (title && !learningLinks.some((l) => l.url === a[1])) learningLinks.push({ url: a[1], title });
    }
  }
  // fallback: any blog links inside a Learning Center h2 section
  if (learningLinks.length === 0) {
    const m = html.match(/<h2[^>]*>[^<]*Learning (?:Center|Resources)[\s\S]*?(?=<h2|$)/i);
    if (m) for (const a of m[0].matchAll(/<a\b[^>]*href="([^"]*\/blogs\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const title = strip(a[2]);
      if (title) learningLinks.push({ url: a[1], title });
    }
  }

  // Quiz CTA: keep the destination and the human wording, throw away the
  // markup. Find the enclosing section/div only to scope the text scrape.
  let quiz: { url: string; title: string; desc: string } | null = null;
  const quizLink = html.match(/\/pages\/[a-z0-9-]*quiz/i);
  if (quizLink) {
    const idx = quizLink.index || 0;
    const secStart = html.lastIndexOf("<section", idx);
    const divStart = html.lastIndexOf("<div", idx);
    const start = Math.max(secStart, divStart);
    let block = "";
    if (start !== -1) {
      const closeTag = start === secStart ? "</section>" : "</div>";
      const end = html.indexOf(closeTag, idx);
      if (end !== -1) block = html.slice(start, end + closeTag.length);
    }
    const url = block.match(/href="([^"]*\/pages\/[a-z0-9-]*quiz[^"]*)"/i)?.[1]
      || html.match(/href="([^"]*\/pages\/[a-z0-9-]*quiz[^"]*)"/i)?.[1]
      || "";
    if (url) {
      const heading = block.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
      const title = heading ? strip(heading[1]).split(/\s+/).slice(0, 12).join(" ") : "";
      // First real sentence that isn't the heading or the button label.
      const paraM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const desc = paraM
        ? strip(paraM[1]).split(/\s+/).slice(0, 32).join(" ")
        : "";
      quiz = { url, title, desc: desc && desc !== title ? desc : "" };
    }
  }

  const styleBlock = html.match(/<style[\s\S]*?<\/style>/i)?.[0] || null;

  // 2026-08-13: sub-collection navigation tiles ("Shop by Type": 2-person,
  // 3-person, 4-person…) are no longer carried forward. Removed at Ryan's
  // request — they were the last block still leaning on the old embedded
  // stylesheet, and the same links belong in the body copy and Learning
  // Center where they read as editorial rather than a stranded tile grid.
  return { learningLinks, quiz, styleBlock };
}

// ── product selection (step 2) ───────────────────────────────────────────────
export type GenProduct = { title: string; handle: string; price: number; imageUrl: string; vendor: string; description: string; productType?: string };

/** Words that mark a product as an ADD-ON relative to the page it sits on.
 *  Deliberately relative: a filter is an accessory on the Tyent brand page and
 *  the actual product on a Replacement Filters page, so any word here is
 *  ignored when it also appears in the collection's own title or keyword. */
const ADDON_WORDS = /\b(accessory|accessories|filter|filters|cartridge|cartridges|replacement|refill|refills|consumable|consumables|spare|spares|cover|covers|cleaner|cleaning|descaler|prefilter|pre-filter|stand|stands|mount|bracket|adapter|hose|strap|towel|robe|bucket|ladle|backrest|headrest|essential oil|oils|salt|salts|bundle|warranty|add-on|addon)\b/gi;

const SELECT_STOP = new Set(["for", "and", "the", "with", "best", "sale", "buy", "shop", "in", "of", "a", "an", "to", "by", "top", "new", "all", "your", "our"]);

function selToks(s: string): string[] {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w && !SELECT_STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/s$/, "") : w));
}

export type FeaturedSelection = {
  picks: GenProduct[];
  subjectType: string | null;
  poolSize: number;
  excluded: string[];
  reason: string;
};

/**
 * Pick the featured products for a collection page.
 *
 * 2026-08-13 rewrite. The old version sorted by price and dropped anything
 * under 25% of the median, which cannot work on a page whose median IS the
 * accessories: /collections/water-ionizers holds 20 products of which exactly
 * one is an ionizer ($4,785) and the rest are replacement filters and shower
 * cartridges at $29.95 to $249. Median ≈ $137, so the guard's floor landed at
 * ~$34 and excluded nothing, and the "entry model" card showed a filter.
 *
 * Shopify product_type already separates these ("Water Ionizer" vs
 * "Replacement Filters"), and the app used it for the ownership section but
 * never for product selection. So: group by type, decide which type the page
 * is actually about, feature only from that group, and position within it by
 * percentile rather than by min/median/max.
 *
 * Order of operations:
 *   1. group the priced products by product_type
 *   2. subject type = best token overlap with the collection title/keyword;
 *      ties break on higher median price, then on group size. Groups whose
 *      TYPE reads as an add-on are only considered if nothing else is left,
 *      so an accessories-subject collection (Exercise Mats, Sauna
 *      Accessories) still features normally.
 *   3. widen into the next-best groups only if the subject group is thinner
 *      than the number of cards needed
 *   4. drop individual add-on TITLES inside the pool as a safety net for
 *      products with missing or wrong types, and only when enough remain
 *   5. pick at the 35th / 60th / 85th percentile. Not the cheapest (that was
 *      the accessory slot) and not the absolute flagship.
 *
 * Deliberately uses no sales data: most collections have no order history,
 * and consumables outsell the machine wherever there is any (filter packs
 * outsell the ionizer), so best-sellers would reintroduce the same problem.
 */
export function selectFeaturedDetailed(
  products: GenProduct[],
  count = 3,
  ctx: { title?: string; keyword?: string } = {}
): FeaturedSelection {
  const priced = products.filter((p) => Number.isFinite(p.price) && p.price > 0).sort((a, b) => a.price - b.price);
  if (priced.length <= count) {
    return { picks: priced, subjectType: null, poolSize: priced.length, excluded: [], reason: `only ${priced.length} priced product(s) — all featured` };
  }

  // The TITLE is the stronger signal for what a page is about; the keyword
  // often names the parent category on an accessories page ("water ionizer
  // replacement filters"), which would otherwise tie and let the pricier
  // parent type win on a page that is genuinely about the add-on.
  const titleToks = new Set(selToks(ctx.title || ""));
  const kwToks = new Set(selToks(ctx.keyword || ""));
  const pageToks = new Set([...titleToks, ...kwToks]);
  // add-on words the PAGE is about don't make something an add-on
  const addonHits = (s: string): string[] => {
    const out: string[] = [];
    for (const m of String(s || "").matchAll(ADDON_WORDS)) {
      const t = selToks(m[0])[0];
      if (t && !pageToks.has(t)) out.push(t);
    }
    return out;
  };

  // 1. group by product_type ("" = untyped, treated as one group)
  const groups = new Map<string, GenProduct[]>();
  for (const p of priced) {
    const k = (p.productType || "").trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }

  // 2. score the groups relative to this page
  const scored = [...groups.entries()].map(([type, items]) => ({
    type,
    items,
    // title match counts double against keyword match
    overlap: selToks(type).reduce((s, t) => s + (titleToks.has(t) ? 2 : 0) + (kwToks.has(t) ? 1 : 0), 0),
    addon: addonHits(type).length > 0,
    med: medianPrice(items),
    n: items.length,
  }));
  const nonAddon = scored.filter((g) => !g.addon);
  const ranked = (nonAddon.length ? nonAddon : scored)
    .sort((a, b) => (b.overlap - a.overlap) || (b.med - a.med) || (b.n - a.n));
  const subject = ranked[0];

  // 3. Widen only when the subject group is genuinely too thin to stand on
  //    its own (under 3), NOT merely short of the requested card count.
  //    Returning 4 real ionizers beats padding a 6-card compare table with
  //    $29.95 shower cartridges.
  const WIDEN_FLOOR = Math.min(count, 3);
  let pool = subject.items.slice();
  const widened: string[] = [];
  if (pool.length < WIDEN_FLOOR) {
    for (const g of ranked.slice(1)) {
      if (pool.length >= WIDEN_FLOOR) break;
      pool = pool.concat(g.items);
      widened.push(g.type || "untyped");
    }
    if (pool.length < WIDEN_FLOOR) pool = priced.slice();
  }

  // 4. title-level safety net, only when it still leaves enough products
  const excluded: string[] = [];
  const cleaned = pool.filter((p) => addonHits(p.title).length === 0);
  if (cleaned.length >= count && cleaned.length < pool.length) {
    for (const p of pool) if (addonHits(p.title).length > 0) excluded.push(p.handle);
    pool = cleaned;
  }
  pool.sort((a, b) => a.price - b.price);

  // 5. percentile positions. 3 cards sit around the middle of the range; a
  //    wider set (the compare table) still spans it.
  const ratios = count === 1 ? [0.6]
    : count === 2 ? [0.4, 0.8]
      : count === 3 ? [0.35, 0.6, 0.85]
        : Array.from({ length: count }, (_, i) => 0.08 + (0.87 * i) / (count - 1));
  const picks: GenProduct[] = [];
  const seen = new Set<string>();
  for (const r of ratios) {
    const p = pool[Math.min(pool.length - 1, Math.round(r * (pool.length - 1)))];
    if (p && !seen.has(p.handle)) { seen.add(p.handle); picks.push(p); }
  }
  // backfill if ties collapsed picks
  for (const p of pool) { if (picks.length >= count) break; if (!seen.has(p.handle)) { seen.add(p.handle); picks.push(p); } }

  const typeLabel = subject.type || "untyped";
  const reason = `subject type "${typeLabel}" (${subject.items.length} of ${priced.length} products${subject.overlap ? `, matched the collection name` : `, highest median ${fmt(subject.med)}`})`
    + (widened.length ? `; widened into ${widened.join(", ")} to fill ${count} cards` : "")
    + (excluded.length ? `; ${excluded.length} add-on title(s) skipped: ${excluded.slice(0, 4).join(", ")}` : "")
    + `; picked at the 35th/60th/85th percentile of ${pool.length}`;

  return { picks, subjectType: subject.type || null, poolSize: pool.length, excluded, reason };
}

export function selectFeatured(products: GenProduct[], count = 3, ctx: { title?: string; keyword?: string } = {}): GenProduct[] {
  return selectFeaturedDetailed(products, count, ctx).picks;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function medianPrice(products: GenProduct[]): number {
  const p = products.map((x) => x.price).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (p.length === 0) return 0;
  const m = Math.floor(p.length / 2);
  return p.length % 2 ? p[m] : (p[m - 1] + p[m]) / 2;
}

/** Compare-table rule (PPW rules update July 31): median variant price under
 *  $300 omit; $300 to $1,000 include only when the collection has 3+ distinct
 *  base models (not size variants of one item); over $1,000 always include —
 *  buying guide and compare table coexist on high-AOV equipment pages. */
export function shouldIncludeCompare(products: GenProduct[]): { include: boolean; reason: string } {
  const med = medianPrice(products);
  if (med === 0) return { include: false, reason: "no priced products" };
  if (med < 300) return { include: false, reason: `median ${fmt(med)} under $300 — buying guide covers the decision` };
  if (med > 1000) return { include: true, reason: `median ${fmt(med)} over $1,000 — buying guide and compare coexist` };
  // base model = title tokens minus anything with digits (kW ratings, person
  // counts, sizes) so "KIP 4.5kW" and "KIP 6kW" collapse to one base model
  const bases = new Set(products.map((p) => tokenize(p.title).filter((t) => !/\d/.test(t)).slice(0, 3).join(" ")).filter(Boolean));
  const include = bases.size >= 3;
  return { include, reason: `median ${fmt(med)}; ${bases.size} distinct base model(s) — ${include ? "included" : "primarily variants of the same item, omitted"}` };
}

const ACCESSORY_TYPE = /accessor|recovery tool|towel|aromatherap|thermometer|hygrometer|bucket|ladle|backrest|consumable|essential oil|salt|light therapy/i;
const EQUIPMENT_TYPE = /sauna|heater|hyperbaric|chamber|plunge|gym|cardio|ionizer|shower|tub|treadmill|bike|rower|massage chair/i;

/** Ownership-section variant (July 31): the product TYPE decides, never price.
 *  Equipment = freight + setup + ongoing maintenance. Accessory = ground
 *  shipping, no setup, rinse-and-dry care, prominent returns. */
export function detectOwnershipVariant(products: GenProduct[]): "equipment" | "accessory" {
  let acc = 0, eq = 0;
  for (const p of products) {
    const t = p.productType || "";
    if (ACCESSORY_TYPE.test(t)) acc++;       // "Sauna Accessory" must win over "Sauna"
    else if (EQUIPMENT_TYPE.test(t)) eq++;
  }
  if (acc === 0 && eq === 0) return medianPrice(products) < 300 ? "accessory" : "equipment";
  return acc > eq ? "accessory" : "equipment";
}

/** Map a Shopify vendor name to its live brand-collection handle, if we carry one. */
export function brandCollectionHandle(vendor: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const v = norm(vendor);
  if (!v) return null;
  const hit = BRAND_COLLECTIONS.find((b) => {
    const n = norm(b.name);
    return n === v || n.startsWith(v) || v.startsWith(n);
  });
  return hit ? hit.handle : null;
}

// ── learning-center article selection ────────────────────────────────────────
// Picks the 4 most RELEVANT articles (1 pillar + 3 cluster) from the full blog
// catalog instead of carrying whatever the old page happened to link. Tokens
// are weighted by inverse frequency across the catalog, so on a "sauna
// accessories" collection the word "accessories" (rare) outweighs "sauna"
// (in half the catalog) — bucket/ladle articles beat hybrid-sauna articles.
export type CatalogArticle = { title: string; url: string; category?: string | null };

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "vs", "with", "your", "you", "how", "what", "why", "is", "are", "best", "guide", "complete", "2024", "2025", "2026", "buying", "sale"]);
const tokenize = (s: string): string[] => [...new Set(
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .map((w) => w.replace(/([^s])s$/, "$1"))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
)];

export function selectLearningLinks(
  catalog: CatalogArticle[],
  keywords: string[],
  fallback: { url: string; title: string }[],
  count = 4,
  /** Ultimate-guide pages (/pages/*-ultimate-guide): the best keyword match
   *  among these ALWAYS takes the pillar slot when one exists. */
  pillarCandidates: CatalogArticle[] = [],
): { url: string; title: string }[] {
  const kwTokens = [...new Set(keywords.flatMap(tokenize))];
  if ((catalog.length === 0 && pillarCandidates.length === 0) || kwTokens.length === 0) return fallback.slice(0, count);
  // inverse-frequency weight per token across the catalog; a match in the
  // TITLE counts full weight, a match only in the category tag counts half
  const freq = new Map<string, number>();
  const titleTokens = catalog.map((a) => new Set(tokenize(a.title)));
  const catTokens = catalog.map((a) => new Set(tokenize(a.category || "")));
  for (const toks of titleTokens) for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
  const weight = (t: string) => 1 / Math.log2(2 + (freq.get(t) || 0));
  const scored = catalog.map((a, i) => {
    let score = 0; let matched = 0; let rareMatched = false;
    for (const t of kwTokens) {
      if (titleTokens[i].has(t)) { score += weight(t); matched++; if ((freq.get(t) || 0) <= 5) rareMatched = true; }
      else if (catTokens[i].has(t)) { score += 0.5 * weight(t); matched++; }
    }
    return { a, score, matched, rareMatched };
  })
    // TOPICALLY relevant only (July 31 rule): 2+ matched tokens required.
    // A single-token match is never enough — one shared common word ("sauna")
    // or one rare word from a secondary keyword ("glass" pulled a sauna-door
    // article onto water bottles) is not topical relevance. Category-tag
    // matches count toward the two. Route flags the gap when <3 survive.
    .filter((x) => x.matched >= Math.min(2, kwTokens.length))
    .sort((x, y) => y.score - x.score || y.matched - x.matched || x.a.title.length - y.a.title.length);
  const picks = scored.slice(0, count).map((x) => ({ url: x.a.url, title: x.a.title }));
  // Ultimate guide takes the pillar slot when one matches the collection.
  // Requires 2+ matched tokens (or all of them, for one-word keywords) so a
  // "Sauna Accessories" collection can't pull the outdoor-saunas guide on
  // the shared word "sauna" alone.
  const minMatch = Math.min(2, kwTokens.length);
  const pillarScored = pillarCandidates.map((a) => {
    const toks = new Set(tokenize(`${a.title} ${a.url}`));
    let score = 0; let matched = 0;
    for (const t of kwTokens) if (toks.has(t)) { score += weight(t); matched++; }
    return { a, score, matched };
  }).filter((x) => x.matched >= minMatch)
    .sort((x, y) => y.score - x.score || y.matched - x.matched);
  if (pillarScored[0]) {
    const p = { url: pillarScored[0].a.url, title: pillarScored[0].a.title };
    const dup = picks.findIndex((x) => x.url === p.url);
    if (dup !== -1) picks.splice(dup, 1);
    picks.unshift(p);
    if (picks.length > count) picks.length = count;
  } else {
    // no ultimate guide: prefer a "guide"/"complete" article as pillar
    const gi = picks.findIndex((p) => /guide|complete/i.test(p.title));
    if (gi > 0) picks.unshift(picks.splice(gi, 1)[0]);
  }
  // NO padding from the old page's links (July 31 rule): if fewer than 3
  // topically relevant posts exist, the section is omitted and flagged as a
  // content gap rather than filled with off-topic posts. The fallback list is
  // only used when the catalog itself was unavailable (early return above).
  return picks;
}

// ── design-language building blocks (inline styles; classes only for
//    hover/responsive behavior defined in the theme's ppw-collections.css) ───
const PADX = "clamp(16px,4vw,40px)";
const F = "Poppins,sans-serif";
const NAVY = "#09195B";
const GOLD_TEXT = "#8a6d2f";

// All shared styling lives in the THEME asset ppw-collections.css (v2
// component classes) — Shopify caps collection body_html at 64 KB, so the
// generator emits classes and keeps only one-off values inline.
const SECTION_CLS: Record<string, string> = {
  white: "",
  "white-b": " ppw-sec-b",
  cream: " ppw-sec-cream",
  navy: " ppw-sec-navy",
  blush: " ppw-sec-blush",
};

function secOpen(id: string, bg: keyof typeof SECTION_CLS): string {
  return `<section id="${id}" class="ppw-anchor ppw-sec${SECTION_CLS[bg]}${id === "faq" ? " faq-modern" : ""}">`;
}

function eyebrow(text: string, onNavy = false): string {
  return `<div class="ppw-eyebrow${onNavy ? " ppw-eyebrow-light" : ""}">${text}</div>`;
}

function h2big(text: string, opts: { size?: number; mb?: number; color?: string } = {}): string {
  const { size = 28, mb = 24, color = NAVY } = opts;
  const st = `${size !== 28 ? `font-size:${size}px;` : ""}${mb !== 24 ? `margin-bottom:${mb}px;` : ""}${color !== NAVY ? `color:${color};` : ""}`;
  return `<h2 class="ppw-h2"${st ? ` style="${st}"` : ""}>${text}</h2>`;
}

function para(text: string, mb = 12): string {
  return `<p class="ppw-p"${mb !== 12 ? ` style="margin-bottom:${mb}px"` : ""}>${text}</p>`;
}

const CHECK_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="3.5" stroke-linecap="round"><path d="m5 13 5 5L20 6"></path></svg>`;

function checkRow(label: string, text: string): string {
  return `<div class="ppw-check"><span>${CHECK_SVG}</span><span><strong>${label}:</strong> ${text}</span></div>`;
}

const BADGE_CLS = ["ppw-badge-gold", "ppw-badge-navy", "ppw-badge-dark"];

function pickCard(p: GenProduct, badge: string, badgeCls: string, specs: string[], showVendor: boolean): string {
  const img = p.imageUrl
    ? `<img src="${escAttr(p.imageUrl)}" alt="${escAttr(p.title)}" loading="lazy" />`
    : `<span style="font:700 10.5px/1 ${F};letter-spacing:.08em;text-transform:uppercase;color:#a3aab8;display:grid;place-items:center;height:100%">${escAttr(p.vendor || "Product")}</span>`;
  const specLines = specs.slice(0, 3).map((s) => `<span>${s}</span>`).join("");
  return `<a class="ppw-hv-gold ppw-pick" href="/products/${p.handle}">
<div class="ppw-pick-img">${img}<span class="ppw-badge ${badgeCls}">${badge}</span></div>
<div class="ppw-pick-body">
${showVendor && p.vendor ? `<div class="ppw-pick-vendor">${p.vendor}</div>` : ""}
<div class="ppw-pick-title">${p.title}</div>
<div class="ppw-pick-specs">${specLines}</div>
<span class="ppw-pick-price">${fmt(p.price)}</span>
<span class="ppw-cta">View Model &rsaquo;</span>
</div></a>`;
}

const OWN_ICONS: Record<string, string> = {
  shipping: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dfc18e" stroke-width="1.8" stroke-linecap="round"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"></path><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`,
  install: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dfc18e" stroke-width="1.8" stroke-linecap="round"><path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.8 2.8 0 0 1-4-4z"></path><path d="m17 3 4 4"></path></svg>`,
  warranty: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dfc18e" stroke-width="1.8" stroke-linecap="round"><path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6z"></path><path d="m9 12 2 2 4-4"></path></svg>`,
  care: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dfc18e" stroke-width="1.8" stroke-linecap="round"><path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z"></path><path d="M12 8v8"></path><path d="M8.5 10.5h7"></path></svg>`,
};

export type OwnershipCard = { text: string; meta: string[] };

function ownershipCardHtml(kind: string, title: string, card: OwnershipCard): string {
  const meta = (card.meta || []).slice(0, 2).map((m) => `<span>${m}</span>`).join("");
  return `<div class="ppw-own">
<div class="ppw-own-head">${OWN_ICONS[kind]}<h3>${title}</h3></div>
<p>${card.text}</p>
${meta ? `<div class="ppw-own-meta">${meta}</div>` : ""}
</div>`;
}

/** Design-language compare table (max 6 rows). Image column per July 31 rule:
 *  96px thumbnail, radius 8, ~140px fixed column, bold model name below.
 *  Text-only compare tables are not acceptable for published pages. */
function compareSectionHtml(rows: GenProduct[], heading: string, shortDesc: (d: string, words?: number) => string): string {
  return `${secOpen("compare", "cream")}${eyebrow("Side by Side")}${h2big(heading)}
<div class="ppw-cmp-wrap"><div class="ppw-cmp-scroll"><table class="ppw-cmp">
<tr><th></th><th>Model</th><th>Highlights</th><th>Price</th><th></th></tr>
${rows.map((p) => `<tr>
<td class="ti">${p.imageUrl ? `<img src="${escAttr(p.imageUrl)}" alt="${escAttr(p.title)}" width="96" loading="lazy" /><div>${p.title.split(/\s+/).slice(0, 4).join(" ")}</div>` : ""}</td>
<td class="tm">${p.title}</td>
<td>${shortDesc(p.description)}</td>
<td class="tp">${fmt(p.price)}</td>
<td><a class="ts" href="/products/${p.handle}">Shop &rsaquo;</a></td>
</tr>`).join("\n")}
</table></div></div></section>`;
}

function faqItem(q: string, a: string, open: boolean): string {
  return `<div class="item"><details${open ? " open" : ""}><summary><span>${q}</span><span class="chev">&#8964;</span></summary><div class="body"><p>${a}</p></div></details></div>`;
}

// ── page assembly (step 3) ───────────────────────────────────────────────────
export type GeneratedSections = {
  h2: string;               // first H2 text ([Keyword] — [Differentiator])
  intro: string;            // overview paragraph 1 (no tags)
  intro2?: string;          // overview paragraph 2
  bullets: { label: string; text: string }[]; // up to 6 check rows
  faq: { q: string; a: string }[];            // 12-14
  /** 3 short spec lines per featured product, keyed by product handle */
  picks?: { handle: string; specs: string[] }[];
  buyingGuide?: { heading: string; bullets: { label: string; text: string }[] }[]; // 3 cards (category)
  benefits: { emoji: string; heading: string; text: string }[];                    // 4 cards
  spaceStats?: { stat: string; heading: string; text: string }[];  // 3 stat cards (category)
  /** equipment variant uses shipping/install/warranty/care; accessory variant
   *  uses warranty/care/returns (July 31 rules update) */
  ownership?: { shipping?: OwnershipCard; install?: OwnershipCard; warranty: OwnershipCard; care: OwnershipCard; returns?: OwnershipCard };
  // brand-only
  brandGlance?: { label: string; value: string }[];  // at-a-glance rows (5)
  tiers?: { tierLabel: string; name: string; specs: { label: string; value: string }[]; text: string }[]; // 3
  fit?: { yes: string[]; no: string[] };             // 4 + 4
  certs?: { para: string; items: { title: string; text: string }[] }; // 4 tiles
  story?: string[];                                  // 1-2 paragraphs
  brandDescription?: string;
  seoDescription?: string;  // 150-160 chars, pk EARLY, price range, NEVER shipping claims
  seoTitle?: string;        // 50-60 chars, pk first, NEVER the store name
  // legacy fields (pre-v2 contract) — used only as ownership fallback
  space?: { rows: string[][] };
  delivery?: { heading: string; text: string }[];
  care?: { cleaning: string[]; maintenance: string[]; warranty: string[] };
};

function ownershipOf(g: GeneratedSections): NonNullable<GeneratedSections["ownership"]> | null {
  if (g.ownership && g.ownership.warranty && (g.ownership.shipping || g.ownership.returns)) return g.ownership;
  const d = g.delivery || [];
  if (d.length === 0 && !g.care) return null;
  const joined = (arr?: string[]) => (arr || []).slice(0, 3).join(" ");
  return {
    shipping: { text: d[1]?.text || d[0]?.text || "", meta: [] },
    install: { text: d[2]?.text || "", meta: [] },
    warranty: { text: joined(g.care?.warranty), meta: [] },
    care: { text: [joined(g.care?.cleaning), joined(g.care?.maintenance)].filter(Boolean).join(" "), meta: [] },
  };
}

export function assemblePage(opts: {
  isBrand: boolean;
  catLabel: string;
  sections: GeneratedSections;
  featured: GenProduct[];
  allProducts: GenProduct[];
  preserved: PreservedElements;
  collectionUrl: string;
  collectionTitle: string;
  brandName?: string | null;
  heroImageUrl?: string | null;
  /** category pages: median-price compare rule result (brand pages always show it) */
  includeCompare?: boolean;
  ownershipVariant?: "equipment" | "accessory";
}): string {
  const { isBrand, catLabel, sections: g, featured, allProducts, preserved, collectionUrl, collectionTitle, brandName, heroImageUrl } = opts;
  const ownVariant = opts.ownershipVariant || "equipment";
  const parts: string[] = [];
  const navItems: { id: string; label: string }[] = [];
  const vendors = [...new Set(allProducts.map((p) => p.vendor).filter(Boolean))];
  const specsFor = (p: GenProduct): string[] => {
    const ai = (g.picks || []).find((x) => x.handle === p.handle);
    if (ai && ai.specs && ai.specs.length) return ai.specs;
    const d = strip(p.description);
    return d ? [d.split(/\s+/).slice(0, 12).join(" ")] : [];
  };
  const shortDesc = (d: string, words = 20) => strip(d).split(/\s+/).slice(0, words).join(" ");

  // ── 1. Overview / Why ─────────────────────────────────────────────────────
  const overviewId = isBrand ? "why" : "overview";
  navItems.push({ id: overviewId, label: isBrand ? `Why ${brandName || "This Brand"}` : "Overview" });
  const checks = (isBrand ? g.bullets.slice(0, 3) : g.bullets.slice(0, 6)).map((b) => checkRow(b.label, b.text)).join("\n");
  // NO product/brand counts anywhere — inventory changes weekly and printed
  // counts go stale immediately (partner rule, Aug 3)
  const introBlock = `${eyebrow(isBrand ? "Our Take" : catLabel)}
${h2big(g.h2, { size: isBrand ? 28 : 34, mb: 14 })}
${para(g.intro)}
${g.intro2 ? para(g.intro2, 22) : ""}
<div style="display:flex;flex-direction:column;gap:11px">${checks}</div>`;

  if (isBrand) {
    const logo = brandName ? brandLogo(brandName) : null;
    const glanceRows = (g.brandGlance || []).slice(0, 6);
    const glance = glanceRows.length
      ? `<div class="ppw-glance">
${logo ? `<div style="height:44px;display:flex;align-items:center;margin-bottom:12px"><img src="${escAttr(logo)}" alt="${escAttr(brandName || "")} logo" loading="lazy" style="max-height:40px;max-width:70%;object-fit:contain" /></div>` : ""}
<div class="ppw-glance-label">At a Glance</div>
<div class="ppw-glance-rows">
${glanceRows.map((r) => `<div class="ppw-glance-row"><span>${r.label}</span><span>${r.value}</span></div>`).join("\n")}
</div></div>`
      : "";
    parts.push(`${secOpen(overviewId, "white")}${glance ? `<div class="ppw-split-320" style="gap:32px;align-items:start"><div>${introBlock}</div>${glance}</div>` : introBlock}</section>`);
  } else {
    const hero = heroImageUrl
      ? `<figure class="ppw-fig"><img src="${escAttr(heroImageUrl)}" alt="${escAttr(collectionTitle)}" loading="lazy" /></figure>`
      : "";
    parts.push(`${secOpen(overviewId, "white")}${hero ? `<div class="ppw-split-380" style="gap:36px;align-items:start"><div>${introBlock}</div>${hero}</div>` : introBlock}</section>`);
  }

  // ── 2. Top picks / Lineup ─────────────────────────────────────────────────
  if (featured.length > 0) {
    const picksId = isBrand ? "lineup" : "picks";
    navItems.push({ id: picksId, label: isBrand ? "Featured Models" : "Top Picks" });
    const badges = isBrand ? ["Entry", "Most Popular", "Flagship"] : ["Best Value", "Best Seller", "Flagship"];
    // featured arrives sorted ascending by price; category leads with the mid pick
    const order = !isBrand && featured.length === 3 ? [1, 0, 2] : featured.map((_, i) => i);
    const cards = order.map((idx) => {
      const p = featured[idx];
      return pickCard(p, badges[Math.min(idx, badges.length - 1)] || "Featured", BADGE_CLS[Math.min(idx, 2)], specsFor(p), !isBrand);
    }).join("\n");
    parts.push(`${secOpen(picksId, "cream")}
<div style="margin-bottom:24px">${eyebrow(isBrand ? "Featured Models" : "Hand-Picked")}${h2big(isBrand ? `${brandName ? `${brandName} ` : ""}Models to Start With` : `${featured.length === 3 ? "Three" : "The"} We Recommend First`, { mb: 0 })}</div>
<div class="ppw-g3" style="gap:20px">${cards}</div></section>`);
  }

  // ── preserved: quiz CTA (after picks) ─────────────────────────────────────
  // Re-emitted in the standard section design, never as the old raw markup.
  // One look for every collection: the per-category palettes (red light red,
  // sauna wood-brown) are gone deliberately.
  if (preserved.quiz) {
    const q = preserved.quiz;
    navItems.push({ id: "quiz", label: "Find Your Match" });
    parts.push(`${secOpen("quiz", "cream")}${eyebrow("Not Sure Where to Start?")}${h2big(q.title || `Find Your ${catLabel} Match`, { mb: q.desc ? 12 : 22 })}
${q.desc ? para(q.desc, 22) : ""}
<a class="ppw-hv-cream ppw-pillar" href="${escAttr(q.url)}">
<div><div class="ppw-pillar-kicker">Interactive Quiz</div>
<div class="ppw-pillar-title">${q.title || `Which ${catLabel} Is Right for You?`}</div></div>
<span class="ppw-pillar-cta">Take the Quiz &rsaquo;</span>
</a></section>`);
  }

  if (!isBrand) {
    // ── 3. Buying guide (three decisions) ───────────────────────────────────
    if (g.buyingGuide && g.buyingGuide.length > 0) {
      navItems.push({ id: "guide", label: "How to Choose" });
      const cards = g.buyingGuide.slice(0, 3).map((c, i) => `<div class="ppw-hv-lift ppw-gcard">
<div class="ppw-ghead"><span class="ppw-gnum">0${i + 1}</span><h3>${c.heading}</h3></div>
<div class="ppw-glist">${c.bullets.slice(0, 3).map((b) => `<p><strong>${b.label}:</strong> ${b.text}</p>`).join("\n")}</div>
</div>`).join("\n");
      parts.push(`${secOpen("guide", "white-b")}${eyebrow("Buying Guide")}${h2big(`${catLabel} Buying Guide: Three Decisions`, { mb: 8 })}
${para("Answer these in order and the shortlist writes itself.", 26)}
<div class="ppw-g3" style="gap:20px">${cards}</div></section>`);
    }

    // ── 3b. Compare table (median-price rule, July 31): coexists with the
    //        buying guide on qualifying equipment collections ────────────────
    if (opts.includeCompare && allProducts.length >= 2) {
      navItems.push({ id: "compare", label: "Compare" });
      parts.push(compareSectionHtml(selectFeatured(allProducts, Math.min(6, allProducts.length), { title: collectionTitle, keyword: catLabel }), `Compare ${catLabel}`, shortDesc));
    }

    // ── 4. Key benefits ─────────────────────────────────────────────────────
    navItems.push({ id: "benefits", label: "Benefits" });
    const bCards = g.benefits.slice(0, 4).map((b) => `<div class="ppw-bcard"><span class="ppw-bicon">${b.emoji}</span><div><h3>${b.heading}</h3><p>${b.text}</p></div></div>`).join("\n");
    parts.push(`${secOpen("benefits", opts.includeCompare ? "white-b" : "cream")}${eyebrow(`Why ${catLabel}`)}${h2big(`Key Benefits of ${catLabel}`, { mb: 26 })}<div class="ppw-g2" style="gap:18px">${bCards}</div></section>`);

    // ── 5. Brands in this category ──────────────────────────────────────────
    if (vendors.length >= 2) {
      const counts = new Map<string, number>();
      for (const p of allProducts) if (p.vendor) counts.set(p.vendor, (counts.get(p.vendor) || 0) + 1);
      const tiles = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v]) => {
        const logo = brandLogo(v);
        const handle = brandCollectionHandle(v);
        const inner = `<div class="ppw-blogo">${logo ? `<img src="${escAttr(logo)}" alt="${escAttr(v)} logo" loading="lazy" />` : `<span>${v}</span>`}</div>
<div class="ppw-btile-name">${v}</div>
${handle ? `<span class="ppw-btile-cta">Shop Brand &rsaquo;</span>` : ""}`;
        return handle
          ? `<a class="ppw-hv-tile ppw-btile" href="/collections/${handle}">${inner}</a>`
          : `<div class="ppw-btile">${inner}</div>`;
      }).join("\n");
      navItems.push({ id: "brands", label: "Brands" });
      parts.push(`${secOpen("brands", "white-b")}
<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:22px;flex-wrap:wrap">
<div>${eyebrow("Authorized Dealer")}${h2big("Brands in This Category", { mb: 0 })}</div>
<span style="font:500 12px/1.5 ${F};color:#6b7280;max-width:34ch;text-align:right">Every brand here ships from an authorized dealer with full manufacturer warranty.</span>
</div>
<div class="ppw-g4" style="gap:16px">${tiles}</div></section>`);
    }

    // ── 6. Space & placement stats ──────────────────────────────────────────
    if (g.spaceStats && g.spaceStats.length > 0) {
      navItems.push({ id: "space", label: "Space" });
      const sCards = g.spaceStats.slice(0, 3).map((s) => `<div class="ppw-stat"><div class="ppw-stat-num">${s.stat}</div><h3>${s.heading}</h3><p>${s.text}</p></div>`).join("\n");
      parts.push(`${secOpen("space", "cream")}${eyebrow("Before You Buy")}${h2big("Space and Placement", { mb: 8 })}
${para("Measure twice. These are the numbers that cause returns.", 24)}
<div class="ppw-g3" style="gap:18px">${sCards}</div></section>`);
    }
  } else {
    // ── BRAND: tiers ────────────────────────────────────────────────────────
    if (g.tiers && g.tiers.length > 0) {
      navItems.push({ id: "tiers", label: "The Lineup" });
      const tCards = g.tiers.slice(0, 3).map((t, i) => {
        const mid = i === 1;
        const specRows = (t.specs || []).slice(0, 4).map((s) => `<div class="ppw-tier-row"><span>${s.label}</span><span>${s.value}</span></div>`).join("\n");
        return `<div class="ppw-tier${mid ? " ppw-tier-mid" : ""}">
<div class="ppw-tier-head"><div class="ppw-tier-kicker">${t.tierLabel}</div><div class="ppw-tier-name">${t.name}</div></div>
<div class="ppw-tier-body">${specRows}<p>${t.text}</p></div>
</div>`;
      }).join("\n");
      parts.push(`${secOpen("tiers", "white-b")}${eyebrow("The Lineup, Explained")}${h2big("Entry, Mid and Flagship", { mb: 8 })}
${para("Here is what actually changes between tiers.", 26)}
<div class="ppw-g3" style="gap:18px;align-items:start">${tCards}</div></section>`);
    }

    // ── BRAND: compare table (max 6 models, live prices — primary navigation) ─
    navItems.push({ id: "compare", label: "Compare Models" });
    parts.push(compareSectionHtml(selectFeatured(allProducts, Math.min(6, allProducts.length), { title: collectionTitle, keyword: brandName || catLabel }), `Compare ${brandName || catLabel} Models`, shortDesc));

    // ── BRAND: honest fit ───────────────────────────────────────────────────
    if (g.fit && ((g.fit.yes || []).length > 0 || (g.fit.no || []).length > 0)) {
      navItems.push({ id: "fit", label: "Honest Fit" });
      const list = (items: string[], plus: boolean) => items.slice(0, 4).map((t) => `<div class="ppw-fit-row"><span style="color:${plus ? "#16a34a" : "#94a3b8"}">${plus ? "+" : "&ndash;"}</span><span>${t}</span></div>`).join("\n");
      parts.push(`${secOpen("fit", "white-b")}${eyebrow("Honest Fit")}${h2big(`Who ${brandName || "This Brand"} Is For`)}
<div class="ppw-g2" style="gap:18px">
<div class="ppw-fitcard" style="border-top:3px solid #16a34a"><h3 style="color:#16a34a">A Good Fit If You</h3><div class="ppw-fitlist">${list(g.fit.yes || [], true)}</div></div>
<div class="ppw-fitcard" style="border-top:3px solid #94a3b8"><h3 style="color:#64748b">Look Elsewhere If You</h3><div class="ppw-fitlist">${list(g.fit.no || [], false)}</div></div>
</div></section>`);
    }

    // ── BRAND: key benefits ─────────────────────────────────────────────────
    if (g.benefits && g.benefits.length > 0) {
      navItems.push({ id: "benefits", label: "Benefits" });
      const bbCards = g.benefits.slice(0, 4).map((b) => `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;display:flex;gap:16px;background:#fff">
<span style="flex:none;width:46px;height:46px;border-radius:12px;background:#f9fafb;border:1px solid #eef0f3;display:grid;place-items:center;font-size:20px">${b.emoji}</span>
<div><h3 style="margin:0 0 6px;font:800 15px/1.2 ${F};text-transform:uppercase;letter-spacing:.02em;color:${NAVY}">${b.heading}</h3><p style="margin:0;font:400 13.5px/1.6 ${F};color:#4b5563">${b.text}</p></div>
</div>`).join("\n");
      parts.push(`${secOpen("benefits", "cream")}${eyebrow(`Why ${brandName || catLabel}`)}${h2big(`Key Benefits of ${brandName ? `${brandName} ` : ""}${catLabel}`, { mb: 26 })}<div class="ppw-g2" style="gap:18px">${bbCards}</div></section>`);
    }

    // ── BRAND: certifications & construction ────────────────────────────────
    if (g.certs && g.certs.items && g.certs.items.length > 0) {
      navItems.push({ id: "certs", label: "Build Quality" });
      const shield = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1E40AF" stroke-width="1.8" stroke-linecap="round" style="flex:none;margin-top:2px"><path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6z"></path></svg>`;
      const tiles = g.certs.items.slice(0, 4).map((c) => `<div class="ppw-ctile">${shield}<div><div class="ppw-ctile-title">${c.title}</div><div class="ppw-ctile-sub">${c.text}</div></div></div>`).join("\n");
      const detailImg = featured[1]?.imageUrl || featured[0]?.imageUrl || null;
      const fig = detailImg ? `<figure class="ppw-fig"><img src="${escAttr(detailImg)}" alt="${escAttr(brandName || catLabel)} construction detail" loading="lazy" /></figure>` : "";
      const inner = `${eyebrow("Build Quality")}${h2big("Certifications and Construction", { mb: 18 })}${para(g.certs.para, 20)}<div class="ppw-g2" style="gap:14px">${tiles}</div>`;
      parts.push(`${secOpen("certs", "white-b")}${fig ? `<div class="ppw-split-340" style="gap:32px;align-items:start"><div>${inner}</div>${fig}</div>` : inner}</section>`);
    }

    // ── BRAND: story ────────────────────────────────────────────────────────
    if (g.story && g.story.length > 0) {
      navItems.push({ id: "story", label: "Story" });
      parts.push(`${secOpen("story", "blush")}<div style="max-width:74ch">${eyebrow("Heritage")}${h2big(`The ${brandName || catLabel} Story`, { size: 24, mb: 16 })}
${g.story.slice(0, 2).map((p) => para(p)).join("\n")}
</div></section>`);
    }
  }

  // ── Ownership block: equipment variant (freight/setup/warranty/care) or
  //    accessory variant (warranty/care/returns) per product type ────────────
  const own = ownershipOf(g);
  if (own) {
    navItems.push({ id: "ownership", label: "Ownership" });
    const isAccessory = ownVariant === "accessory";
    const cards = isAccessory
      ? [
          own.warranty ? ownershipCardHtml("warranty", "Warranty &amp; Support", own.warranty) : "",
          own.care ? ownershipCardHtml("care", "Care &amp; Cleaning", own.care) : "",
          own.returns ? ownershipCardHtml("shipping", "Returns", own.returns) : "",
        ].filter(Boolean)
      : [
          own.shipping ? ownershipCardHtml("shipping", "Shipping &amp; Freight", own.shipping) : "",
          own.install ? ownershipCardHtml("install", "Setup &amp; Installation", own.install) : "",
          own.warranty ? ownershipCardHtml("warranty", "Warranty &amp; Support", own.warranty) : "",
          own.care ? ownershipCardHtml("care", "Care &amp; Maintenance", own.care) : "",
        ].filter(Boolean);
    parts.push(`${secOpen("ownership", "navy")}
<div style="margin-bottom:24px">${eyebrow(isAccessory ? "Warranty &middot; Care &middot; Returns" : "Delivery &middot; Install &middot; Warranty &middot; Care", true)}${h2big(isAccessory ? "Ownership: Warranty, Care and Returns" : "Ownership: Delivery, Install, Warranty and Care", { mb: 0, color: "#fff" })}</div>
<div class="${cards.length === 3 ? "ppw-g3" : "ppw-g2"}" style="gap:16px">
${cards.join("\n")}
</div></section>`);
  }

  // ── Learning center (preserved links, ≥3) ─────────────────────────────────
  if (preserved.learningLinks.length >= 3) {
    navItems.push({ id: "learning", label: "Learn" });
    const [pillar, ...rest] = preserved.learningLinks;
    const tiles = rest.slice(0, 3).map((l) => `<a class="ppw-hv-tile ppw-ltile" href="${escAttr(l.url)}">
<div class="ppw-ltile-kicker">From the Learning Center</div>
<div class="ppw-ltile-title">${l.title}</div>
</a>`).join("\n");
    parts.push(`${secOpen("learning", "white-b")}${eyebrow("Read Before You Buy")}${h2big(`Complete ${catLabel} Learning Center`, { mb: 22 })}
<a class="ppw-hv-cream ppw-pillar" href="${escAttr(pillar.url)}">
<div><div class="ppw-pillar-kicker">${pillar.url.includes("/pages/") ? "Ultimate Guide" : "Pillar Guide"}</div>
<div class="ppw-pillar-title">${pillar.title}</div></div>
<span class="ppw-pillar-cta">Read Guide &rsaquo;</span>
</a>
<div class="ppw-g3" style="gap:16px">${tiles}</div></section>`);
  }

  // ── FAQ (.faq-modern, closes the page) ────────────────────────────────────
  navItems.push({ id: "faq", label: "FAQ" });
  parts.push(`${secOpen("faq", "cream")}${eyebrow("Questions")}${h2big(`${isBrand && brandName ? brandName : catLabel} FAQ`)}
<div class="ppw-faqcol">
${g.faq.map((f, i) => faqItem(f.q, f.a, i === 0)).join("\n")}
</div></section>`);

  // ── Nav pills (built last, placed first) ──────────────────────────────────
  const nav = `<nav aria-label="Quick navigation" style="display:flex;flex-wrap:wrap;gap:8px;padding:18px ${PADX} 0">${navItems.map((n) => `<a class="ppw-hv-nav ppw-pill" href="#${n.id}">${n.label}</a>`).join("")}</nav>`;

  // ── Schema (single @graph) ────────────────────────────────────────────────
  const graph: any[] = [];
  graph.push({
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://peakprimalwellness.com" },
      { "@type": "ListItem", position: 2, name: collectionTitle, item: collectionUrl },
    ],
  });
  graph.push({
    "@type": "FAQPage",
    mainEntity: g.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  });
  const itemListSrc = isBrand ? selectFeatured(allProducts, Math.min(6, allProducts.length), { title: collectionTitle, keyword: brandName || catLabel }) : featured;
  graph.push({
    "@type": "ItemList",
    name: isBrand && brandName ? `${brandName} Products at Peak Primal Wellness` : `Featured ${catLabel} at Peak Primal Wellness`,
    itemListElement: itemListSrc.map((p, i) => ({
      "@type": "ListItem", position: i + 1, name: p.title,
      url: `https://peakprimalwellness.com/products/${p.handle}`,
      offers: { "@type": "Offer", price: String(Math.round(p.price)), priceCurrency: "USD" },
    })),
  });
  if (isBrand && brandName) {
    graph.push({ "@type": "Brand", name: brandName, url: collectionUrl, ...(g.brandDescription ? { description: g.brandDescription } : {}) });
  }
  const schema = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>`;

  return `<div class="ppw-collection">\n${nav}\n${parts.join("\n")}\n${schema}\n</div>`;
}

/** Plural/suffix-tolerant keyword presence over the rendered page text.
 *  "barrel sauna" matches "barrel saunas"; hyphen/space separators both ok. */
export function keywordCoverage(html: string, keywords: string[]): { present: string[]; missing: string[] } {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
  const present: string[] = []; const missing: string[] = [];
  for (const kw of keywords) {
    const words = kw.toLowerCase().trim().split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, "").replace(/([^s])s$/, "$1")).filter(Boolean);
    if (words.length === 0) continue;
    const re = new RegExp("\\b" + words.map((w) => w + "[a-z]*").join("[\\s\\-,]+"), "i");
    (re.test(text) ? present : missing).push(kw);
  }
  return { present, missing };
}

// ── price-correction helpers: locate + replace AI text fields that contain
//    invented dollar figures (validation blocks any $200+ amount that is not
//    a live variant price; the route rewrites just those fields and retries) ──
export function findFieldsContaining(g: unknown, needles: string[]): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      if (needles.some((n) => v.includes(n))) out.push({ path, text: v });
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, path ? `${path}.${i}` : String(i)));
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
  };
  walk(g, "");
  return out;
}

export function setFieldAtPath(g: unknown, path: string, value: string): void {
  const parts = path.split(".");
  let o: any = g;
  for (let i = 0; i < parts.length - 1; i++) { o = o?.[parts[i]]; if (o == null) return; }
  if (o && typeof o === "object") o[parts[parts.length - 1]] = value;
}

/** The page text that price validation is allowed to look at.
 *
 *  Editorial link titles legitimately contain dollar figures — the Learning
 *  Center article "Kangen Water vs. Tyent vs. Echo: Is the $5,000 Price Tag a
 *  Scam?" is a real, well-targeted link for the Tyent page, but the price
 *  check read "$5,000" as a product price claim and blocked publishing on an
 *  otherwise clean page (2026-08-13). A headline is never a price claim, so
 *  scripts, the Learning Center section, and the anchor text of article/page
 *  links are removed before any figure is scanned. Product cards, body copy,
 *  bullets and FAQ answers — everywhere a real price claim can appear — are
 *  still checked exactly as before.
 */
export function priceScanText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<section\b[^>]*id="[^"]*learning[^"]*"[\s\S]*?<\/section>/gi, " ")
    .replace(/<a\b[^>]*href="[^"]*\/(?:blogs|pages)\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

// ── step 5: five pre-publish checks (pure, also used by route before saving) ──
export function validateGenerated(html: string, liveProducts: GenProduct[], originalQ1?: string | null, originalQ2?: string | null): string[] {
  const blockers: string[] = [];
  // Shopify hard-caps collection body_html at 64 KB
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > 63000) blockers.push(`page is ${(bytes / 1024).toFixed(1)} KB — Shopify caps collection descriptions at 64 KB`);
  const ld = (html.match(/<script[^>]*type=["']application\/ld\+json["']/gi) || []).length;
  if (ld !== 1) blockers.push(`schema tags: ${ld} (must be exactly 1)`);
  const idCounts = new Map<string, number>();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) idCounts.set(m[1], (idCounts.get(m[1]) || 0) + 1);
  const dups = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (dups.length) blockers.push(`duplicate id(s): ${dups.slice(0, 4).join(", ")}`);
  const valid = new Set(liveProducts.map((p) => Math.round(p.price)));
  const clean = priceScanText(html);
  const stale: number[] = [];
  for (const m of clean.matchAll(/\$\s?([\d,]+)(?:\.\d{2})?/g)) {
    const before = clean.slice(Math.max(0, (m.index || 0) - 16), m.index || 0);
    if (/save|off|discount|deposit|financ|as low as/i.test(before)) continue;
    const n = Math.round(parseFloat(m[1].replace(/,/g, "")));
    if (n >= 200 && ![n - 1, n, n + 1].some((x) => valid.has(x))) stale.push(n);
  }
  if (stale.length) blockers.push(`price(s) not in live feed: ${[...new Set(stale)].slice(0, 5).map((n) => "$" + n.toLocaleString()).join(", ")}`);
  // Q1/Q2 bleed check vs the ORIGINAL page's first two questions
  const answers = [...html.matchAll(/<div class="body"[^>]*><p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1]).toLowerCase());
  for (const [i, oldQ] of [originalQ1, originalQ2].entries()) {
    if (oldQ && answers[i] && answers[i].includes(oldQ.toLowerCase().slice(0, 40))) {
      blockers.push(`Q${i + 1} answer contains the ORIGINAL question text — content bleed`);
    }
  }
  // product handle validity — HREFs only (CDN image URLs also contain
  // "/products/<file>.jpg" and must not be treated as handles)
  const liveHandles = new Set(liveProducts.map((p) => p.handle));
  const used = [...new Set([...html.matchAll(/href="[^"]*?\/products\/([a-z0-9%\-_]+)[^"]*"/gi)].map((m) => m[1]))];
  const dead = used.filter((h) => !liveHandles.has(h));
  if (dead.length) blockers.push(`product handle(s) not in live feed: ${dead.slice(0, 4).join(", ")}`);
  return blockers;
}
