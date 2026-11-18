import { NextResponse } from "next/server";
import { listLiveCollectionHandles } from "@/lib/shopify/products-admin";
import { MASTER_COLLECTIONS, COLLECTION_AFFINITY } from "@/lib/collections";
import {
  COLLECTION_KEYWORDS,
  SECONDARY_MAP,
  APP_SLUG_TO_LIVE_HANDLE,
  SAUNA_SPECIFIC,
  BRAND_COLLECTIONS,
} from "@/lib/collection-link-map";
import { COLLECTION_DISPLAY_TAGS } from "@/lib/tagMapping";

/**
 * GET /api/maintenance/validate-collection-handles
 *
 * Every collection handle the article pipeline can emit, checked against the
 * collections that actually exist in Shopify.
 *
 * This exists because a handle that quietly stops matching does not fail
 * anywhere. It generates, it publishes, and the reader gets a 404 on the Shop
 * button. That is how 29 published vertical climber articles ended up linking
 * /collections/vertical-climbers when the live handle had always been
 * vertical-climbing-machines. A prompt rule would not have caught it; only a
 * check does.
 *
 * Run it after renaming or deleting any collection in Shopify.
 * `?strict=1` returns 422 when anything is dead, so it can gate a deploy.
 */

export const maxDuration = 60;

type Bad = { handle: string; source: string; usedBy?: string };

export async function GET(req: Request) {
  const strict = new URL(req.url).searchParams.get("strict") === "1";

  const { handles: live } = await listLiveCollectionHandles(true);
  if (!live.size) {
    return NextResponse.json(
      { ok: false, error: "Shopify returned no collections, so nothing could be validated" },
      { status: 503 },
    );
  }

  const bad: Bad[] = [];
  const seen = new Set<string>();
  const check = (handle: string, source: string, usedBy?: string) => {
    if (!handle) return;
    const h = handle.toLowerCase();
    if (live.has(h)) return;
    const key = `${source}:${h}:${usedBy ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    bad.push({ handle, source, ...(usedBy ? { usedBy } : {}) });
  };

  for (const c of MASTER_COLLECTIONS) check(c.shopifyHandle, "MASTER_COLLECTIONS", c.slug);
  for (const [k, v] of Object.entries(COLLECTION_AFFINITY)) {
    check(k, "COLLECTION_AFFINITY key");
    for (const h of v) check(h, "COLLECTION_AFFINITY value", k);
  }
  for (const k of Object.keys(COLLECTION_KEYWORDS)) check(k, "COLLECTION_KEYWORDS");
  for (const [k, v] of Object.entries(SECONDARY_MAP)) {
    check(k, "SECONDARY_MAP key");
    check(v, "SECONDARY_MAP value", k);
  }
  for (const [k, v] of Object.entries(APP_SLUG_TO_LIVE_HANDLE)) check(v, "APP_SLUG_TO_LIVE_HANDLE", k);
  for (const s of SAUNA_SPECIFIC) check(s.handle, "SAUNA_SPECIFIC", s.keyword);
  for (const b of BRAND_COLLECTIONS) check(b.handle, "BRAND_COLLECTIONS", b.name);
  for (const k of Object.keys(COLLECTION_DISPLAY_TAGS)) check(k, "COLLECTION_DISPLAY_TAGS");

  const checked =
    MASTER_COLLECTIONS.length +
    Object.keys(COLLECTION_AFFINITY).length +
    Object.keys(COLLECTION_KEYWORDS).length +
    Object.keys(SECONDARY_MAP).length +
    Object.keys(APP_SLUG_TO_LIVE_HANDLE).length +
    SAUNA_SPECIFIC.length +
    BRAND_COLLECTIONS.length +
    Object.keys(COLLECTION_DISPLAY_TAGS).length;

  const bySource: Record<string, number> = {};
  for (const b of bad) bySource[b.source] = (bySource[b.source] ?? 0) + 1;

  return NextResponse.json(
    {
      ok: bad.length === 0,
      liveCollections: live.size,
      entriesChecked: checked,
      deadHandles: bad.length,
      bySource,
      dead: bad,
    },
    { status: strict && bad.length ? 422 : 200 },
  );
}
