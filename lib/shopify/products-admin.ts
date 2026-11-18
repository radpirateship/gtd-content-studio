// Live product + collection reads via the Shopify ADMIN API (the app's shpat_
// token). Lets the tool pull products filtered by collection (sub-collection),
// vendor (brand), or product_type directly from the store — no manual export.
// Returns the same Product shape the app already uses, so it's a drop-in.
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import type { Product } from "@/lib/product-store";

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];
let cachedVersion: string | null = null;

type AdminVariant = { price?: string; compare_at_price?: string | null; sku?: string; inventory_quantity?: number; inventory_policy?: string; inventory_management?: string | null };
type AdminProduct = {
    id: number;
    title: string;
    handle: string;
    body_html: string | null;
    vendor: string | null;
    product_type: string | null;
    tags: string | null;
    status: string | null;
    image?: { src?: string } | null;
    images?: Array<{ src: string }>;
    variants?: AdminVariant[];
};
type AdminCollection = { id: number; handle: string; title: string };

async function getVersion(token: string): Promise<string> {
    if (cachedVersion) return cachedVersion;
    for (const v of API_VERSIONS) {
          const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/shop.json`, {
                  headers: { "X-Shopify-Access-Token": token },
          });
          if (res.ok) {
                  cachedVersion = v;
                  return v;
          }
          if (res.status === 401 || res.status === 403) {
                  throw new Error(`Shopify auth failed (${res.status}) — check SHOPIFY_ACCESS_TOKEN`);
          }
    }
    throw new Error("No working Shopify Admin API version found");
}

async function adminGet(path: string) {
    const token = await getShopifyAccessToken();
    const version = await getVersion(token);
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`, {
          headers: { "X-Shopify-Access-Token": token },
    });
    if (!res.ok) {
          // Silent failure here is how a 52-product collection became a
          // 2-product article: the caller fell back to the stale cache with
          // no trace. Always say what failed.
          const body = await res.text().catch(() => "");
          console.error(`[products-admin] GET ${path.split("?")[0]} failed: ${res.status} ${body.slice(0, 200)}`);
          return { ok: false as const, json: null as unknown };
    }
    return { ok: true as const, json: (await res.json()) as Record<string, unknown> };
}

// Resolve a collection handle (sub-collection) to its numeric id. Checks both
// custom and smart collections.
async function resolveCollectionId(handle: string): Promise<number | null> {
    for (const kind of ["custom_collections", "smart_collections"]) {
          const r = await adminGet(`${kind}.json?handle=${encodeURIComponent(handle)}&limit=1`);
          const list = (r.ok ? (r.json as Record<string, AdminCollection[]>)[kind] : []) || [];
          if (list[0]?.id) return list[0].id;
    }
    return null;
}

function toProduct(p: AdminProduct): Product {
    const v = p.variants?.[0];
    const imageUrl = p.image?.src || p.images?.[0]?.src || "";
    return {
          id: String(p.id),
          title: p.title || "",
          description: p.body_html || "",
          price: v?.price || "",
          compareAtPrice: v?.compare_at_price || "",
          sku: v?.sku || "",
          vendor: p.vendor || "",
          productType: p.product_type || "",
          tags: p.tags || "",
          category: p.product_type || "",
          imageUrl,
          handle: p.handle || "",
          status: p.status || "active",
          inventoryQty: v?.inventory_quantity != null ? String(v.inventory_quantity) : "",
          url: `https://greenthumbdepot.com/products/${p.handle}`,
    };
}

/**
 * Fetch products live from the store, narrowed by any combination of:
 *  - collectionHandle (sub-collection, e.g. "sauna-heaters")
 *  - vendor (brand, e.g. "Auroom")
 *  - productType
 * Returns [] on any failure so callers can fall back to the cached DB.
 */
export async function fetchAdminProducts({
    collectionHandle,
    vendor,
    productType,
    limit = 24,
}: {
    collectionHandle?: string | null;
    vendor?: string | null;
    productType?: string | null;
    limit?: number;
}): Promise<Product[]> {
    try {
          const params = new URLSearchParams({ limit: String(Math.min(limit, 250)) });

      let path: string;
          let usedCollection = false;
          if (collectionHandle && collectionHandle !== "all") {
                  const collectionId = await resolveCollectionId(collectionHandle);
                  if (!collectionId) {
                            console.warn(`[products-admin] collection handle "${collectionHandle}" did not resolve to an id (custom or smart)`);
                            // Unknown collection handle — fall back to vendor/type-only query if we have one.
                    if (!vendor && !productType) return [];
                  } else {
                            // collection_id does not combine reliably with other
                            // filters (status, vendor, product_type) on this
                            // endpoint — some combinations return errors or empty
                            // sets. Send collection_id alone; filter client-side.
                            params.set("collection_id", String(collectionId));
                            usedCollection = true;
                  }
          }
          if (!usedCollection) {
                  params.set("status", "active");
                  if (vendor) params.set("vendor", vendor);
                  if (productType) params.set("product_type", productType);
          }
          path = `products.json?${params.toString()}`;

      const r = await adminGet(path);
          if (!r.ok) return [];
          let products = ((r.json as Record<string, AdminProduct[]>).products || []).map(toProduct);

      // Everything the server-side query could not filter, filtered here.
      if (usedCollection) {
              products = products.filter((p) => (p.status || "active") === "active");
              if (vendor) products = products.filter((p) => (p.vendor || "").toLowerCase() === vendor.toLowerCase());
              if (productType) products = products.filter((p) => (p.productType || "").toLowerCase().includes(productType.toLowerCase()));
      }
          if (collectionHandle && collectionHandle !== "all") {
                  console.log(`[products-admin] "${collectionHandle}" -> ${products.length} live product(s)`);
          }
          return products;
    } catch (err) {
          console.error("[products-admin] fetch failed:", err);
          return [];
    }
}

// List all store collections (handle + title), for targeting UIs / dropdowns.
// 2026-08-11: paginated with since_id. The old single call capped at 250, so
// with 278+ smart collections the last ~30 (alphabetically late handles like
// water-ionizers) were silently missing from every sync.
// ── LIVE COLLECTION HANDLES ─────────────────────────────────────────────────
// gtd_collections is keyed by its own slug, which is not guaranteed to equal the
// Shopify handle — that mismatch is exactly what produced /collections/cold-plunge
// (singular, 404) against the real /collections/cold-plunges. Any handle offered
// to the article generator as a link target is checked against this set first.

let collectionHandleCache: { at: number; handles: Set<string>; titles: Map<string, string> } | null = null;
const COLLECTION_TTL_MS = 10 * 60 * 1000;

/**
 * Every live collection handle, lowercased, with its Shopify title.
 * Empty on failure so callers can tell "the check did not run" from "nothing
 * exists" and skip filtering rather than wiping every candidate.
 */
export async function listLiveCollectionHandles(
  force = false,
): Promise<{ handles: Set<string>; titles: Map<string, string> }> {
  if (!force && collectionHandleCache && Date.now() - collectionHandleCache.at < COLLECTION_TTL_MS) {
    return collectionHandleCache;
  }
  const handles = new Set<string>();
  const titles = new Map<string, string>();
  for (const c of await listAdminCollections()) {
    if (!c.handle) continue;
    const h = c.handle.toLowerCase();
    handles.add(h);
    if (c.title) titles.set(h, c.title);
  }
  if (handles.size) collectionHandleCache = { at: Date.now(), handles, titles };
  return { handles, titles };
}

export async function listAdminCollections(): Promise<Array<{ handle: string; title: string }>> {
    const out: Array<{ handle: string; title: string }> = [];
    for (const kind of ["custom_collections", "smart_collections"]) {
          let sinceId = 0;
          for (let page = 0; page < 40; page++) {
                  const r = await adminGet(`${kind}.json?limit=250&since_id=${sinceId}`);
                  const list = (r.ok ? (r.json as Record<string, AdminCollection[]>)[kind] : []) || [];
                  for (const c of list) out.push({ handle: c.handle, title: c.title });
                  if (list.length < 250) break;
                  sinceId = list[list.length - 1].id;
          }
    }
    return out;
}

// ── BOT READ PATH ───────────────────────────────────────────────────────────
// Same Admin API, same filters as fetchAdminProducts, but keeps every image
// URL (not just the first) and supports since_id paging so an automation can
// walk the whole catalogue. Read-only. Used by /api/bot/products.

export type AdminProductDetailed = {
    id: string;
    title: string;
    handle: string;
    status: string;
    vendor: string;
    productType: string;
    tags: string[];
    price: string;
    compareAtPrice: string | null;
    sku: string;
    images: string[];
    url: string;
    updatedAt: string | null;
    inStock: boolean;   // any variant purchasable: untracked, policy continue, or quantity > 0
};

function toDetailed(p: AdminProduct & { updated_at?: string }): AdminProductDetailed {
    const v = p.variants?.[0];
    const images = (p.images || []).map((i) => i.src).filter(Boolean);
    if (images.length === 0 && p.image?.src) images.push(p.image.src);
    return {
          id: String(p.id),
          title: p.title || "",
          handle: p.handle || "",
          status: p.status || "active",
          vendor: p.vendor || "",
          productType: p.product_type || "",
          tags: (p.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
          price: v?.price || "",
          compareAtPrice: v?.compare_at_price || null,
          sku: v?.sku || "",
          images,
          url: `https://greenthumbdepot.com/products/${p.handle}`,
          updatedAt: p.updated_at || null,
          inStock: (p.variants || []).some((x) => !x.inventory_management || x.inventory_policy === "continue" || (x.inventory_quantity ?? 0) > 0) || !(p.variants || []).length,
    };
}

/**
 * Live product read for automations. Returns { ok:false } when Shopify could
 * not be reached so the caller can fall back to the cached table and say so.
 */
export async function fetchAdminProductsDetailed({
    collectionHandle,
    vendor,
    productType,
    handle,
    title,
    sinceId,
    limit = 50,
}: {
    collectionHandle?: string | null;
    vendor?: string | null;
    productType?: string | null;
    handle?: string | null;
    title?: string | null;
    sinceId?: number | null;
    limit?: number;
}): Promise<{ ok: boolean; products: AdminProductDetailed[]; unknownCollection?: boolean }> {
    try {
          const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 250)) });
          params.set("fields", "id,title,handle,status,vendor,product_type,tags,image,images,variants,updated_at");
          let usedCollection = false;
          if (collectionHandle && collectionHandle !== "all") {
                  const collectionId = await resolveCollectionId(collectionHandle);
                  if (!collectionId) return { ok: true, products: [], unknownCollection: true };
                  params.set("collection_id", String(collectionId));
                  usedCollection = true;
          }
          if (!usedCollection) {
                  params.set("status", "active");
                  if (vendor) params.set("vendor", vendor);
                  if (productType) params.set("product_type", productType);
                  if (handle) params.set("handle", handle);
                  if (title) params.set("title", title);
          }
          if (sinceId) params.set("since_id", String(sinceId));

      // A collection query cannot be narrowed to active products server-side,
          // and the 250 cap counts drafts and archived items, so a 235-product
          // live collection came back 29 short. Page with since_id until the
          // collection is exhausted, then filter.
          let raw: AdminProduct[] = [];
          if (usedCollection) {
                  let cursor = sinceId || 0;
                  for (let page = 0; page < 20; page++) {
                            params.set("since_id", String(cursor));
                            params.set("limit", "250");
                            const r = await adminGet(`products.json?${params.toString()}`);
                            if (!r.ok) return { ok: false, products: [] };
                            const list = (((r.json as Record<string, unknown>).products as AdminProduct[]) || []);
                            raw.push(...list);
                            if (list.length < 250) break;
                            cursor = list[list.length - 1].id;
                  }
          } else {
                  const r = await adminGet(`products.json?${params.toString()}`);
                  if (!r.ok) return { ok: false, products: [] };
                  raw = (((r.json as Record<string, unknown>).products as AdminProduct[]) || []);
          }
          let products = raw.map(toDetailed);
          if (usedCollection) {
                  products = products.filter((p) => p.status === "active");
                  if (vendor) products = products.filter((p) => p.vendor.toLowerCase() === vendor.toLowerCase());
                  if (productType) products = products.filter((p) => p.productType.toLowerCase().includes(productType.toLowerCase()));
                  if (handle) products = products.filter((p) => p.handle === handle);
          }
          return { ok: true, products };
    } catch (err) {
          console.error("[products-admin] detailed fetch failed:", err);
          return { ok: false, products: [] };
    }
}
