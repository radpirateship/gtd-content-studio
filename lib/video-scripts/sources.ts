// Gathers what a script can draw on for one product or collection: the page,
// the listed specs (with ids and exact source text), the best sellers in a
// collection, and related blog posts (context only, never a fact source).
import { getSQL } from "@/lib/db";
import { ensureVideoTables } from "./db";
import { articlesForCollection, articlesForProduct, articleTexts, type IndexedArticle } from "./articles";
import { fetchCollectionDetail, fetchProductDetail, htmlToText, type CollectionDetail, type ProductDetail } from "./shopify";
import { buildSpecPack } from "./specs";
import type { GenerateInput, Spec } from "./types";

export type ProductOption = { id: string; title: string; vendor: string; price: string | null; url: string; net: number | null; images: number };

export type PanelSources = {
  kind: "product" | "collection";
  key: string;
  title: string;
  url: string;
  pageText: string;
  products: ProductOption[]; // the product itself, or the collection's best sellers
  specs: Spec[]; // spec pack for the default product(s)
  rank: { rank: number; net: number; days: number | null } | null;
  articles: IndexedArticle[];
  warnings: string[];
};

const option = (p: ProductDetail, net: number | null): ProductOption => ({
  id: p.id, title: p.title, vendor: p.vendor, price: p.price, url: p.url, net, images: p.images.length,
});

async function rankFor(kind: string, key: string) {
  await ensureVideoTables();
  const sql = getSQL();
  const rows = (await sql`SELECT rank, net FROM video_rankings WHERE kind = ${kind} AND key = ${key}`) as Array<{ rank: number; net: string }>;
  const meta = (await sql`SELECT value FROM video_meta WHERE key = 'ranking'`) as Array<{ value: { days?: number } }>;
  return rows[0] ? { rank: rows[0].rank, net: Number(rows[0].net), days: meta[0]?.value?.days ?? null } : null;
}

export function specWarnings(products: ProductDetail[], specs: Spec[]): string[] {
  const w: string[] = [];
  for (const p of products) {
    const n = specs.filter((s) => s.product === p.title && !s.derived && !["Price", "Brand", "Regular price"].includes(s.label)).length;
    if (n < 3) w.push(`${p.title}: only ${n} listed specs found on the product page. A product review needs at least 3.`);
    if (p.status !== "ACTIVE") w.push(`${p.title}: status is ${p.status}, not ACTIVE.`);
    if (p.compareAtPrice && p.price && Number(p.compareAtPrice) > Number(p.price)) {
      w.push(`${p.title} is on sale (${p.price} vs regular ${p.compareAtPrice}). A video quoting the sale price will date when the sale ends.`);
    }
  }
  return w;
}

export async function buildPanelSources(kind: "product" | "collection", key: string): Promise<PanelSources> {
  if (kind === "product") {
    const p = await fetchProductDetail(key);
    if (!p) throw new Error(`Product ${key} not found in Shopify`);
    const specs = buildSpecPack([p]);
    const collections = p.collections.filter((c) => c.handle !== "all").map((c) => c.handle);
    const [articles, rank] = await Promise.all([articlesForProduct(p.handle, collections), rankFor("product", p.id)]);
    const warnings = specWarnings([p], specs);
    if (!articles.length) warnings.push("No published blog posts link to this product or its collections.");
    return {
      kind, key: p.id, title: p.title, url: p.url, pageText: htmlToText(p.descriptionHtml),
      products: [option(p, rank?.net ?? null)], specs, rank, articles, warnings,
    };
  }

  const c = await fetchCollectionDetail(key);
  if (!c) throw new Error(`Collection "${key}" not found in Shopify`);
  await ensureVideoTables();
  const sql = getSQL();
  const snap = (await sql`SELECT products FROM video_rankings WHERE kind = 'collection' AND key = ${key}`) as Array<{
    products: Array<{ id: string; title: string; net: number }>;
  }>;
  const best = (snap[0]?.products || []).slice(0, 8);
  const details = (await Promise.all(best.map((b) => fetchProductDetail(b.id).catch(() => null)))).filter(Boolean) as ProductDetail[];
  const products = details.map((d) => option(d, best.find((b) => b.id === d.id)?.net ?? null));
  const specs = buildSpecPack(details.slice(0, 3));
  const [articles, rank] = await Promise.all([articlesForCollection(key), rankFor("collection", key)]);
  const warnings = details.length ? specWarnings(details.slice(0, 3), specs) : ["No sales recorded for this collection in the ranking window."];
  if (!articles.length) warnings.push("No published blog posts link to this collection.");
  return {
    kind, key: c.handle, title: c.title, url: c.url, pageText: htmlToText(c.descriptionHtml),
    products, specs, rank, articles, warnings,
  };
}

// ── Generation-time gathering ───────────────────────────────────────────────

export type GenerationSources = {
  products: ProductDetail[];
  comparison: ProductDetail | null;
  collection: CollectionDetail | null;
  specs: Spec[];
  articles: Array<{ articleId: string; title: string; url: string; text: string }>;
  warnings: string[];
};

function manufacturerCandidates(m: GenerateInput["manufacturerSpecs"], productTitle: string) {
  if (!m?.text?.trim()) return [];
  return m.text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && /\d/.test(l) && l.length < 200)
    .slice(0, 30)
    .map((line) => {
      const mm = line.match(/^([^:]{2,50}):\s*(.+)$/);
      return {
        product: productTitle,
        label: mm ? `Manufacturer: ${mm[1].trim()}` : "Manufacturer spec",
        value: mm ? mm[2].trim() : line,
        unit: "",
        derived: false,
        formula: null,
        sourceUrl: m.url || "manufacturer page (pasted by user)",
        sourceText: line,
      };
    });
}

/** Re-fetches every product live (prices change during sales) and builds the spec pack. */
export async function gatherForGeneration(input: GenerateInput): Promise<GenerationSources> {
  const ids = [...new Set(input.productIds.filter(Boolean))].slice(0, 3);
  if (!ids.length) throw new Error("Pick at least one product.");
  const fetched = await Promise.all(ids.map((id) => fetchProductDetail(id)));
  const products = fetched.filter(Boolean) as ProductDetail[];
  if (!products.length) throw new Error("None of the selected products were found in Shopify.");

  let comparison: ProductDetail | null = null;
  if (input.type === "PRODUCT_REVIEW" && input.comparisonProductId && !ids.includes(input.comparisonProductId)) {
    comparison = await fetchProductDetail(input.comparisonProductId);
  }
  const collection = input.kind === "collection" ? await fetchCollectionDetail(input.key) : null;

  const all = comparison ? [...products, comparison] : products;
  const specs = buildSpecPack(all, manufacturerCandidates(input.manufacturerSpecs, products[0].title));
  const articles = await articleTexts((input.articleIds || []).slice(0, 4));
  return { products, comparison, collection, specs, articles, warnings: specWarnings(all, specs) };
}
