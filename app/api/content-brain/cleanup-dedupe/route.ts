// One-time Content Brain cleanup.
//   GET  -> dry-run report (current counts; nothing deleted)
//   POST -> execute: keep ONLY unique published Shopify articles
//           (source='shopify-import', one row per article), delete everything else.
//
// Safe to run more than once (idempotent once cleaned).
import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

type Sql = ReturnType<typeof getSQL>;

async function report(sql: Sql) {
  const total = Number(((await sql`SELECT COUNT(*)::int AS c FROM content_brain`) as Array<{ c: number }>)[0].c);
  const bySource = (await sql`
    SELECT COALESCE(source, '(none)') AS source, COUNT(*)::int AS c
    FROM content_brain GROUP BY source ORDER BY c DESC
  `) as Array<{ source: string; c: number }>;
  const uniqueShopifyArticles = Number(
    ((await sql`
      SELECT COUNT(DISTINCT shopify_article_id)::int AS c
      FROM content_brain WHERE source = 'shopify-import' AND shopify_article_id IS NOT NULL
    `) as Array<{ c: number }>)[0].c
  );
  return { total, bySource, uniqueShopifyArticles };
}

export async function GET() {
  try {
    const sql = getSQL();
    const before = await report(sql);
    return NextResponse.json({
      mode: "dry-run",
      before,
      note: "POST to execute: keeps unique shopify-import rows (one per article), deletes everything else.",
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "report failed" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const sql = getSQL();
    const before = await report(sql);

    // 1) Delete every row that isn't a published Shopify article (tap-import, chat,
    //    bulk-csv planned ideas, NULL source, etc.).
    await sql`DELETE FROM content_brain WHERE source IS DISTINCT FROM 'shopify-import'`;

    // 2) Dedupe shopify-import rows by Shopify article id — keep the lowest id.
    await sql`
      DELETE FROM content_brain a USING content_brain b
      WHERE a.shopify_article_id IS NOT NULL
        AND a.shopify_article_id = b.shopify_article_id
        AND a.id > b.id
    `;

    // 3) Dedupe any remaining rows by url_slug (covers rows missing a Shopify id).
    await sql`
      DELETE FROM content_brain a USING content_brain b
      WHERE a.url_slug IS NOT NULL
        AND a.url_slug = b.url_slug
        AND a.id > b.id
    `;

    const after = await report(sql);
    return NextResponse.json({
      ok: true,
      deleted: before.total - after.total,
      before,
      after,
      message: `Cleaned Content Brain: ${before.total} → ${after.total} rows (kept unique published articles only).`,
    });
  } catch (err) {
    console.error("[content-brain/cleanup-dedupe]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "cleanup failed" }, { status: 500 });
  }
}
