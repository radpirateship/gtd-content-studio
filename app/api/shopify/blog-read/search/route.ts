import { type NextRequest, NextResponse } from "next/server";
import { searchAdminArticles } from "@/lib/shopify/blog-admin";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const tag = searchParams.get("tag");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 100);

    if (!query && !tag) {
      return NextResponse.json(
        { error: "Provide a search query (?q=) or tag filter (?tag=)" },
        { status: 400 }
      );
    }

    const articles = await searchAdminArticles({ query, tag, limit });
    const results = articles.map((article) => {
      const body = article.body_html || "";
      return {
        id: article.id,
        legacy_id: article.legacy_id,
        title: article.title,
        handle: article.handle,
        tags: article.tags,
        published_at: article.published_at,
        updated_at: article.updated_at,
        blog_handle: article.blog_handle,
        online_store_url: article.online_store_url,
        has_image: !!article.image?.src,
        has_content_images: /<img/i.test(body),
        has_internal_links: /href="\/blogs\//i.test(body),
        has_products: /gtd-card|gtd-product/i.test(body),
        has_faq: /<details|gtd-faq/i.test(body),
      };
    });

    return NextResponse.json({ articles: results, blog_count: null });
  } catch (error) {
    console.error("[blog-read/search] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to search articles" },
      { status: 500 }
    );
  }
}
