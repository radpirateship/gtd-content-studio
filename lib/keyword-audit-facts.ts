// lib/keyword-audit-facts.ts
//
// Ground truth for a collection's title and meta: which brands the collection
// actually carries and its real lowest and highest price, read live from
// Shopify. The recommendation prompt gets these as authoritative facts, and
// validateFacts() checks the output against them afterwards, because the
// model has been seen naming brands we do not stock (Clearlight, Sunlighten,
// Almost Heaven, Normatec) and quoting prices that are not on the page.

import { fetchAdminProductsDetailed } from "@/lib/shopify/products-admin";
import { callAI } from "@/lib/ai";
import { stripStoreName, type Recommendation } from "@/lib/keyword-audit";

export type CollectionFacts = {
  handle: string;
  vendors: string[];          // distinct vendor strings with at least one in-stock product, most products first
  vendorsAll: string[];       // every vendor in the collection, including sold out
  types: string[];            // distinct product types carried, most products first
  minPrice: number | null;
  maxPrice: number | null;
  medianPrice: number | null;
  priceAllowed: boolean;      // true when the lowest price represents the collection (not a cheap accessory outlier)
  priceReason: string;
  productCount: number;
};

// A "from $X" figure is allowed only when the cheapest product is in the same
// league as the typical one. Ryan (19 Oct 2026): prices are fine in metas,
// but not when a $3 accessory makes a sauna kit page say "from $3".
const PRICE_FLOOR_RATIO = 0.25;
// Ryan, 25 Oct 2026: prices change, compare-at pricing comes and goes, and
// figures in copy and metas go stale within weeks. Generated titles, metas and
// copy carry no dollar figures at all. Flip to false to go back to the
// representative-lowest-price rule.
export const NO_PRICES_IN_GENERATED_TEXT = true;

// Competitor and manufacturer names the model likes to reach for. Flagged even
// if the store's vendor table somehow lacks them.
export const BRAND_BLOCKLIST = [
  "Clearlight", "Sunlighten", "Almost Heaven", "Mr. Steam", "Mr Steam", "MrSteam", "Normatec", "Hyperice", "Theragun",
  "Joovv", "Mito Red", "Plunge", "Redwood Outdoors", "Sun Valley", "Northern Saunas", "Harvia Legend", "Peloton",
  "NordicTrack", "Bowflex", "Rogue Fitness", "Rogue", "Concept2", "Tonal", "Hydrow", "Sole", "ProForm", "Costco", "Wayfair", "Amazon",
  "Finnleo", "Helo", "Health Mate", "Dynamic Saunas Pro", "Golden Designs Pro", "Cedarbrook", "Thermory", "Hot Tub Haven",
];

export async function collectionFacts(handle: string): Promise<CollectionFacts | null> {
  const live = await fetchAdminProductsDetailed({ collectionHandle: handle, limit: 250 });
  if (!live.ok) return null;
  const counts = new Map<string, number>();
  const countsAll = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const prices: number[] = [];
  for (const p of live.products) {
    if (p.productType) typeCounts.set(p.productType, (typeCounts.get(p.productType) || 0) + 1);
    if (p.vendor) countsAll.set(p.vendor, (countsAll.get(p.vendor) || 0) + 1);
    if (p.vendor && p.inStock) counts.set(p.vendor, (counts.get(p.vendor) || 0) + 1);
    const price = Number(p.price);
    if (Number.isFinite(price) && price > 0) prices.push(price);
  }
  prices.sort((a, b) => a - b);
  const min = prices.length ? prices[0] : null;
  const max = prices.length ? prices[prices.length - 1] : null;
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const priceAllowed = !NO_PRICES_IN_GENERATED_TEXT && min != null && median != null && min >= median * PRICE_FLOOR_RATIO;
  const priceReason = NO_PRICES_IN_GENERATED_TEXT ? "house rule: no prices in generated titles, metas or copy, they go stale" : min == null ? "no prices on the page"
    : priceAllowed ? `lowest $${Math.round(min)} is representative (median $${Math.round(median!)})`
    : `lowest $${Math.round(min)} is an outlier against a median of $${Math.round(median!)}; no price in the meta`;
  return {
    handle,
    vendors: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([v]) => v),
    vendorsAll: Array.from(countsAll.entries()).sort((a, b) => b[1] - a[1]).map(([v]) => v),
    types: Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]).map(([t]) => t),
    minPrice: min, maxPrice: max, medianPrice: median, priceAllowed, priceReason, productCount: live.products.length,
  };
}

export function factsBlock(f: CollectionFacts): string {
  const money = (n: number | null) => n == null ? "unknown" : `$${Math.round(n).toLocaleString("en-US")}`;
  return `AUTHORITATIVE FACTS for /collections/${f.handle} (from the live store, ${f.productCount} products):
- Product types carried, most products first: ${f.types.length ? f.types.slice(0, 8).join(", ") : "(not set)"}. The title and meta must cover the WHOLE collection: when several types are carried, name the category and the range of types, never only one sub-type or one brand.
- Brands with in-stock products in THIS collection, most products first: ${f.vendors.length ? f.vendors.join(", ") : "(none listed)"}. Name only these brands in the title and meta. Any other brand name is forbidden${f.vendorsAll.length > f.vendors.length ? ` (sold out here, do not name: ${f.vendorsAll.filter((v) => !f.vendors.includes(v)).join(", ")})` : ""}.
- Prices: ${f.priceAllowed ? `you may say "from ${money(f.minPrice)}" in the meta, written exactly like that; no other figure is allowed.` : `do NOT put any price or dollar figure in the title or meta (${f.priceReason}).`} Never put a price in the title.`;
}

const PRICE_RE = /\$\s?\d[\d,]*(?:\.\d{2})?/g;


export type FactIssue = { kind: "brand" | "price" | "store"; value: string; field: "title_tag" | "meta_description" };

/** Find brand names that are not carried by this collection, and prices that are not its real low/high. */
// Ordinary category words that also show up as vendor strings or brand names
// ("Plunge" the brand vs "cold plunge"). Never treated as a brand to strip.
const GENERIC_WORDS = new Set(["sauna", "saunas", "plunge", "plunges", "heater", "heaters", "stove", "stoves", "infrared", "outdoor", "indoor",
  "cold", "hot", "steam", "barrel", "cabin", "cedar", "gym", "fitness", "wellness", "recovery", "clinical", "therapy", "light", "red", "home",
  "sport", "sports", "massage", "chamber", "chambers", "hyperbaric", "water", "ice", "bath", "tub", "tubs", "rack", "racks", "cage", "cages",
  "treadmill", "bike", "rower", "ladder", "paddle", "paddles", "pro", "max", "plus", "elite", "classic", "premium", "kit", "kits"]);

/** Words that belong to the recommendation's own keywords; a "brand" made only of these is not a brand hit. */
function protectedWords(rec: Recommendation, handle: string): Set<string> {
  const words = new Set<string>();
  for (const phrase of [rec.primary || "", ...(rec.secondaries || []), handle.replace(/-/g, " ")]) {
    for (const w of phrase.toLowerCase().split(/[^a-z0-9]+/)) if (w) words.add(w);
  }
  return words;
}

export function findFactIssues(rec: Recommendation, facts: CollectionFacts, storeVendors: string[]): FactIssue[] {
  const issues: FactIssue[] = [];
  const carried = new Set(facts.vendors.map((v) => v.toLowerCase()));
  const candidates = new Set<string>([...BRAND_BLOCKLIST, ...storeVendors]);
  const keywordWords = protectedWords(rec, facts.handle);
  for (const field of ["title_tag", "meta_description"] as const) {
    const text = rec[field] || "";
    const lower = text.toLowerCase();
    for (const brand of candidates) {
      const b = brand.toLowerCase();
      if (b.length < 3 || carried.has(b)) continue;
      const parts = b.split(/[^a-z0-9]+/).filter(Boolean);
      // skip if every word of the "brand" is a generic word or a word of this page's own keywords
      if (parts.every((w) => GENERIC_WORDS.has(w) || keywordWords.has(w))) continue;
      // a store vendor string that is a single short or generic word is too risky to strip mechanically
      if (!BRAND_BLOCKLIST.includes(brand) && parts.length === 1 && (parts[0].length < 5 || GENERIC_WORDS.has(parts[0]))) continue;
      // whole-word match so "Sole" does not hit "console"
      const re = new RegExp(`(^|[^a-z0-9])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`, "i");
      if (re.test(lower)) issues.push({ kind: "brand", value: brand, field });
    }
    if (field === "meta_description" && /peak primal/i.test(text)) issues.push({ kind: "store", value: "Peak Primal Wellness", field });
    for (const m of text.match(PRICE_RE) || []) {
      const v = Number(m.replace(/[$,\s]/g, ""));
      const isMin = facts.minPrice != null && Math.abs(v - facts.minPrice) < 1;
      const ok = field === "meta_description" && facts.priceAllowed && isMin;
      if (!ok) issues.push({ kind: "price", value: m, field });
    }
  }
  return issues;
}

/** Repair: ask the model to rewrite the meta (and title if a brand sits in it) with the facts pinned; fall back to a mechanical strip. */
export async function repairFacts(rec: Recommendation, facts: CollectionFacts, issues: FactIssue[]): Promise<Recommendation> {
  if (!issues.length) return rec;
  const out = { ...rec };
  const money = (n: number | null) => n == null ? "" : `$${Math.round(n).toLocaleString("en-US")}`;
  const badBrands = Array.from(new Set(issues.filter((i) => i.kind === "brand").map((i) => i.value)));
  const badPrices = Array.from(new Set(issues.filter((i) => i.kind === "price").map((i) => i.value)));
  // store name: deterministic strip, no model call needed
  if (issues.some((i) => i.kind === "store")) out.meta_description = stripStoreName(out.meta_description);
  const rest = issues.filter((i) => i.kind !== "store");
  if (!rest.length) return out;
  const fieldsHit = new Set(rest.map((i) => i.field));

  for (const field of ["title_tag", "meta_description"] as const) {
    if (!fieldsHit.has(field)) continue;
    const limit = field === "title_tag" ? 60 : 158;
    const floor = field === "title_tag" ? 45 : 140;
    try {
      const txt = await callAI(
        "You correct SEO copy. Return only the corrected text, nothing else. No em dashes, no en dashes, no quotes.",
        `Correct this ${field === "title_tag" ? "title tag" : "meta description"} for /collections/${facts.handle}.
${badBrands.length ? `Remove these brand names, which this collection does not carry: ${badBrands.join(", ")}. ` : ""}${badPrices.length ? (facts.priceAllowed && field === "meta_description" ? `Replace these price figures with exactly "from ${money(facts.minPrice)}" or remove them: ${badPrices.join(", ")}. ` : `Remove these price figures entirely (${facts.priceReason}): ${badPrices.join(", ")}. Use the space for a secondary keyword or a product type the collection carries. `) : ""}
Brands you MAY name (carried here, most products first): ${facts.vendors.slice(0, 6).join(", ") || "none"}. Keep the phrase "${rec.primary}". Keep it between ${floor} and ${limit} characters. Keep the closing call to action if there is one.

${out[field]}`,
        { maxTokens: 300, timeoutMs: 60000, retryOnTimeout: false }
      );
      const cand = txt.replace(/^["']|["']$/g, "").replace(/[—–]/g, "-").trim();
      const recheck = findFactIssues({ ...out, [field]: cand }, facts, badBrands).filter((i) => i.field === field);
      if (cand.length <= limit && cand.length >= floor * 0.8 && recheck.length === 0) { out[field] = cand; continue; }
    } catch { /* fall through */ }
    // Mechanical fallback: drop offending brands and swap prices for the real floor.
    let t = out[field];
    for (const b of badBrands) t = t.replace(new RegExp(`\\s*(?:,|and|&)?\\s*${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "");
    for (const p of badPrices) {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (facts.priceAllowed && field === "meta_description" && facts.minPrice != null) { t = t.replace(new RegExp(esc, "g"), money(facts.minPrice)); continue; }
      // "from $X", "starting at $X", "$X to $Y", "under $X", "at $X" and the bare figure
      t = t.replace(new RegExp(`\\s*(?:,\\s*)?(?:starting (?:at|from)|from|under|at|to)\\s*${esc}(?:\\s*(?:to|-)\\s*\\$[\\d,]+)?`, "gi"), "");
      t = t.replace(new RegExp(`\\s*${esc}`, "g"), "");
    }
    t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/\(\s*\)/g, "").replace(/,\s*,/g, ",").replace(/\s+\./g, ".").trim();
    out[field] = t;
  }
  // A repair must never lose the primary keyword from a field that had it.
  const prim = rec.primary || "";
  if (prim.trim()) {
    for (const field of ["title_tag", "meta_description"] as const) {
      if (hasAllWords(rec[field] || "", prim) && !hasAllWords(out[field] || "", prim)) out[field] = rec[field];
    }
  }
  return out;
}


const STOP = new Set(["for", "sale", "with", "and", "the", "a", "of", "to", "in", "on", "at", "from", "home", "best", "buy", "shop"]);
/** lowercase, punctuation to spaces, crude singular (saunas -> sauna, benches -> bench) so plural wording still counts */
export function normWords(text: string): string[] {
  return (text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map((w) => {
    if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  });
}
const keyWords = (phrase: string) => normWords(phrase).filter((w) => !STOP.has(w));
/** true when the text carries every meaningful word of the phrase (any order, plural tolerated) */
export function hasAllWords(text: string, phrase: string): boolean {
  const want = keyWords(phrase);
  const have = new Set(normWords(text));
  return want.length > 0 && want.every((w) => have.has(w));
}

/**
 * A field is damaged when it carries some but not all of the primary keyword's words:
 * a repair dropped one ("Shop outdoor for sale", "Steam Generators for | Home Units").
 * A field with none of the words is left alone (a meta built on a secondary is legitimate).
 */
export function fieldDamaged(rec: Recommendation, field: "title_tag" | "meta_description"): boolean {
  const want = keyWords(rec.primary || "");
  if (!want.length) return false;
  const have = new Set(normWords(rec[field] || ""));
  const hit = want.filter((w) => have.has(w)).length;
  return hit > 0 && hit < want.length;
}
/** True when the title or the meta is damaged. */
export function primaryMissing(rec: Recommendation): boolean {
  return fieldDamaged(rec, "title_tag") || fieldDamaged(rec, "meta_description");
}

/** Minimal rewrite that puts the primary keyword back into a damaged title or meta. */
export async function reinstatePrimary(rec: Recommendation, facts: CollectionFacts | null): Promise<Recommendation> {
  const out = { ...rec };
  const prim = (rec.primary || "").trim();
  if (!prim) return out;
  for (const field of ["title_tag", "meta_description"] as const) {
    if (!fieldDamaged(rec, field)) continue;
    const limit = field === "title_tag" ? 60 : 158;
    const floor = field === "title_tag" ? 45 : 140;
    try {
      const txt = await callAI(
        "You correct SEO copy. Return only the corrected text, nothing else. No em dashes, no en dashes, no quotes.",
        `This ${field === "title_tag" ? "title tag" : "meta description"} for /collections/${facts?.handle || ""} lost a word. Rewrite it with the smallest possible change so it reads naturally and contains the phrase "${prim}" (plural is fine). Keep every brand name${facts?.priceAllowed ? " and any price figure" : ""} as written. ${facts && !facts.priceAllowed ? "Do not add a price. " : ""}Keep it between ${floor} and ${limit} characters.

${out[field]}`,
        { maxTokens: 300, timeoutMs: 60000, retryOnTimeout: false }
      );
      const cand = txt.replace(/^["']|["']$/g, "").replace(/[—–]/g, "-").trim();
      if (hasAllWords(cand, prim) && cand.length <= limit + 10) out[field] = cand;
    } catch { /* leave as is */ }
  }
  return out;
}
