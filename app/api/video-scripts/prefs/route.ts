// POST /api/video-scripts/prefs { hiddenCollections: string[] }
import { NextRequest, NextResponse } from "next/server";
import { setMeta } from "@/lib/video-scripts/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { hiddenCollections?: string[] };
    const hidden = Array.isArray(b.hiddenCollections) ? [...new Set(b.hiddenCollections.map(String))] : [];
    await setMeta("hidden_collections", hidden);
    return NextResponse.json({ ok: true, hiddenCollections: hidden });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
