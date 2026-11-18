import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { listAdminCollections } from "@/lib/shopify/products-admin";
import { ensureCollectionColumns } from "@/lib/ensureCollectionColumns";
import { BRAND_COLLECTIONS } from "@/lib/collection-link-map";
import { guessCategory } from "@/lib/collection-category";

/**
 * POST /api/collections/sync-shopify
 *
 * Pulls ALL live collections from Shopify and registers any the audit queue
 * doesn't know about (e.g. the person-size sauna collections created after
 * the spreadsheet import). Existing rows are never modified — spreadsheet
 * keywords/volumes stay authoritative. New rows get the collection title as
 * a starting primary keyword so grading works immediately; refine later.
 *
 * 2026-08-11: category assignment moved to lib/collection-category.ts. The old
 * inline guessCategory() had four categories and defaulted to "Wellness", which
 * filed all 22 clinical collections plus 14 fitness pages (leg-equipment,
 * chest-equipment, arms-equipment, kettlebells, plyo-boxes …) as Wellness.
 * The shared module adds Clinical and returns "Unsorted" instead of guessing,
 * so anything unmatched surfaces in the queue rather than hiding.
 *
 * Also refreshes the Shopify-owned facts on every sync — published state and
 * last_synced_at — so the collection detail panel can show routing without a
 * live Admin API call. Research columns are never touched here.
 */

export const maxDuration = 120;

export async function POST() {
  try {
    const sql = getSQL();
    await ensureCollectionColumns(sql);

    const live = await listAdminCollections();
    if (live.length === 0) {
      return NextResponse.json({ error: "Could not list collections from Shopify" }, { status: 500 });
    }

    const existing = (await sql`SELECT slug FROM ppw_collections`) as Array<{ slug: string }>;
    const known = new Set(existing.map((r) => r.slug));
    const missing = live.filter((c) => !known.has(c.handle));

    const added: string[] = [];
    for (const c of missing) {
      await sql`
        INSERT INTO ppw_collections (slug, url, category, collection_type, primary_keyword, secondary_keywords)
        VALUES (
          ${c.handle},
          ${"https://peakprimalwellness.com/collections/" + c.handle},
          ${guessCategory(c.handle)},
          'standard',
          ${c.title.toLowerCase()},
          ${[] as string[]}
        )
        ON CONFLICT (slug) DO NOTHING
      `;
      added.push(c.handle);
    }

    // ── Reconcile stale doc rows: singular/plural slug drift ─────────────────
    // The research doc sometimes has "exercise-bike" where Shopify went with
    // "exercise-bikes" (or vice versa). Move the doc row's keywords/volume onto
    // the live row and drop the stale one, so Shopify stays the source of truth
    // for what exists and the doc's research data isn't lost.
    const normSlug = (h: string) =>
      h.toLowerCase().split("-").map((w) => w.replace(/([^s])s$/, "$1")).join("-");
    const liveByNorm = new Map(live.map((c) => [normSlug(c.handle), c.handle]));
    const liveSet = new Set(live.map((c) => c.handle));
    const allRows = (await sql`SELECT slug, primary_keyword, secondary_keywords, search_volume, kd, tier FROM ppw_collections`) as Array<Record<string, unknown>>;
    const merged: string[] = [];
    for (const row of allRows) {
      const slug = String(row.slug);
      if (liveSet.has(slug)) continue; // row matches a live collection — fine
      const liveMatch = liveByNorm.get(normSlug(slug));
      if (!liveMatch || liveMatch === slug) continue;
      // Copy research data onto the live row where the live row has none.
      await sql`
        UPDATE ppw_collections t SET
          primary_keyword = COALESCE(NULLIF(t.primary_keyword, ''), ${row.primary_keyword as string}),
          secondary_keywords = CASE WHEN t.secondary_keywords IS NULL OR cardinality(t.secondary_keywords) = 0 THEN ${Array.isArray(row.secondary_keywords) ? (row.secondary_keywords as string[]) : ([] as string[])} ELSE t.secondary_keywords END,
          search_volume = COALESCE(t.search_volume, ${row.search_volume as number}),
          kd = COALESCE(t.kd, ${row.kd as number}),
          tier = COALESCE(t.tier, ${row.tier as string})
        WHERE t.slug = ${liveMatch}
      `;
      await sql`DELETE FROM ppw_collections WHERE slug = ${slug}`;
      merged.push(`${slug} -> ${liveMatch}`);
    }

    // ── Refresh Shopify-owned facts on every live row ────────────────────────
    // Research columns are deliberately excluded. Only what Shopify owns.
    let synced = 0;
    for (const c of live) {
      const published = (c as { publishedOnCurrentPublication?: boolean; published?: boolean }).publishedOnCurrentPublication
        ?? (c as { published?: boolean }).published
        ?? null;
      await sql`
        UPDATE ppw_collections
        SET is_published   = COALESCE(${published}, is_published),
            last_synced_at = NOW()
        WHERE slug = ${c.handle}
      `;
      synced++;
    }

    // ── Backfill categories for rows that never got one, or got the old
    // "Wellness" default before Clinical existed. Never overwrites a category
    // a human set to something the rules would not produce.
    const uncategorised = (await sql`
      SELECT slug, category FROM ppw_collections
      WHERE category IS NULL OR category = '' OR category = 'Wellness'
    `) as Array<{ slug: string; category: string | null }>;
    const recategorised: string[] = [];
    for (const row of uncategorised) {
      const next = guessCategory(row.slug);
      if (next === row.category || next === "Unsorted") continue;
      await sql`UPDATE ppw_collections SET category = ${next} WHERE slug = ${row.slug}`;
      recategorised.push(`${row.slug}: ${row.category ?? "null"} -> ${next}`);
    }

    // Tag brand collections (from the Brand Collections tab of the
    // optimization doc + finnmark) so the queue and Improve use the brand
    // template. Only touches rows still marked 'standard' or null.
    // Known brands from the optimization doc + any vendor in the live product
    // catalog whose slugified name matches a collection handle. New brands are
    // onboarded weekly, so the vendor match keeps tagging current without doc
    // updates. False positives are one click to untag in the queue.
    const slugify = (n: string) => n.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    let vendorSlugs: string[] = [];
    try {
      const vendorRows = (await sql`SELECT DISTINCT vendor FROM products WHERE vendor IS NOT NULL AND vendor <> ''`) as Array<{ vendor: string }>;
      vendorSlugs = vendorRows.map((r) => slugify(r.vendor)).filter((v) => v.length > 2);
    } catch { /* products table optional */ }
    const staticSlugs = [...BRAND_COLLECTIONS.map((b) => b.handle), "finnmark"];
    const allRowsForTag = (await sql`SELECT slug, collection_type FROM ppw_collections`) as Array<{ slug: string; collection_type: string | null }>;
    const taggable = allRowsForTag.filter((r) => !r.collection_type || r.collection_type === "standard" || r.collection_type === "");
    const brandTaggedSlugs: string[] = [];
    for (const row of taggable) {
      const isKnown = staticSlugs.includes(row.slug);
      const vendorMatch = vendorSlugs.some((v) => row.slug === v || row.slug.startsWith(v + "-") || v.startsWith(row.slug + "-"));
      if (isKnown || vendorMatch) {
        await sql`UPDATE ppw_collections SET collection_type = 'brand' WHERE slug = ${row.slug}`;
        brandTaggedSlugs.push(row.slug);
      }
    }
    const brandTagged = brandTaggedSlugs.length;

    return NextResponse.json({
      liveCollections: live.length,
      alreadyRegistered: known.size,
      added: added.length,
      addedSlugs: added,
      merged: merged.length,
      mergedPairs: merged,
      synced,
      recategorised: recategorised.length,
      recategorisedRows: recategorised,
      brandTagged,
      brandTaggedSlugs,
    });
  } catch (error) {
    console.error("[collections/sync-shopify] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Collection sync failed" },
      { status: 500 }
    );
  }
}
