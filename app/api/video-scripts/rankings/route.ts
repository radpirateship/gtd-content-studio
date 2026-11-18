// GET /api/video-scripts/rankings: ranked products and collections with the
// script status for each, plus refresh metadata. Read-only.
import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ensureVideoTables, getMeta } from "@/lib/video-scripts/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_ORDER = ["posted", "recorded", "approved", "draft", "rejected"];

export async function GET() {
  try {
    await ensureVideoTables();
    const sql = getSQL();
    const [rows, scripts, ranking, articles, hidden] = await Promise.all([
      sql`SELECT kind, key, rank, title, handle, vendor, status, image_url, price, net, units, orders, product_count, flags, collections, products
          FROM video_rankings ORDER BY kind, rank`,
      sql`SELECT kind, target_key, status, COUNT(*)::int AS n FROM video_scripts GROUP BY kind, target_key, status`,
      getMeta("ranking", null),
      getMeta("articles", null),
      getMeta<string[]>("hidden_collections", []),
    ]);

    const byTarget = new Map<string, Record<string, number>>();
    for (const s of scripts as Array<{ kind: string; target_key: string; status: string; n: number }>) {
      const k = `${s.kind}:${s.target_key}`;
      const m = byTarget.get(k) || {};
      m[s.status] = s.n;
      byTarget.set(k, m);
    }

    const shaped = (rows as Array<Record<string, unknown>>).map((r) => {
      const counts = byTarget.get(`${r.kind}:${r.key}`) || {};
      const scriptStatus = STATUS_ORDER.find((s) => counts[s]) || null;
      return { ...r, kind: String(r.kind), net: Number(r.net), scriptStatus, scriptCounts: counts };
    });

    return NextResponse.json({
      ok: true,
      ranking,
      articles,
      hiddenCollections: hidden,
      products: shaped.filter((r) => r.kind === "product"),
      collections: shaped.filter((r) => r.kind === "collection"),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
