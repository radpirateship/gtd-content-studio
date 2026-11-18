// ============================================================================
// lib/product-picker.ts, the featured-product picker.
//
// Moved out of app/api/products/route.ts (Aug 2026) so the ultimate guide
// pipeline can pick products server-side through the same rules the blog
// articles use, instead of its own AI role-assigner. A Next route file may
// only export handlers, so the picker had to live in lib to be shared.
//
// Behaviour is unchanged from the route: relevance scoring on title, handle,
// tags, type and description; a price floor that relaxes when the collection
// cannot satisfy it; a cap on the most expensive 10%; one per vendor (the
// priciest relevant model) and two per product type; excluded vendors dropped
// unless the context lifts them.
// ============================================================================

import type { Product } from "@/lib/product-store";
import { EXCLUDED_VENDORS, isExcludedVendor } from "@/lib/product-exclusions";

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are', 'were', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'can', 'may', 'would',
  'should', 'could', 'this', 'that', 'these', 'those', 'my', 'your', 'our',
  'its', 'his', 'her', 'their', 'what', 'which', 'who', 'how', 'why', 'when',
  'where', 'not', 'no', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'than', 'too', 'very', 'just', 'also', 'about',
  'best', 'top', 'good', 'great', 'new', 'use', 'using', 'used', 'guide',
  'review', 'complete', 'ultimate', 'vs', 'versus', '2024', '2025', '2026',
]);

// ── Colour and size variants ────────────────────────────────────────────────
// The treatment tables collection lists 37 products that are really 11 tables:
// the same Montane Andes appears five times in five upholstery colours, same
// price, same everything else. Counting those as five picks fills a six-row
// compare table with two tables in six colours. Collapse them to one, keeping
// the variant with an image and then the first in the caller's order, so a
// scored list keeps its best-scoring variant.
//
// Deliberately conservative: it needs the SAME vendor, the SAME price, and a
// title that differs only in colour words. Verified across 611 live products
// in eight collections, where it collapsed treatment tables 37 -> 11 and left
// saunas, sauna heaters, treadmills, cold plunges, red light, hyperbaric and
// pickleball completely untouched.
const VARIANT_COLOURS =
  /\b(black|white|gray|grey|navy blue|navy|imperial blue|blue|green|burgundy|cream|tan|sand|opal|silver|charcoal|beige|maroon|red|purple|teal|olive|brown|slate)\b/g;

export function variantKey(p: { title?: string | null; vendor?: string | null; price?: string | null }): string {
  // "Hybrid+" must not collapse into "Hybrid": they are different WalkingPad
  // models at different prices, and stripping punctuation made them equal.
  let t = String(p.title || "").toLowerCase().replace(/\+/g, " plus ");
  t = t.replace(new RegExp(String.raw`[,(].{0,40}` + VARIANT_COLOURS.source + String.raw`.{0,12}$`, "i"), "");
  t = t.replace(VARIANT_COLOURS, " ");
  t = t.replace(/[^a-z0-9]+/g, " ").trim();
  return `${String(p.vendor || "").toLowerCase()}|${t}|${String(p.price || "")}`;
}

/** One product per model. Order is preserved; a variant with an image wins. */
export function dedupeVariants<T extends { title?: string | null; vendor?: string | null; price?: string | null; imageUrl?: string | null }>(
  products: T[],
): T[] {
  const byKey = new Map<string, T>();
  for (const p of products) {
    const k = variantKey(p);
    const cur = byKey.get(k);
    if (!cur) { byKey.set(k, p); continue; }
    if (!cur.imageUrl && p.imageUrl) byKey.set(k, p);
  }
  return Array.from(byKey.values());
}

export function extractSearchTerms(searchString: string): string[] {
  return searchString
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

export function scoreProduct(product: Product, searchTerms: string[]): number {
  if (searchTerms.length === 0) return 0;
  const titleLower = (product.title || '').toLowerCase();
  const tagsLower = (product.tags || '').toLowerCase();
  const typeLower = (product.productType || '').toLowerCase();
  const handleLower = (product.handle || '').toLowerCase();
  const descLower = (product.description || '').slice(0, 500).toLowerCase();
  let score = 0;
  for (const term of searchTerms) {
    if (titleLower.includes(term)) score += 10;
    if (handleLower.includes(term)) score += 6;
    if (tagsLower.includes(term)) score += 5;
    if (typeLower.includes(term)) score += 4;
    if (descLower.includes(term)) score += 2;
  }
  if (product.imageUrl) score += 8;
  if (product.price && product.price !== '0') score += 3;
  // Ticket size as a tiebreaker within a keyword match. Without it a $21
  // compression sleeve outranked a $1,700 wall station on a "home gym
  // essentials" article because both mention "home gym". Logarithmic, so it
  // nudges rather than dominates: $20 adds ~1, $500 ~3, $5,000 ~4.
  const price = parseFloat(product.price || '0');
  if (price > 1) score += Math.min(5, Math.log10(price));
  return score;
}

/**
 * PPW sells high-ticket equipment, so featured picks should be real equipment
 * rather than accessories, without all four being the $30k flagships either.
 *
 * Three rules, the first two relaxing automatically when a collection cannot satisfy them:
 *  1. A price FLOOR: products under $1,000 are dropped when the collection has
 *     enough above it (at least twice the number of cards). The floor steps
 *     down to $500, $250, then off, so a massage gun collection still works.
 *  2. A CEILING on the very top: at most two of the picks may come from the
 *     most expensive 10% of the pool, so a sauna article shows a range rather
 *     than four $40k cabins.
 *  3. ONE product per vendor, the most expensive of that vendor's relevant
 *     products (Ryan, 22 Aug 2026; a BLOG ARTICLE rule). ?vendorCap=N raises
 *     the per-vendor count; the ultimate guide route passes vendorCap: 2.
 * Floor: PRODUCT_PICK_MIN_PRICE env (default 1000) or ?minPrice= per request.
 */
export const DEFAULT_MIN_PRICE = Number(process.env.PRODUCT_PICK_MIN_PRICE || 1000);

const TOP_BAND_PCT = 90;
const TOP_BAND_CAP = 2;

export function aboveFloor(products: Product[], floor: number, needed: number): { kept: Product[]; floorUsed: number } {
  const priced = products.filter(p => parseFloat(p.price || '0') > 0);
  if (!priced.length || floor <= 0) return { kept: products, floorUsed: 0 };
  const steps = [floor, floor / 2, floor / 4, 0];
  for (const f of steps) {
    const kept = f > 0 ? priced.filter(p => parseFloat(p.price) >= f) : products;
    if (kept.length >= needed * 2 || f === 0) {
      console.log(`[v0] Product price floor: $${f} -> ${kept.length} of ${products.length} candidates${f !== floor ? ` (relaxed from $${floor})` : ''}`);
      return { kept, floorUsed: f };
    }
  }
  return { kept: products, floorUsed: 0 };
}

function topBandCutoff(products: Product[]): number {
  const prices = products.map(p => parseFloat(p.price || '0')).filter(n => n > 0).sort((a, b) => a - b);
  if (prices.length < 10) return Infinity;
  return prices[Math.floor((TOP_BAND_PCT / 100) * prices.length)];
}

export function selectRelevantProducts(
  allProducts: Product[],
  searchTerms: string[],
  maxItems: number,
  minPrice = DEFAULT_MIN_PRICE,
  opts?: { lifted?: ReadonlySet<string>; vendorCap?: number },
): Product[] {
  const beforeExclude = allProducts.length;
  // General articles skip the excluded vendors. An article about that
  // vendor or its product type (targetBrand, title, keyword, sub-collection)
  // lifts the exclusion for the vendors it names.
  allProducts = allProducts.filter(p => !isExcludedVendor(p, opts?.lifted));
  if (allProducts.length !== beforeExclude) {
    console.log(`[v0] Product picker: excluded ${beforeExclude - allProducts.length} product(s) from banned vendor(s): ${[...EXCLUDED_VENDORS].join(', ')}`);
  }
  // Colour variants are not choices. Collapse before scoring so the caps and
  // the fill below count models, not SKUs.
  const beforeVariants = allProducts.length;
  allProducts = dedupeVariants(allProducts);
  if (allProducts.length !== beforeVariants) {
    console.log(`[v0] Product picker: ${beforeVariants} products collapsed to ${allProducts.length} distinct models`);
  }
  allProducts = aboveFloor(allProducts, minPrice, maxItems).kept;
  const topCut = topBandCutoff(allProducts);
  const scored = allProducts.map(p => ({
    product: p,
    relevance: scoreProduct(p, searchTerms),
    tiebreaker: Math.random(),
  }));
  scored.sort((a, b) => b.relevance !== a.relevance ? b.relevance - a.relevance : a.tiebreaker - b.tiebreaker);
  const topScore = scored[0]?.relevance || 0;
  console.log(`[v0] Product scoring: ${scored.length} products, top score=${topScore}, search="${searchTerms.join(' ')}"`);
  if (scored.length > 0) {
    console.log(`[v0] Top 6 matches: ${scored.slice(0, 6).map(s => `${s.product.title?.slice(0, 40)} (${s.relevance})`).join(' | ')}`);
  }
  // ONE product per vendor (Ryan, 22 Aug 2026), and within a vendor the most
  // expensive of its relevant products. The earlier cap of two still put two
  // BenchK wall bars on an umbrella article because every BenchK title
  // contains "Home Gym". Each vendor is now represented once, by the priciest
  // product among those scoring within 60% of that vendor's best match, so a
  // keyword hit on a cheap accessory does not outrank the flagship.
  // Score order decides which vendors appear; the per-vendor pick decides
  // which product. Falls back to pure score order when the pool is one vendor.
  const vendorOf = (p: Product) => (p.vendor || '').toLowerCase() || '__none__';
  const priceOf = (p: Product) => parseFloat(p.price || '0') || 0;

  // ── Price spread, the way collection pages do it ──────────────────────────
  // This used to take each vendor's MOST EXPENSIVE relevant model, which put
  // the top of the catalogue on every article. Collection pages instead walk
  // percentile positions across the price range (lib/collection-generate.ts,
  // selectFeaturedDetailed step 5) so the block shows a range rather than four
  // flagships. Same ratios here, so a blog, a guide and a collection page pick
  // the same shape of set.
  //
  // Vendor diversity still comes first: at each percentile the nearest
  // candidate that has not used up its vendor allowance wins, and the cap only
  // relaxes when nothing else is left. One vendor in the pool therefore still
  // fills every slot, spread across the price range.
  const RATIOS = (n: number): number[] =>
    n === 1 ? [0.6]
      : n === 2 ? [0.4, 0.8]
        : n === 3 ? [0.35, 0.6, 0.85]
          : Array.from({ length: n }, (_, i) => 0.08 + (0.87 * i) / (n - 1));

  // Relevance decides WHO is eligible; price decides which of them appear.
  // The bar is deliberately LOW. A 60% -of-top threshold was tried and put
  // three BenchK wall bars back on a home gym article: every BenchK title
  // carries "home gym", so they took the top scores and everything else fell
  // below the bar, leaving the vendor cap nothing to choose from. The gate is
  // only here to drop products the article has nothing to do with; vendor
  // spread is the cap's job, not the gate's.
  const topScoreAll = scored[0]?.relevance || 0;
  const bar = topScoreAll > 0 ? topScoreAll * 0.15 : 0;
  let eligible = scored.filter((s) => s.relevance > bar).map((s) => s.product);
  if (eligible.length < maxItems * 2) eligible = scored.map((s) => s.product);
  const byPrice = eligible.slice().sort((a, b) => priceOf(a) - priceOf(b));

  const picked: Product[] = [];
  const perVendor = new Map<string, number>();
  const perType = new Map<string, number>();
  const cap = Math.max(1, opts?.vendorCap ?? 1);
  // Two per product type keeps a mixed collection from showing one shape of
  // thing. In a collection where EVERY product is one type it means nothing,
  // and it was silently ending the strict pass after two picks: treatment
  // tables are all "Clinical Equipment", so the vendor rule never got to run
  // and CanDo, the only other vendor, dropped off a six-product guide.
  const distinctTypes = new Set(eligible.map((p) => (p.productType || '').toLowerCase())).size;
  const typeCap = distinctTypes <= 1 ? maxItems : 2;
  let topBand = 0;
  const used = new Set<Product>();

  const take = (p: Product) => {
    picked.push(p);
    used.add(p);
    perVendor.set(vendorOf(p), (perVendor.get(vendorOf(p)) || 0) + 1);
    const t = (p.productType || '').toLowerCase() || '__none__';
    perType.set(t, (perType.get(t) || 0) + 1);
    if (priceOf(p) >= topCut) topBand++;
  };
  const blocked = (p: Product, strict: boolean) => {
    if (used.has(p)) return true;
    if (!strict) return false;
    const t = (p.productType || '').toLowerCase() || '__none__';
    if ((perVendor.get(vendorOf(p)) || 0) >= cap) return true;
    if ((perType.get(t) || 0) >= typeCap) return true;
    if (priceOf(p) >= topCut && topBand >= TOP_BAND_CAP) return true;
    return false;
  };
  // Nearest unused candidate to a percentile position, walking outward.
  const nearest = (target: number, strict: boolean): Product | null => {
    const n = byPrice.length;
    if (!n) return null;
    const centre = Math.min(n - 1, Math.max(0, Math.round(target * (n - 1))));
    for (let d = 0; d < n; d++) {
      for (const i of d === 0 ? [centre] : [centre - d, centre + d]) {
        if (i < 0 || i >= n) continue;
        if (!blocked(byPrice[i], strict)) return byPrice[i];
      }
    }
    return null;
  };

  for (const r of RATIOS(maxItems)) {
    if (picked.length >= maxItems) break;
    const p = nearest(r, true) || nearest(r, false);
    if (p) take(p);
  }

  if (picked.length < maxItems) {
    for (const s of scored) {
      if (picked.length >= maxItems) break;
      if (!picked.includes(s.product)) picked.push(s.product);
    }
  }
  return picked;
}
