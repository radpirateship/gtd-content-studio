import { type NextRequest, NextResponse } from "next/server";
import { replaceWithShopifyImages } from "@/lib/shopifyImageUpload";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

// Allow enough time for Shopify staged uploads + polling (each image ~4-30s)
export const maxDuration = 120;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];

async function shopifyAdminFetch(path: string, options: RequestInit = {}) {
  const token = await getShopifyAccessToken();
  const errors: string[] = [];

  for (const version of API_VERSIONS) {
    const url = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`;
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
          ...options.headers,
        },
      });

      if (response.ok) {
        return response.json();
      }

      const status = response.status;
      const body = await response.text();
      errors.push(`v${version}: ${status} - ${body.slice(0, 200)}`);
      
      if (status === 401 || status === 403) {
        throw new Error(`Shopify auth failed (${status}): ${body.slice(0, 200)}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!errors.includes(msg)) errors.push(msg);
      if (version === API_VERSIONS[API_VERSIONS.length - 1]) {
        throw new Error(`All API versions failed. Errors: ${errors.join(" | ")}`);
      }
    }
  }

  throw new Error(`All Shopify API versions failed. Errors: ${errors.join(" | ")}`);
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
      handle: rawHandle,
      metafields,
      blogId,
      published,
      featuredImageUrl,
      featuredImageAlt,
      updateIfExists,
    } = await request.json();

    // A 13-digit millisecond epoch on the end of a handle is never intentional.
    // It is residue from an old /api/articles collision bug that appended
    // Date.now() whenever a slug PREFIX-matched an existing row. Those slugs
    // are still sitting in the articles table, and publishing one mints a live
    // URL like /blogs/wellness/home-gym-essentials-...-1787401458275 that no
    // duplicate check catches, because the mangled handle genuinely is free.
    // Strip it here, at the one door every publish path goes through, so the
    // handle_exists guard below sees the real handle and does its job.
    const handle =
      typeof rawHandle === "string" ? rawHandle.replace(/-\d{13}$/, "") : rawHandle;
    if (handle !== rawHandle) {
      console.warn(`[shopify-publish] stripped timestamp suffix: "${rawHandle}" -> "${handle}"`);
    }

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

    // Check if body HTML still contains temp images (data URIs or fal.media URLs).
    // If all images already use permanent cdn.shopify.com URLs (uploaded at generation time),
    // we can skip the expensive replaceWithShopifyImages() call entirely.
    const hasTempImages = /data:image\/|fal\.media|fal\.run|fal-cdn|v3\.fal\.media/.test(bodyHtml);
    let processedBodyHtml: string;
    if (hasTempImages) {
      console.warn("[shopify-publish] Found temp images in body HTML — running safety-net upload...");
      processedBodyHtml = await replaceWithShopifyImages(bodyHtml);
    } else {
      console.log("[shopify-publish] All body images already use permanent URLs — skipping re-upload.");
      processedBodyHtml = bodyHtml;
    }

    // Determine featured image: use explicit URL passed via featuredImageUrl
    let rawFeaturedUrl = featuredImageUrl;
    let rawFeaturedAlt = featuredImageAlt || title;

    // Featured image should be passed explicitly via featuredImageUrl — do NOT auto-extract from body HTML

    // Upload featured image to Shopify Files if it's a data URI or temp URL
    let shopifyFeaturedImageUrl = rawFeaturedUrl;
    if (rawFeaturedUrl) {
      try {
        if (rawFeaturedUrl.startsWith("data:")) {
          const { uploadDataUriToShopify } = await import("@/lib/shopifyImageUpload");
          shopifyFeaturedImageUrl = await uploadDataUriToShopify(rawFeaturedUrl, rawFeaturedAlt);
          console.log(`[shopify-publish] Featured image (data URI) uploaded: ${shopifyFeaturedImageUrl.slice(0, 80)}...`);
        } else if (rawFeaturedUrl.match(/fal\.media|fal\.run|fal-cdn/)) {
          const { uploadFalImageToShopify } = await import("@/lib/shopifyImageUpload");
          shopifyFeaturedImageUrl = await uploadFalImageToShopify(rawFeaturedUrl, rawFeaturedAlt);
          console.log(`[shopify-publish] Featured image (fal) uploaded: ${shopifyFeaturedImageUrl.slice(0, 80)}...`);
        }
        // If it's already a cdn.shopify.com URL (from body processing), use as-is
      } catch (err) {
        console.error("[shopify-publish] Featured image upload failed, using original URL:", err);
      }
    }

    // Build the article payload
    const articlePayload: Record<string, unknown> = {
      title,
      body_html: processedBodyHtml,
      published: published !== false,
    };

    if (summary) articlePayload.summary_html = summary;
    if (tags) articlePayload.tags = tags;
    if (author) articlePayload.author = author;
    if (handle) articlePayload.handle = handle;

    if (shopifyFeaturedImageUrl) {
      articlePayload.image = {
        src: shopifyFeaturedImageUrl,
        alt: rawFeaturedAlt,
      };
    }

    if (metafields && metafields.length > 0) {
      // Sanitize metafield values -- Shopify single_line_text_field rejects newlines
      articlePayload.metafields = metafields.map(
        (mf: { namespace: string; key: string; value: string; type: string }) => ({
          ...mf,
          value: mf.type === "single_line_text_field"
            ? (mf.value || "").replace(/[\r\n]+/g, " ").trim()
            : mf.value,
        })
      );
    }

    // A handle that already exists is the normal case for a REVAMP: the whole
    // point is to replace the body of a live article at a URL that must not
    // change. Shopify refuses to create a second article on the same handle
    // (and would otherwise mint "{handle}-1"), so look first.
    //
    // Found + updateIfExists  -> update in place, keeping the slug, the
    //                            published state and the original date.
    // Found + no flag         -> 409 with the article id, so the caller can
    //                            ask before overwriting a live post.
    let existing: { id: number; handle: string } | null = null;
    if (handle) {
      try {
        const lookup = await shopifyAdminFetch(
          `blogs/${targetBlogId}/articles.json?handle=${encodeURIComponent(handle)}&limit=1`
        );
        existing = lookup.articles?.[0] || null;
      } catch (lookupErr) {
        console.warn("[shopify-publish] handle lookup failed, proceeding to create:", lookupErr);
      }
    }

    if (existing && !updateIfExists) {
      return NextResponse.json(
        {
          error: `An article already lives at /blogs/wellness/${handle}. Publishing would create a duplicate URL.`,
          code: "handle_exists",
          existingArticleId: existing.id,
          handle,
          hint: "Re-send with updateIfExists: true to replace the existing article's content in place.",
        },
        { status: 409 }
      );
    }

    let data;
    if (existing) {
      // Update path. handle and published are deliberately NOT sent: the URL
      // is the asset, and re-asserting published state risks moving the
      // original publish date. Freshness is carried by the body's Updated line.
      const updatePayload: Record<string, unknown> = { ...articlePayload, id: existing.id };
      delete updatePayload.handle;
      delete updatePayload.published;
      data = await shopifyAdminFetch(`blogs/${targetBlogId}/articles/${existing.id}.json`, {
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
    const articleUrl = `https://peakprimalwellness.com/blogs/wellness/${createdArticle.handle}`;

    // Ping search engines to re-crawl the sitemap
    const sitemapUrl = "https://peakprimalwellness.com/sitemap.xml";
    const pingResults: Record<string, string> = {};
    const pingUrls = [
      { name: "Google", url: `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}` },
      { name: "Bing", url: `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}` },
      { name: "IndexNow", url: `https://api.indexnow.org/indexnow?url=${encodeURIComponent(articleUrl)}&key=peakprimalwellness` },
    ];
    for (const ping of pingUrls) {
      try {
        const res = await fetch(ping.url, { method: "GET" });
        pingResults[ping.name] = res.ok ? "sent" : `${res.status}`;
        console.log(`[shopify-publish] Sitemap ping ${ping.name}: ${res.ok ? "OK" : res.status}`);
      } catch {
        pingResults[ping.name] = "failed";
      }
    }

    return NextResponse.json({
      success: true,
      updated: Boolean(existing),
      article: {
        id: createdArticle.id,
        title: createdArticle.title,
        handle: createdArticle.handle,
        url: articleUrl,
        published_at: createdArticle.published_at,
        created_at: createdArticle.created_at,
      },
      blogId: targetBlogId,
      sitemapPing: pingResults,
    });
  } catch (error) {
    console.error("Failed to publish article:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to publish article to Shopify" },
      { status: 500 }
    );
  }
}
