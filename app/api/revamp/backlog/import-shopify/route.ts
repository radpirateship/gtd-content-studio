import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

// Import all Shopify blog articles into blog_post_tracking using the ADMIN API
// (the app's existing shpat_ token) instead of the Storefront API. The Admin
// token is already provisioned via the OAuth install, so this needs no separate
// Storefront access token or unauthenticated scopes.
//
// Fetching + upserting every article can exceed 10s on large blogs, so raise the
// function limit to avoid Vercel killing it mid-write.
export const maxDuration = 120;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];

type AdminArticle = {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  published_at: string | null;
  updated_at: string | null;
  image?: { src?: string } | null;
};

type AdminBlog = { id: number; handle: string };

// Find an API version this store/token actually serves.
async function resolveVersion(token: string): Promise<string> {
  for (const v of API_VERSIONS) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs.json?limit=1`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (res.ok) return v;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Shopify auth failed (${res.status}) — check SHOPIFY_ACCESS_TOKEN`);
    }
  }
  throw new Error("No working Shopify Admin API version found");
}

// Cursor pagination via the Link response header (Shopify REST standard).
function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const next = linkHeader.split(",").find((p) => p.includes('rel="next"'));
  if (!next) return null;
  const url = next.match(/<([^>]+)>/)?.[1];
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("page_info");
  } catch {
    return null;
  }
}

async function fetchAllAdminArticles(token: string, version: string) {
  const base = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}`;
  const headers = { "X-Shopify-Access-Token": token };

  const blogsRes = await fetch(`${base}/blogs.json?limit=250`, { headers });
  if (!blogsRes.ok) throw new Error(`Failed to list blogs (${blogsRes.status})`);
  const blogs: AdminBlog[] = (await blogsRes.json()).blogs || [];

  const out: Array<{ article: AdminArticle; blogHandle: string }> = [];
  for (const blog of blogs) {
    let pageInfo: string | null = null;
    do {
      // page_info cannot be combined with filters other than limit.
      const query = pageInfo ? `limit=250&page_info=${encodeURIComponent(pageInfo)}` : `limit=250`;
      const res = await fetch(`${base}/blogs/${blog.id}/articles.json?${query}`, { headers });
      if (!res.ok) break;
      const data = await res.json();
      const articles: AdminArticle[] = data.articles || [];
      for (const a of articles) out.push({ article: a, blogHandle: blog.handle });
      pageInfo = parseNextPageInfo(res.headers.get("link"));
    } while (pageInfo);
  }
  return out;
}

export async function POST(_request: NextRequest) {
  try {
    const sql = getSQL();
    const token = await getShopifyAccessToken();
    const version = await resolveVersion(token);
    const items = await fetchAllAdminArticles(token, version);

    if (items.length === 0) return apiError("No Shopify blog articles found", 400);

    const BATCH_SIZE = 50;
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(({ article, blogHandle }) => {
          const body = article.body_html || "";
          const sourceUrl = `https://greenthumbdepot.com/blogs/${blogHandle}/${article.handle}`;
          return sql`
            INSERT INTO blog_post_tracking (
              slug,
              source_url,
              current_title,
              category,
              shopify_article_id,
              shopify_published_at,
              shopify_updated_at,
              has_image,
              has_content_images,
              has_internal_links,
              has_products,
              has_faq,
              last_shopify_sync_at,
              updated_at
            ) VALUES (
              ${article.handle},
              ${sourceUrl},
              ${article.title},
              NULL,
              ${article.id},
              ${article.published_at || null},
              ${article.updated_at || null},
              ${Boolean(article.image?.src)},
              ${/<img/i.test(body)},
              ${/href="\/blogs\//i.test(body)},
              ${/gtd-card|gtd-product/i.test(body)},
              ${/<details|gtd-faq/i.test(body)},
              NOW(),
              NOW()
            )
            ON CONFLICT (slug) DO UPDATE SET
              source_url = EXCLUDED.source_url,
              current_title = EXCLUDED.current_title,
              shopify_article_id = COALESCE(EXCLUDED.shopify_article_id, blog_post_tracking.shopify_article_id),
              shopify_published_at = EXCLUDED.shopify_published_at,
              shopify_updated_at = EXCLUDED.shopify_updated_at,
              has_image = EXCLUDED.has_image,
              has_content_images = EXCLUDED.has_content_images,
              has_internal_links = EXCLUDED.has_internal_links,
              has_products = EXCLUDED.has_products,
              has_faq = EXCLUDED.has_faq,
              last_shopify_sync_at = NOW(),
              updated_at = NOW()
          `;
        })
      );
      successCount += results.filter((r) => r.status === "fulfilled").length;
      failedCount += results.filter((r) => r.status === "rejected").length;
    }

    return apiSuccess({
      blogs: [],
      syncedCount: successCount,
      failedCount,
      message: `Imported ${successCount} of ${items.length} Shopify blog articles${failedCount > 0 ? ` (${failedCount} failed)` : ""}`,
    });
  } catch (error) {
    console.error("POST /api/revamp/backlog/import-shopify error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import Shopify blogs" },
      { status: 500 }
    );
  }
}
