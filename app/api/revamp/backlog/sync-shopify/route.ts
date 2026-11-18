import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { apiSuccess } from "@/lib/api-response";
import { revampBacklogSyncSchema } from "@/lib/api-schemas";
import { parseAndValidateJson } from "@/lib/api-utils";
import { fetchStorefrontArticleByHandle } from "@/lib/shopify/blog-storefront";
import { reportError } from "@/lib/reportError";

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseAndValidateJson(request, revampBacklogSyncSchema);
    if (!parsed.success) return parsed.response;

    const sql = getSQL();

    const results = await Promise.allSettled(
      parsed.data.slugs.map(async (slug) => {
        const article = await fetchStorefrontArticleByHandle(slug);

        if (!article) {
          const [updated] = await sql`
            UPDATE blog_post_tracking
            SET last_shopify_sync_at = NOW(), updated_at = NOW()
            WHERE slug = ${slug}
            RETURNING slug
          `;
          return { slug, found: false, updated: Boolean(updated) };
        }

        const body = article.contentHtml || "";
        const canonicalUrl =
          article.onlineStoreUrl || `https://greenthumbdepot.com/blogs/${article.blog.handle}/${article.handle}`;

        const [saved] = await sql`
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
            ${slug},
            ${canonicalUrl},
            ${article.title || slug},
            NULL,
            ${article.legacyId},
            ${article.publishedAt || null},
            ${article.updatedAt || null},
            ${Boolean(article.image?.url)},
            ${/<img/i.test(body)},
            ${/href="\/blogs\//i.test(body)},
            ${/gtd-card|gtd-product/i.test(body)},
            ${/<details|gtd-faq/i.test(body)},
            NOW(),
            NOW()
          )
          ON CONFLICT (slug) DO UPDATE SET
            source_url = COALESCE(blog_post_tracking.source_url, EXCLUDED.source_url),
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
          RETURNING slug, shopify_article_id, current_title
        `;

        return { slug, found: true, item: saved };
      })
    );

    const synced = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const failed = results.flatMap((result) =>
      result.status === "rejected" ? [String(result.reason)] : []
    );

    return apiSuccess({
      synced,
      failed,
      syncedCount: synced.length,
      failedCount: failed.length,
    });
  } catch (error) {
    reportError(error, { route: "//api/revamp/backlog/sync-shopify", method: "POST" });
    console.error("POST /api/revamp/backlog/sync-shopify error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync Shopify metadata" },
      { status: 500 }
    );
  }
}
