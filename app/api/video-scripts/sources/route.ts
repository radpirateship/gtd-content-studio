// GET /api/video-scripts/sources?kind=product&key=<productId>
// GET /api/video-scripts/sources?kind=collection&key=<handle>
// The material a script is written from: page text, listed specs with ids,
// products, rank, related posts. Read-only.
import { NextRequest, NextResponse } from "next/server";
import { buildPanelSources } from "@/lib/video-scripts/sources";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") || "";
  const key = req.nextUrl.searchParams.get("key") || "";
  if (!key || (kind !== "product" && kind !== "collection")) {
    return NextResponse.json({ ok: false, error: "Pass ?kind=product|collection&key=..." }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, sources: await buildPanelSources(kind, key) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
