// Ranks products and collections by net revenue for the Video Scripts module.
//
// Sales come from the GTD Dashboard (orders_historical, synced daily from
// Shopify) via its read-only /api/product-sales endpoint. Each sales row is
// matched to a live catalogue product by Shopify product id when the
// dashboard has one, otherwise by title. CSV-seeded history stores the line
// item NAME ("Title - Variant"), so the variant suffix is peeled off before
// giving up. Collection revenue is the sum of the net revenue of the products
// currently in that collection.
import { getSQL } from "@/lib/db";
import { MASTER_COLLECTIONS } from "@/lib/collections";
import { ensureVideoTables, setMeta } from "./db";
import { fetchCatalog, fetchCollectionsForProducts, type CatalogProduct } from "./shopify";

export const DEFAULT_DASHBOARD_URL = "https://gtd-dashboard-one.vercel.app";

export type SalesRow = {
  productTitle: string;
  productId: string | null;
  vendor: string;
  units: number;
  orders: number;
  net: number;
  lastSold: string | null;
};

export type RankingMeta = {
  days: number;
  refreshedAt: string;
  dataRange: { first: string | null; last: string | null } | null;
  salesRows: number;
  matchedProducts: number;
  totalNet: number;
  unmatchedNet: number;
  unmatched: Array<{ title: string; net: number; units: number }>;
};

export async function fetchDashboardSales(days: number): Promise<{ products: SalesRow[]; dataRange: RankingMeta["dataRange"] }> {
  const base = (process.env.DASHBOARD_URL || DEFAULT_DASHBOARD_URL).replace(/\/+$/, "");
  const key = process.env.DASHBOARD_API_KEY;
  if (!key) {
    throw new Error("DASHBOARD_API_KEY is not set. Add it in Vercel env vars (same value as PRODUCT_SALES_API_KEY on the dashboard).");
  }
  const res = await fetch(`${base}/api/product-sales?days=${days}&limit=5000`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string; products?: SalesRow[]; dataRange?: RankingMeta["dataRange"] }
    | null;
  if (!res.ok || !body?.ok) {
    throw new Error(`Dashboard sales request failed (${res.status}): ${body?.error || "no body"}`);
  }
  return { products: body.products || [], dataRange: body.dataRange || null };
}

export function normTitle(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[™®©]/g, "")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function matchRow(
  row: SalesRow,
  byId: Map<string, CatalogProduct>,
  byTitle: Map<string, CatalogProduct>,
): CatalogProduct | null {
  if (row.productId && byId.has(row.productId)) return byId.get(row.productId)!;
  const t = normTitle(row.productTitle);
  if (byTitle.has(t)) return byTitle.get(t)!;
  // Peel " - Variant" segments from the right: "A - B - C" -> "A - B" -> "A".
  const parts = t.split(" - ");
  for (let n = parts.length - 1; n >= 1; n--) {
    const candidate = parts.slice(0, n).join(" - ");
    if (byTitle.has(candidate)) return byTitle.get(candidate)!;
  }
  return null;
}

// Collections that are storefront plumbing, not a category worth a video.
const SYSTEM_HANDLE =
  /^(all|frontpage|home|shop-all|sale|sales|clearance|deals?|new|new-arrivals|featured|best-?sellers?|top-sellers|gifts?|gift-guide|bundles?|financing|hsa|fsa|hsa-fsa.*|black-friday.*|cyber-monday.*|memorial-day.*|labor-day.*|4th-of-july.*|holiday.*|open-box|scratch.*|in-stock.*|quick-ship.*)$/;

const MASTER_HANDLES = new Set(MASTER_COLLECTIONS.map((c) => c.shopifyHandle.toLowerCase()));

export async function refreshRankings(days: number): Promise<RankingMeta> {
  await ensureVideoTables();

  const [{ products: sales, dataRange }, catalog] = await Promise.all([fetchDashboardSales(days), fetchCatalog()]);

  const byId = new Map(catalog.map((p) => [p.id, p]));
  const byTitle = new Map<string, CatalogProduct>();
  // Prefer ACTIVE products when two share a title.
  for (const p of [...catalog].sort((a, b) => (a.status === "ACTIVE" ? 1 : 0) - (b.status === "ACTIVE" ? 1 : 0))) {
    byTitle.set(normTitle(p.title), p);
  }

  type Agg = { product: CatalogProduct; net: number; units: number; orders: number };
  const agg = new Map<string, Agg>();
  const unmatched: RankingMeta["unmatched"] = [];
  let totalNet = 0;
  let unmatchedNet = 0;

  for (const row of sales) {
    totalNet += row.net;
    const p = matchRow(row, byId, byTitle);
    if (!p) {
      unmatchedNet += row.net;
      unmatched.push({ title: row.productTitle, net: row.net, units: row.units });
      continue;
    }
    const a = agg.get(p.id) || { product: p, net: 0, units: 0, orders: 0 };
    a.net += row.net;
    a.units += row.units;
    a.orders += row.orders;
    agg.set(p.id, a);
  }

  const ranked = [...agg.values()].filter((a) => a.net > 0).sort((a, b) => b.net - a.net);
  const membership = await fetchCollectionsForProducts(ranked.map((a) => a.product.id));
  const vendors = new Set(catalog.map((p) => normTitle(p.vendor)).filter(Boolean));

  type CAgg = {
    handle: string; title: string; net: number; units: number;
    products: Array<{ id: string; title: string; handle: string; net: number }>;
  };
  const cAgg = new Map<string, CAgg>();
  for (const a of ranked) {
    for (const c of membership.get(a.product.id) || []) {
      const h = c.handle.toLowerCase();
      const ca = cAgg.get(h) || { handle: c.handle, title: c.title, net: 0, units: 0, products: [] };
      ca.net += a.net;
      ca.units += a.units;
      ca.products.push({ id: a.product.id, title: a.product.title, handle: a.product.handle, net: round(a.net) });
      cAgg.set(h, ca);
    }
  }

  const productRows = ranked.map((a, i) => ({
    kind: "product",
    key: a.product.id,
    rank: i + 1,
    title: a.product.title,
    handle: a.product.handle,
    vendor: a.product.vendor,
    status: a.product.status,
    image_url: a.product.imageUrl,
    price: a.product.price,
    net: round(a.net),
    units: a.units,
    orders: a.orders,
    product_count: 1,
    flags: a.product.status === "ACTIVE" ? [] : ["inactive"],
    collections: membership.get(a.product.id) || [],
    products: [],
  }));

  const collectionRows = [...cAgg.values()]
    .sort((a, b) => b.net - a.net)
    .map((c, i) => {
      const h = c.handle.toLowerCase();
      const flags: string[] = [];
      if (MASTER_HANDLES.has(h)) flags.push("hub");
      if (SYSTEM_HANDLE.test(h)) flags.push("system");
      if (vendors.has(normTitle(c.title)) || /-brand$|^brand-/.test(h)) flags.push("brand");
      return {
        kind: "collection",
        key: c.handle,
        rank: i + 1,
        title: c.title,
        handle: c.handle,
        vendor: null,
        status: null,
        image_url: null,
        price: null,
        net: round(c.net),
        units: c.units,
        orders: 0,
        product_count: c.products.length,
        flags,
        collections: [],
        products: c.products.sort((x, y) => y.net - x.net).slice(0, 12),
      };
    });

  const sql = getSQL();
  const all = [...productRows, ...collectionRows];
  await sql`DELETE FROM video_rankings`;
  // Insert in chunks; one statement per chunk via jsonb_to_recordset.
  const CHUNK = 400;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = JSON.stringify(all.slice(i, i + CHUNK));
    await sql`
      INSERT INTO video_rankings
        (kind, key, rank, title, handle, vendor, status, image_url, price, net, units, orders, product_count, flags, collections, products, refreshed_at)
      SELECT kind, key, rank, title, handle, vendor, status, image_url, price, net, units, orders, product_count,
             ARRAY(SELECT jsonb_array_elements_text(flags)), collections, products, NOW()
      FROM jsonb_to_recordset(${chunk}::jsonb) AS x(
        kind text, key text, rank int, title text, handle text, vendor text, status text, image_url text, price text,
        net numeric, units int, orders int, product_count int, flags jsonb, collections jsonb, products jsonb
      )
    `;
  }

  const meta: RankingMeta = {
    days,
    refreshedAt: new Date().toISOString(),
    dataRange,
    salesRows: sales.length,
    matchedProducts: ranked.length,
    totalNet: round(totalNet),
    unmatchedNet: round(unmatchedNet),
    unmatched: unmatched.sort((a, b) => b.net - a.net).slice(0, 60).map((u) => ({ ...u, net: round(u.net) })),
  };
  await setMeta("ranking", meta);
  return meta;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
