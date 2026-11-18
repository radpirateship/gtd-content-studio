// app/api/collections/keyword-audit/route.ts
//
// GET  /api/collections/keyword-audit            list collections with research + recommendation state
// POST /api/collections/keyword-audit            { bundle: "all" | <name> } import bundled research files
//                                                 or { rows: [{slug, research}] } import uploaded research
import { type NextRequest, NextResponse } from "next/server";
import { primaryMissing } from "@/lib/keyword-audit-facts";
import type { Recommendation } from "@/lib/keyword-audit";
import { getSQL } from "@/lib/db";
import { ensureCollectionColumns } from "@/lib/ensureCollectionColumns";
import { ensureKeywordResearchTable } from "@/lib/keyword-audit";
import { RESEARCH_BUNDLES } from "@/lib/keyword-research-bundles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const sql = getSQL();
    await ensureCollectionColumns(sql);
    await ensureKeywordResearchTable(sql);
    const rows = (await sql`
      SELECT r.slug, r.generated_at, r.applied_row_at, r.applied_shopify_at, r.reviewed, r.notes, r.imported_at, r.content_drafted_at, r.content_published_at, r.keep_title,
             (r.previous_shopify IS NOT NULL) AS has_snapshot,
             r.recommendation->>'meta_description' AS rec_meta,
             (r.recommendation IS NOT NULL) AS has_recommendation,
             r.recommendation->>'primary' AS rec_primary,
             r.recommendation->>'title_tag' AS rec_title,
             length(r.recommendation->>'title_tag') AS rec_title_len,
             length(r.recommendation->>'meta_description') AS rec_meta_len,
             r.research->'gsc'->>'impressions' AS gsc_impressions,
             r.research->'gsc'->>'clicks' AS gsc_clicks,
             c.category, c.primary_keyword, c.title_tag, c.meta_description, c.product_count, c.is_hidden
      FROM collection_keyword_research r
      LEFT JOIN ppw_collections c ON c.slug = r.slug
      ORDER BY c.category NULLS LAST, r.slug
    `) as Array<Record<string, unknown>>;
    for (const row of rows) {
      row.primary_missing = !!row.has_recommendation && primaryMissing({ primary: String(row.rec_primary || ""), title_tag: String(row.rec_title || ""), meta_description: String(row.rec_meta || "") } as Recommendation);
      delete row.rec_meta;
    }
    return NextResponse.json({ rows, bundles: RESEARCH_BUNDLES.map((b) => ({ name: b.name, count: b.rows.length })) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "list failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { bundle?: string; rows?: Array<{ slug: string; research: unknown }> };
    let rows: Array<{ slug: string; research: unknown }> = [];
    if (body.bundle) {
      for (const b of RESEARCH_BUNDLES) if (body.bundle === "all" || b.name === body.bundle) rows.push(...b.rows);
    } else if (Array.isArray(body.rows)) rows = body.rows;
    if (!rows.length) return NextResponse.json({ error: "Nothing to import" }, { status: 400 });

    const sql = getSQL();
    await ensureKeywordResearchTable(sql);
    let upserted = 0;
    for (const r of rows) {
      if (!r.slug || !r.research) continue;
      await sql`
        INSERT INTO collection_keyword_research (slug, research, imported_at)
        VALUES (${r.slug}, ${JSON.stringify(r.research)}::jsonb, NOW())
        ON CONFLICT (slug) DO UPDATE SET research = EXCLUDED.research, imported_at = NOW()
      `;
      upserted++;
    }
    return NextResponse.json({ ok: true, upserted });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "import failed" }, { status: 500 });
  }
}
