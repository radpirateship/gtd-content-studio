// app/api/bot/products/route.ts
//
// GET /api/bot/products   (read-only, Bearer token, JSON only)
//
// Product titles, handles, prices and Shopify CDN image URLs for external
// agents (Grok Bot, GTD - Email). Same data source as Library > Products:
// the live Shopify Admin API, with the cached products table as fallback when
// Shopify cannot be reached. Nothing order, customer or checkout related.
//
// Query params (all optional):
//   search=<text>        every word must appear in title, vendor, type, tags
//                        or handle (catalogue is scanned, up to 15 pages of 250)
//   collection=<handle>  products in a live collection (custom or smart)
//   category=<slug>      app category slug, mapped to its collection handle
//   brand=<vendor>       vendor contains, case-insensitive ("Auroom" finds "Auroom Saunas")
//   type=<product type>  product type contains
//   limit=<1..250>       default 50
//   since_id=<id>        page through the catalogue (id of the last product
//                        of the previous page; response carries next_since_id)
//
// Auth: Authorization: Bearer <BOT_API_TOKEN>. Enforced in middleware.ts and
// re-checked here. No POST/PUT/DELETE handlers exist on this route.

import { type NextRequest, NextResponse } from "next/server";
import { botRequestAuthorized } from "@/lib/bot-auth";
import { fetchAdminProductsDetailed, type AdminProductDetailed } from "@/lib/shopify/products-admin";
import { shapeForBot } from "@/lib/bot-products";
import { CATEGORY_TO_COLLECTION } from "@/lib/collections";
import { getSQL } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function clampLimit(raw: string | null, fallback = 50): number {
  const n = parseInt(raw || "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), 250);
}

function matchesSearch(p: AdminProductDetailed, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = `${p.title} ${p.vendor} ${p.productType} ${p.tags.join(" ")} ${p.handle}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

async function cachedProducts(opts: { vendor?: string | null; collection?: string | null; limit: number }): Promise<AdminProductDetailed[]> {
  try {
    const sql = getSQL();
    const rows = (opts.collection
      ? await sql`SELECT * FROM products WHERE collection_slug = ${opts.collection} ORDER BY title LIMIT ${opts.limit}`
      : opts.vendor
        ? await sql`SELECT * FROM products WHERE LOWER(vendor) = ${opts.vendor.toLowerCase()} ORDER BY title LIMIT ${opts.limit}`
        : await sql`SELECT * FROM products ORDER BY title LIMIT ${opts.limit}`) as Array<Record<string, any>>;
    return rows.map((row) => ({
      id: String(row.id),
      title: row.title || "",
      handle: row.handle || "",
      status: row.status || "active",
      vendor: row.vendor || "",
      productType: row.product_type || "",
      tags: String(row.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean),
      price: row.price || "",
      compareAtPrice: row.compare_at_price || null,
      sku: row.sku || "",
      images: row.image_url ? [row.image_url] : [],
      url: row.url || (row.handle ? `https://greenthumbdepot.com/products/${row.handle}` : ""),
      updatedAt: null,
      inStock: true,
    }));
  } catch (err) {
    console.error("[bot/products] cache read failed:", err);
    return [];
  }
}

function matchesBrand(p: AdminProductDetailed, brand: string): boolean {
  if (!brand) return true;
  const v = p.vendor.toLowerCase();
  const b = brand.toLowerCase();
  return v === b || v.includes(b);
}

function matchesType(p: AdminProductDetailed, type: string): boolean {
  return !type || p.productType.toLowerCase().includes(type.toLowerCase());
}

// Shopify's vendor and title filters are exact matches, so "Auroom" misses
// "Auroom Saunas" and "barrel sauna" misses every title. For brand or search
// without a collection, walk the active catalogue in pages of 250 and filter
// here, stopping once `limit` matches are in hand or the page cap is reached.
const MAX_SCAN_PAGES = 15;

export async function GET(request: NextRequest) {
  if (!(await botRequestAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const search = (sp.get("search") || sp.get("q") || "").trim();
  const collectionParam = (sp.get("collection") || "").trim();
  const category = (sp.get("category") || "").trim();
  const brand = (sp.get("brand") || sp.get("vendor") || "").trim();
  const productType = (sp.get("type") || sp.get("productType") || "").trim();
  const limit = clampLimit(sp.get("limit"));
  const sinceId = parseInt(sp.get("since_id") || "", 10) || null;

  const collection = collectionParam || (category ? CATEGORY_TO_COLLECTION[category] || category : "");
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const keep = (p: AdminProductDetailed) => matchesBrand(p, brand) && matchesType(p, productType) && matchesSearch(p, terms);
  const filters = { search: search || null, collection: collection || null, brand: brand || null, type: productType || null, limit, since_id: sinceId };

  // 1. A collection: fetch it whole (paged) and filter here.
  if (collection) {
    const live = await fetchAdminProductsDetailed({ collectionHandle: collection, limit: 250 });
    if (!live.ok) {
      const cached = (await cachedProducts({ collection, limit: 250 })).filter(keep);
      return NextResponse.json({ products: cached.slice(0, limit).map(shapeForBot), count: Math.min(cached.length, limit), total: cached.length, source: "cached-products-table", filters, next_since_id: null });
    }
    if (live.unknownCollection) {
      return NextResponse.json({ error: `Unknown collection handle: ${collection}`, products: [], count: 0, total: 0, source: "shopify-admin-live", filters }, { status: 404 });
    }
    const matched = live.products.filter(keep);
    return NextResponse.json({ products: matched.slice(0, limit).map(shapeForBot), count: Math.min(matched.length, limit), total: matched.length, source: "shopify-admin-live", filters, next_since_id: null });
  }

  // 2. Brand, type or search without a collection: scan the catalogue.
  if (brand || productType || terms.length) {
    const matched: AdminProductDetailed[] = [];
    let cursor = sinceId;
    let pages = 0;
    let failed = false;
    let exhausted = false;
    while (pages < MAX_SCAN_PAGES && matched.length < limit) {
      const page = await fetchAdminProductsDetailed({ sinceId: cursor, limit: 250 });
      if (!page.ok) { failed = true; break; }
      pages++;
      for (const p of page.products) if (keep(p)) matched.push(p);
      if (page.products.length < 250) { exhausted = true; break; }
      cursor = Number(page.products[page.products.length - 1].id);
    }
    if (failed && matched.length === 0 && pages === 0) {
      const cached = (await cachedProducts({ vendor: brand || null, limit: 250 })).filter(keep);
      return NextResponse.json({ products: cached.slice(0, limit).map(shapeForBot), count: Math.min(cached.length, limit), total: cached.length, source: "cached-products-table", filters, next_since_id: null });
    }
    const pageOut = matched.slice(0, limit);
    // Resume point: the id of the last matched product returned, so the next
    // call continues from there; null once the catalogue was fully scanned.
    const nextSince = exhausted && matched.length <= limit ? null : (pageOut.length ? Number(pageOut[pageOut.length - 1].id) : cursor);
    return NextResponse.json({ products: pageOut.map(shapeForBot), count: pageOut.length, total: matched.length, source: "shopify-admin-live", filters, scanned_pages: pages, next_since_id: nextSince });
  }

  // 3. Plain catalogue page.
  const live = await fetchAdminProductsDetailed({ sinceId, limit });
  if (!live.ok) {
    const cached = await cachedProducts({ limit });
    return NextResponse.json({ products: cached.map(shapeForBot), count: cached.length, total: cached.length, source: "cached-products-table", filters, next_since_id: null });
  }
  const lastId = live.products.length ? Number(live.products[live.products.length - 1].id) : null;
  return NextResponse.json({
    products: live.products.map(shapeForBot),
    count: live.products.length,
    total: live.products.length,
    source: "shopify-admin-live",
    filters,
    next_since_id: live.products.length === limit && lastId ? lastId : null,
  });
}
