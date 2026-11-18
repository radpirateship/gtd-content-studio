// POST /api/revamp/carry
// The bridge between v2 regeneration and publish-in-place for an existing
// post. Given the freshly generated v2 body and the slug of the LIVE
// article, it: pulls the live article, carries its content images into the
// new body (one per content section, order preserved), rewrites the header
// meta to keep the original published date plus a visible Updated date, and
// grades the result with the v2 checklist. Nothing is published here; the
// caller reviews the grade and then posts to /api/shopify/publish with
// articleId to update in place.
//
// Body: { slug: string, bodyHtml: string, insertImages?: boolean (true), maxImages?: number }
import { type NextRequest, NextResponse } from "next/server";
import { fetchAdminArticleByHandle } from "@/lib/shopify/blog-admin";
import { extractLegacyImages, insertImagesIntoV2Body, applyUpdatedLine } from "@/lib/revamp-v2";
import { gradePostV2 } from "@/lib/post-grader";
import { reportError } from "@/lib/reportError";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { slug, bodyHtml, insertImages, maxImages } = await request.json();
    if (!slug || !bodyHtml) {
      return NextResponse.json({ error: "slug and bodyHtml are required" }, { status: 400 });
    }

    const live = await fetchAdminArticleByHandle(String(slug));
    if (!live) {
      return NextResponse.json({ error: `No live article found for handle "${slug}"` }, { status: 404 });
    }

    let merged: string = String(bodyHtml);
    let imagesFound = 0;
    let imagesCarried = 0;
    if (insertImages !== false) {
      const images = extractLegacyImages(live.body_html, Number(maxImages) || 12);
      imagesFound = images.length;
      const r = insertImagesIntoV2Body(merged, images);
      merged = r.bodyHtml;
      imagesCarried = r.carried;
    }

    merged = applyUpdatedLine(merged, live.published_at);

    const grade = gradePostV2(merged);

    return NextResponse.json({
      ok: true,
      bodyHtml: merged,
      articleId: live.legacy_id,
      blogId: live.blog_id,
      handle: live.handle,
      title: live.title,
      originalPublishedAt: live.published_at,
      hero: live.image,
      imagesFound,
      imagesCarried,
      grade,
    });
  } catch (error) {
    reportError(error, { route: "//api/revamp/carry", method: "POST" });
    console.error("[revamp/carry]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Carry failed" },
      { status: 500 }
    );
  }
}
