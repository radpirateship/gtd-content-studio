// POST /api/video-scripts/articles/refresh
// Rebuilds the index of blog posts and the product/collection links in them.
import { NextResponse } from "next/server";
import { refreshArticleIndex } from "@/lib/video-scripts/articles";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await refreshArticleIndex();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[video-scripts] article index failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
