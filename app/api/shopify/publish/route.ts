import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { buildShopifyTags, ARTICLE_TYPE_DISPLAY_TAGS } from "@/lib/tagMapping";
import { replaceWithShopifyImages } from "@/lib/shopifyImageUpload";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

// Allow enough time for Shopify staged uploads + polling (each image ~4-30s)
export const maxDuration = 300;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];

async function shopifyAdminFetch(path: string, options: RequestInit = {}) {
  const token = await getShopifyAccessToken();

  for (const version of API_VERSIONS) {
    const url = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`;
    try {
      console.log(`[shopify] Trying API ${version}: ${path}`);
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
          ...options.headers,
        },
      });

      if (response.ok) {
        console.log(`[shopify] SUCCESS on API ${version}`);
        return response.json();
      }

      const status = response.status;
      if (status === 404) continue; // version doesn't exist, try next
      if (status === 401 || status === 403) {
        throw new Error(`Shopify auth failed (${status}) - token may be expired or missing scopes`);
      }

      const body = await response.text();
      console.error(`[shopify] v${version}: ${status} - ${body}`);
    } catch (err) {
      if (version === API_VERSIONS[API_VERSIONS.length - 1]) throw err;
    }
  }

  throw new Error("All Shopify API versions failed. Check your app scopes and credentials.");
}

// GET: List blogs to find the correct blog ID
export async function GET() {
  try {
    const data = await shopifyAdminFetch("blogs.json");
    return NextResponse.json({ blogs: data.blogs || [] });
  } catch (error) {
    console.error("Failed to list blogs:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list blogs" },
      { status: 500 }
    );
  }
}

// POST: Publish an article to a Shopify blog
export async function POST(request: NextRequest) {
  try {
    const {
      title,
      bodyHtml,
      summary,
      tags,
      author,
      handle,
      metafields,
      blogId,
      published,
      featuredImageUrl,
      featuredImageAlt,
      collection,
      articleType,
      articleId,
    } = await request.json();

    if (!title || !bodyHtml) {
      return NextResponse.json(
        { error: "Title and bodyHtml are required" },
        { status: 400 }
      );
    }

    // If no blogId provided, find the first blog
    let targetBlogId = blogId;
    if (!targetBlogId) {
      const blogsData = await shopifyAdminFetch("blogs.json");
      const blogs = blogsData.blogs || [];

      const wellnessBlog = blogs.find(
        (b: { handle: string }) =>
          b.handle === "wellness" ||
          b.handle === "wellness-hub" ||
          b.handle === "news"
      );
      targetBlogId = wellnessBlog?.id || blogs[0]?.id;

      if (!targetBlogId) {
        return NextResponse.json(
          { error: "No blogs found in Shopify store. Please create a blog first." },
          { status: 400 }
        );
      }
    }

    // Upload external fal.media images AND base64 data URIs to Shopify Files
    console.log("[shopify] Processing images for Shopify upload...");
    const processedBodyHtml = await replaceWithShopifyImages(bodyHtml);

    // Build the article payload
    const articlePayload: Record<string, unknown> = {
      title,
      body_html: processedBodyHtml,
      published: published !== false,
    };

    if (summary) articlePayload.summary_html = summary;
    // Tags: hub, collection label, article type. The static map in
    // tagMapping covers ~50 slugs and silently returns nothing for the
    // rest ("home-gym-equipment-for-every-workout" published with only a
    // type tag). Resolve from the synced collections table first, so every
    // live collection tags correctly; merge with whatever the client sent.
    // Tags stay in the DISPLAY format the hub pages already filter on
    // ("Saunas", "How-To", "Buyer's Guide") — the hubs pull specific tags,
    // so the format must not drift. The collection tag is the label trimmed
    // at "for"/":"/"|", so "Home Gym Equipment for Every Workout" tags as
    // "Home Gym Equipment". Shopify slugifies display tags for /tagged/
    // URLs itself, which is what the article breadcrumb links to.
    let finalTags: string = typeof tags === "string" ? tags : "";
    if (collection) {
      try {
        // The hub pages filter on the established tags, so for collections
        // the static map knows, the map wins outright. The synced-table
        // lookup below is only for collections the map has never heard of.
        // Hub-level slugs tag with the hub alone (plus type): "Saunas" is
        // both the type tag and the parent, and retired catch-alls like
        // recovery-tools and general-wellness tag as their hub, never as a
        // collection of their own.
        const HUB_ONLY: Record<string, string> = {
          saunas: "Saunas", recovery: "Recovery", "recovery-tools": "Recovery",
          wellness: "Wellness", "general-wellness": "Wellness",
          fitness: "Fitness", clinical: "Clinical",
        };
        if (HUB_ONLY[String(collection).toLowerCase()]) {
          const typeTag0 = articleType ? ARTICLE_TYPE_DISPLAY_TAGS[articleType] || "" : "";
          const merged = [HUB_ONLY[String(collection).toLowerCase()], typeTag0, ...String(finalTags).split(",")]
            .map((t) => t.trim()).filter(Boolean);
          finalTags = [...new Set(merged)].join(", ");
          if (finalTags) articlePayload.tags = finalTags;
          // fall through to the rest of the publish flow
        } else {
        const mapped = buildShopifyTags(collection, articleType);
        const mappedHasCollectionTag = mapped.split(",").map((t) => t.trim()).filter(Boolean).length >= (articleType ? 2 : 1);
        if (mappedHasCollectionTag) {
          const merged = [...mapped.split(","), ...String(finalTags).split(",")].map((t) => t.trim()).filter(Boolean);
          finalTags = [...new Set(merged)].join(", ");
        } else {
        const sql = getSQL();
        const rows = (await sql`
          SELECT slug, category, title_tag, primary_keyword FROM ppw_collections
          WHERE slug = ${collection}
          LIMIT 1
        `) as { slug: string; category?: string; title_tag?: string; primary_keyword?: string }[];
        if (rows.length) {
          const label = String(rows[0].title_tag || rows[0].primary_keyword || rows[0].slug.replace(/-/g, " "))
            .split(/\s+(?:for|:|\|)\s+/i)[0]
            .replace(/\s*(\||:).*$/, "")
            .trim();
          const hub = rows[0].category ? rows[0].category.charAt(0).toUpperCase() + rows[0].category.slice(1) : "";
          const typeTag = articleType ? ARTICLE_TYPE_DISPLAY_TAGS[articleType] || "" : "";
          const titleCase = (t: string) => t.replace(/\S+/g, (w) => /^(and|or|of|for|the|a|an)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1));
          const merged = [hub, titleCase(label), typeTag, ...String(finalTags).split(",")]
            .map((t) => t.trim())
            .filter(Boolean);
          finalTags = [...new Set(merged)].join(", ");
        } else if (!finalTags) {
          finalTags = buildShopifyTags(collection, articleType);
        }
        }
        }
      } catch (e) {
        console.warn("[shopify] tag lookup failed, using client tags", e instanceof Error ? e.message : e);
        if (!finalTags) finalTags = buildShopifyTags(collection, articleType);
      }
    }
    if (finalTags) articlePayload.tags = finalTags;
    if (author) articlePayload.author = author;
    if (handle) articlePayload.handle = handle;

    if (featuredImageUrl) {
      articlePayload.image = {
        src: featuredImageUrl,
        alt: featuredImageAlt || title,
      };
    }

    if (metafields && metafields.length > 0) {
      articlePayload.metafields = metafields;
    }

    // articleId switches the publish to an UPDATE of the existing Shopify
    // article. Standing rules for updates: the slug never changes (the URL is
    // the asset), and the original published_at is preserved by never sending
    // it on a PUT. The visible "Updated" line is the body's job (revamp/carry).
    let data;
    if (articleId) {
      const numericId = String(articleId).replace(/^gid:\/\/shopify\/[A-Za-z]+\//, "");
      const updatePayload = { ...articlePayload, id: Number(numericId) };
      delete (updatePayload as Record<string, unknown>).handle;
      data = await shopifyAdminFetch(`blogs/${targetBlogId}/articles/${numericId}.json`, {
        method: "PUT",
        body: JSON.stringify({ article: updatePayload }),
      });
    } else {
      data = await shopifyAdminFetch(`blogs/${targetBlogId}/articles.json`, {
        method: "POST",
        body: JSON.stringify({ article: articlePayload }),
      });
    }

    const createdArticle = data.article;

    // Keep the revamp backlog honest: an in-place update flips the tracked
    // row to revamped so the backlog stops offering the post as a candidate.
    if (articleId && createdArticle?.handle) {
      try {
        const sql = getSQL();
        await sql`
          UPDATE blog_post_tracking
          SET status = 'revamped',
              latest_revamp_article_id = ${String(createdArticle.id)},
              published_at = ${createdArticle.published_at || null},
              last_shopify_sync_at = NOW(),
              updated_at = NOW()
          WHERE slug = ${createdArticle.handle}
        `;
      } catch (trackErr) {
        console.warn("[shopify] tracking sync after update failed:", trackErr);
      }
    }

    return NextResponse.json({
      success: true,
      updated: Boolean(articleId),
      article: {
        id: createdArticle.id,
        title: createdArticle.title,
        handle: createdArticle.handle,
        url: `https://peakprimalwellness.com/blogs/wellness/${createdArticle.handle}`,
        published_at: createdArticle.published_at,
        created_at: createdArticle.created_at,
      },
      blogId: targetBlogId,
    });
  } catch (error) {
    console.error("Failed to publish article:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to publish article to Shopify" },
      { status: 500 }
    );
  }
}
