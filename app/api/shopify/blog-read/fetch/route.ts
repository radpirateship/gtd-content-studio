import { type NextRequest, NextResponse } from "next/server";
import {
  fetchAdminArticleByHandle,
  fetchAdminArticleById,
} from "@/lib/shopify/blog-admin";
import { reportError } from "@/lib/reportError";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const handle = searchParams.get("handle");
    const articleId = searchParams.get("id");

    if (!handle && !articleId) {
      return NextResponse.json(
        { error: "Provide either ?handle= or ?id= parameter" },
        { status: 400 }
      );
    }

    const article = articleId
      ? await fetchAdminArticleById(articleId)
      : await fetchAdminArticleByHandle(handle || "");

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    return NextResponse.json(article);
  } catch (error) {
    reportError(error, { route: "//api/shopify/blog-read/fetch", method: "GET" });
    console.error("[blog-read/fetch] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch article" },
      { status: 500 }
    );
  }
}
