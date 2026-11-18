// GET /api/collections/apply-guide-map            -> dry run: what would change
// GET /api/collections/apply-guide-map?apply=1    -> write it
// GET /api/collections/apply-guide-map?apply=1&overwrite=1 -> also replace
//                                                    guides already set
//
// Applies scripts/ultimate-guide-map.json (collection handle -> guide) to
// ppw_collections. Rows are only updated when they are in the synced table,
// so run /api/collections/sync-shopify first if a handle is missing. By
// default a collection that already has a guide URL is left alone; pass
// overwrite=1 to replace it with the map's value. Visit it logged in; the
// cookie gate covers it like every other API route.
import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ensureCollectionColumns } from "@/lib/ensureCollectionColumns";
import guideMap from "@/scripts/ultimate-guide-map.json";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Entry = { url: string; title: string };

export async function GET(req: NextRequest) {
  const apply = req.nextUrl.searchParams.get("apply") === "1";
  const overwrite = req.nextUrl.searchParams.get("overwrite") === "1";
  const map = guideMap as Record<string, Entry>;

  try {
    const sql = getSQL();
    await ensureCollectionColumns(sql);
    const rows = Array.from(await sql`SELECT slug, ultimate_guide_url, ultimate_guide_title FROM ppw_collections`) as
      { slug: string; ultimate_guide_url: string | null; ultimate_guide_title: string | null }[];
    const bySlug = new Map(rows.map((r) => [r.slug.toLowerCase(), r]));

    const willSet: { slug: string; url: string; title: string }[] = [];
    const willReplace: { slug: string; from: string; url: string; title: string }[] = [];
    const unchanged: string[] = [];
    const notSynced: string[] = [];

    for (const [slug, e] of Object.entries(map)) {
      const row = bySlug.get(slug.toLowerCase());
      if (!row) { notSynced.push(slug); continue; }
      const current = (row.ultimate_guide_url || "").trim();
      if (!current) willSet.push({ slug: row.slug, url: e.url, title: e.title });
      else if (current === e.url) unchanged.push(slug);
      else if (overwrite) willReplace.push({ slug: row.slug, from: current, url: e.url, title: e.title });
      else unchanged.push(`${slug} (kept ${current})`);
    }

    let written = 0;
    if (apply) {
      for (const w of [...willSet, ...willReplace]) {
        await sql`UPDATE ppw_collections SET ultimate_guide_url = ${w.url}, ultimate_guide_title = ${w.title} WHERE slug = ${w.slug}`;
        written++;
      }
    }

    return NextResponse.json({
      mode: apply ? "applied" : "dry-run",
      written,
      set: willSet,
      replaced: willReplace,
      unchanged,
      notSynced,
      hint: notSynced.length
        ? "Handles under notSynced are live in Shopify but missing from ppw_collections; run /api/collections/sync-shopify then call this again."
        : undefined,
    });
  } catch (e) {
    console.error("[apply-guide-map]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
