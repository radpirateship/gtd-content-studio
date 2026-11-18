// POST /api/video-scripts/rankings/refresh  { days?: number }
// Pulls sales from the GTD Dashboard, matches them to the live catalogue,
// maps products to collections and rebuilds the ranking snapshot.
import { NextRequest, NextResponse } from "next/server";
import { refreshRankings } from "@/lib/video-scripts/rankings";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { days?: number };
    const days = Math.min(Math.max(Number(body.days) || 365, 7), 3650);
    const meta = await refreshRankings(days);
    return NextResponse.json({ ok: true, meta });
  } catch (e) {
    console.error("[video-scripts] ranking refresh failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
