// GET /api/shopify/collections
// Lists all live Shopify collections (handle + title) for the searchable
// "product collection" picker. Falls back to the curated master list if the
// live call fails, so the picker is never empty.
import { NextResponse } from "next/server";
import { listAdminCollections } from "@/lib/shopify/products-admin";
import { MASTER_COLLECTIONS } from "@/lib/collections";
import { getSQL } from "@/lib/db";
import { asHub } from "@/lib/collection-category";

export const maxDuration = 60;

/**
 * Hub per handle from the synced collections table. The live Shopify call
 * knows handle and title; the hub (Saunas, Recovery, Fitness, Wellness,
 * Clinical) lives in gtd_collections.category. Empty map on failure.
 */
async function hubByHandle(): Promise<Map<string, string>> {
  try {
    const sql = getSQL();
    const rows = Array.from(await sql`SELECT slug, category FROM gtd_collections WHERE category IS NOT NULL AND category <> ''`) as { slug: string; category: string }[];
    return new Map(rows.flatMap((r) => { const h = asHub(r.category); return h ? [[r.slug.toLowerCase(), h] as [string, string]] : []; }));
  } catch {
    return new Map();
  }
}

export async function GET() {
  try {
    const [live, hubs] = await Promise.all([listAdminCollections(), hubByHandle()]);
    if (live.length > 0) {
      const masterHub = new Map(MASTER_COLLECTIONS.map((m) => [m.shopifyHandle, m.hub as string]));
      // Hub first, then title, so a grouped picker reads naturally.
      const collections = live
        .filter((c) => c.handle && c.title)
        .map((c) => ({ handle: c.handle, title: c.title, hub: hubs.get(c.handle.toLowerCase()) || masterHub.get(c.handle) || "Unsorted" }))
        .sort((a, b) => a.hub.localeCompare(b.hub) || a.title.localeCompare(b.title));
      return NextResponse.json({ collections, source: "shopify", count: collections.length });
    }
  } catch (err) {
    console.warn("[shopify/collections] live fetch failed, using master list:", err instanceof Error ? err.message : err);
  }

  const fallback = (MASTER_COLLECTIONS as Array<{ shopifyHandle: string; label: string; hub: string }>)
    .map((c) => ({ handle: c.shopifyHandle, title: c.label, hub: c.hub }))
    .sort((a, b) => a.hub.localeCompare(b.hub) || a.title.localeCompare(b.title));
  return NextResponse.json({ collections: fallback, source: "master-list", count: fallback.length });
}
