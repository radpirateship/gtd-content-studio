// GET /api/content-brain/cluster-links?collection=<handle>&exclude=<id>
//
// The link inventory for an article, built from the content brain rather than
// the old topical_authority CSV. Ryan plans 30 to 40 articles per batch and
// interlinks within the batch, so PLANNED articles in the same cluster are
// valid link targets even though they are not published yet: they go live
// together and the slugs are the ones the queue publishes under.
//
// Returns every brain row in the collection that has a url_slug, flagged
// planned or live, and marked cluster:true.
//
// The planned flag CANNOT be trusted on its own. content_brain.status is set
// to "live" when an article is generated, before it is published, so a batch
// still sitting in the draft queue reports as live and the generate route then
// discarded every one of them for not being on Shopify. That is why the 8 Sept
// dynamometer run interlinked only backwards, each article reaching the ones
// generated before it and nothing else. cluster:true is the durable signal:
// this URL belongs to the article's own cluster and the batch publishes under
// it, whatever the status flag currently says.
import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

export const dynamic = "force-dynamic";

const LIVE = new Set(["live", "published"]);
const EXCLUDED = new Set(["archived", "phantom", "rejected", "deleted", "duplicate"]);

export async function GET(req: NextRequest) {
  const collection = (req.nextUrl.searchParams.get("collection") || "").trim().toLowerCase();
  const excludeId = Number(req.nextUrl.searchParams.get("exclude") || 0);
  if (!collection) return NextResponse.json({ error: "collection is required" }, { status: 400 });

  try {
    const sql = getSQL();
    const rows = Array.from(await sql`
      SELECT id, title, url_slug, status, collection, collection_slug, cluster_group, description, meta_title
      FROM content_brain
      WHERE url_slug IS NOT NULL AND url_slug <> ''
        AND (
          LOWER(collection_slug) = ${collection}
          OR LOWER(collection) = ${collection}
          OR LOWER(cluster_group) = ${collection}
          OR LOWER(REPLACE(collection, ' ', '-')) = ${collection}
        )
    `) as { id: number; title: string; url_slug: string; status: string | null; description: string | null; meta_title: string | null }[];

    const seen = new Set<string>();
    const links = rows
      .filter((r) => r.id !== excludeId && !EXCLUDED.has((r.status || "").toLowerCase()))
      .map((r) => {
        const handle = r.url_slug.split("/").filter(Boolean).pop() || r.url_slug;
        return {
          id: r.id,
          title: r.title,
          url: `/blogs/wellness/${handle}`,
          description: r.description || "",
          planned: !LIVE.has((r.status || "").toLowerCase()),
          cluster: true,
          status: r.status,
        };
      })
      .filter((l) => { if (seen.has(l.url)) return false; seen.add(l.url); return true; });

    return NextResponse.json({
      links,
      live: links.filter((l) => !l.planned).length,
      planned: links.filter((l) => l.planned).length,
    });
  } catch (e) {
    console.error("[cluster-links]", e);
    return NextResponse.json({ links: [], live: 0, planned: 0, error: "query failed" }, { status: 500 });
  }
}
