// app/api/bot/keyword-audit/route.ts
//
// GET /api/bot/keyword-audit   (read-only, Bearer BOT_API_TOKEN, JSON)
// Every collection in the keyword audit with its current recommendation, so an
// external reviewer (Grok Bot) can scan primaries, titles and metas in one
// pull. Optional ?category=Saunas filter. Review notes go back through
// POST /api/bot/keyword-audit/notes.
import { type NextRequest, NextResponse } from "next/server";
import { botRequestAuthorized } from "@/lib/bot-auth";
import { getSQL } from "@/lib/db";
import { ensureKeywordResearchTable } from "@/lib/keyword-audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await botRequestAuthorized(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const sql = getSQL();
    await ensureKeywordResearchTable(sql);
    const category = (request.nextUrl.searchParams.get("category") || "").trim();
    const rows = (await sql`
      SELECT r.slug, c.category, c.product_count, r.recommendation, r.notes, r.reviewed,
             r.generated_at, r.applied_row_at, r.applied_shopify_at,
             r.research->'live'->>'title' AS live_title, r.research->'live'->>'meta' AS live_meta,
             r.research->'gsc'->>'impressions' AS gsc_impressions, r.research->'gsc'->>'clicks' AS gsc_clicks
      FROM collection_keyword_research r LEFT JOIN ppw_collections c ON c.slug = r.slug
      ORDER BY c.category NULLS LAST, r.slug
    `) as Array<Record<string, any>>;
    const out = rows
      .filter((r) => !category || String(r.category || "").toLowerCase() === category.toLowerCase())
      .map((r) => {
        const rec = r.recommendation || {};
        return {
          slug: r.slug, url: `https://peakprimalwellness.com/collections/${r.slug}`, category: r.category, product_count: r.product_count,
          live_title: r.live_title, live_meta: r.live_meta, gsc_impressions: Number(r.gsc_impressions || 0), gsc_clicks: Number(r.gsc_clicks || 0),
          primary: rec.primary ?? null, secondaries: rec.secondaries ?? [], title_tag: rec.title_tag ?? null, meta_description: rec.meta_description ?? null,
          h1: rec.h1 ?? null, h2_additions: rec.h2_additions ?? [], head_term_verdict: rec.head_term_verdict ?? null, rationale: rec.rationale ?? null, risks: rec.risks ?? null,
          notes: r.notes, reviewed: r.reviewed, generated_at: r.generated_at, applied_row_at: r.applied_row_at, applied_shopify_at: r.applied_shopify_at,
        };
      });
    return NextResponse.json({ count: out.length, collections: out });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "read failed" }, { status: 500 });
  }
}
