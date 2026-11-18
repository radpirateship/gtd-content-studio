// POST /api/revamp/run-one
// Revamps ONE queued post end to end, server side: gather inputs, generate a
// v2 body, carry the live article's images and dates, grade it, and update the
// existing Shopify article in place. One article per call so the work always
// fits inside the function timeout, and so a browser that disconnects mid-batch
// loses at most the article in flight: everything already finished is live and
// its tracking row says 'revamped', which the queue skips.
//
// Body: { slug: string, dryRun?: boolean, publish?: boolean }
//   dryRun  - generate, carry and grade, but do not touch Shopify
//   publish - default true; false behaves like dryRun
//
// Returns the grade, the failures, image counts and the Shopify result, so the
// caller can show a row per article without holding the body in memory.
import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { fetchAdminArticleByHandle } from "@/lib/shopify/blog-admin";
import { extractLegacyImages, insertImagesIntoV2Body, applyUpdatedLine } from "@/lib/revamp-v2";
import { gradePostV2 } from "@/lib/post-grader";
import { reportError } from "@/lib/reportError";

export const runtime = "nodejs";
export const maxDuration = 300;

type BrainRow = {
  id: number | null;
  title: string | null;
  keyword: string | null;
  collection: string | null;
  collection_slug: string | null;
  article_type: string | null;
  audience: string | null;
  tone: string | null;
  word_count: number | null;
  special_instructions: string | null;
  target_subcollection: string | null;
  target_brand: string | null;
  ultimate_guide_url: string | null;
  ultimate_guide_title: string | null;
  tracked_title: string | null;
  tracked_category: string | null;
  gsc_keyword: string | null;
  revamp_mode: string | null;
  content_images: number | null;
};

function titleFromSlug(slug: string): string {
  return slug.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// GET /api/revamp/run-one?slug=...
// Did this post actually get revamped? A long generation can outlive the
// browser's patience: the function finishes, publishes and marks the row, but
// the response never lands and the client reports "Failed to fetch". The
// client calls this after any error so a completed job is not re-run and not
// reported as a failure.
export async function GET(request: NextRequest) {
  try {
    const slug = request.nextUrl.searchParams.get("slug");
    if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
    const sql = getSQL();
    const rows = (await sql`
      SELECT t.status, t.last_shopify_sync_at, h.grade, h.grade_failures, h.reviewed_at
      FROM blog_post_tracking t
      LEFT JOIN content_health h ON h.slug = t.slug
      WHERE t.slug = ${slug}
      LIMIT 1
    `) as { status: string | null; last_shopify_sync_at: string | null; grade: number | null; grade_failures: string | null; reviewed_at: string | null }[];
    const row = rows[0];
    return NextResponse.json({
      slug,
      revamped: row?.status === "revamped",
      status: row?.status ?? null,
      grade: row?.grade ?? null,
      failures: row?.grade_failures ? row.grade_failures.split(",").filter(Boolean) : [],
      lastSyncAt: row?.last_shopify_sync_at ?? null,
    });
  } catch (error) {
    reportError(error, { route: "//api/revamp/run-one", method: "GET" });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Status check failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const slug = String(body.slug || "").trim();
    if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
    const publish = body.publish !== false && body.dryRun !== true;

    const sql = getSQL();
    const rows = (await sql`
      SELECT cb.id, cb.title, cb.keyword, cb.collection, cb.collection_slug, cb.article_type,
             cb.audience, cb.tone, cb.word_count, cb.special_instructions,
             cb.target_subcollection, cb.target_brand, cb.ultimate_guide_url, cb.ultimate_guide_title,
             t.current_title AS tracked_title, t.category AS tracked_category,
             h.gsc_keyword, h.revamp_mode, h.content_images
      FROM blog_post_tracking t
      LEFT JOIN content_brain cb ON cb.url_slug = t.slug
      LEFT JOIN content_health h ON h.slug = t.slug
      WHERE t.slug = ${slug}
      LIMIT 1
    `) as BrainRow[];

    // The live article is the authority on title and article id. Everything
    // else is planning data that may be stale or missing on imported rows.
    const live = await fetchAdminArticleByHandle(slug);
    if (!live) {
      return NextResponse.json({ error: `No live Shopify article for "${slug}"` }, { status: 404 });
    }

    const row = rows[0] || ({} as BrainRow);
    const title = live.title || row.title || row.tracked_title || titleFromSlug(slug);
    // Keyword order of preference: the head query the page already earns
    // impressions for, then the planned keyword, then the slug. A wrong
    // keyword sends the whole generation off target, so GSC wins.
    const keyword = (row.gsc_keyword || row.keyword || slug.replace(/-/g, " ")).trim();
    // collection_slug is the live Shopify handle the brain stores, so it wins.
    // The old fallback was general-wellness, which is not a live collection.
    const category = (row.collection_slug || row.tracked_category || "home-wellness").trim();
    const collection = row.collection || row.tracked_category || "";
    const articleType = row.article_type || undefined;
    const keepImages = (row.revamp_mode || "keep-images") !== "full-regen";

    const origin = request.nextUrl.origin;
    const cookie = request.headers.get("cookie") || "";
    const h = { "Content-Type": "application/json", cookie };
    const get = async (path: string) => {
      const r = await fetch(`${origin}${path}`, { headers: { cookie } });
      return r.ok ? r.json() : null;
    };

    // ── inputs ───────────────────────────────────────────────────────────────
    let products: Record<string, unknown>[] = [];
    const prodSlug = (row.target_subcollection || category) as string;
    const p = await get(
      `/api/products?category=${encodeURIComponent(category)}&collection=${encodeURIComponent(prodSlug)}` +
      `&search=${encodeURIComponent(keyword)}&limit=4` +
      (row.target_brand ? `&brand=${encodeURIComponent(row.target_brand)}` : "")
    );
    if (p?.products) products = p.products;

    let internalLinks: { title: string; url: string; description?: string; planned?: boolean }[] = [];
    let relatedArticles: { title: string; url: string; description: string }[] = [];
    const res = await get(`/api/resources?type=topical-authority&collection=${encodeURIComponent(category)}`);
    if (res?.items) {
      const withUrls = (res.items as { title?: string; existingUrl?: string; metaDescription?: string }[])
        .filter((t) => t.existingUrl && (t.title || "").toLowerCase() !== title.toLowerCase());
      internalLinks = withUrls.slice(0, 15).map((t) => ({ title: t.title || "", url: t.existingUrl || "", description: t.metaDescription || "" }));
      relatedArticles = withUrls.slice(0, 3).map((t) => ({ title: t.title || "", url: t.existingUrl || "", description: t.metaDescription || "" }));
    }
    const cl = await get(`/api/content-brain/cluster-links?collection=${encodeURIComponent(category)}${row.id ? `&exclude=${row.id}` : ""}`);
    if (cl?.links) {
      const have = new Set(internalLinks.map((l) => l.url.replace(/^https?:\/\/(www\.)?greenthumbdepot\.com/i, "").replace(/\/+$/, "").toLowerCase()));
      for (const l of cl.links as { title: string; url: string; description?: string; planned?: boolean }[]) {
        const key = l.url.replace(/\/+$/, "").toLowerCase();
        // Never link an article to itself.
        if (have.has(key) || key.endsWith(`/${slug}`) || (l.title || "").toLowerCase() === title.toLowerCase()) continue;
        have.add(key);
        internalLinks.push({ title: l.title, url: l.url, description: l.description || "", planned: !!l.planned });
      }
      for (const l of (cl.links as { title: string; url: string; description?: string; planned?: boolean }[]).filter((x) => !x.planned)) {
        if (relatedArticles.length >= 3) break;
        if (relatedArticles.some((r) => r.url === l.url) || l.url.replace(/\/+$/, "").toLowerCase().endsWith(`/${slug}`)) continue;
        relatedArticles.push({ title: l.title, url: l.url, description: l.description || "" });
      }
    }
    internalLinks = internalLinks.slice(0, 30);

    // ── generate ─────────────────────────────────────────────────────────────
    const genRes = await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        title, keyword, category, collection, articleType,
        audience: row.audience || "general",
        tone: row.tone || "educational",
        wordCount: Math.max(row.word_count || 2500, 2500),
        includeComparisonTable: ["buyers-guide", "comparison", "brand-review"].includes((articleType || "").toLowerCase()),
        specialInstructions: row.special_instructions || "",
        products: products.map((pr) => {
          const q = pr as Record<string, string>;
          return {
            title: q.title, description: q.description, price: q.price, imageUrl: q.imageUrl,
            url: q.handle ? `https://greenthumbdepot.com/products/${q.handle}` : q.url,
            handle: q.handle, vendor: q.vendor,
          };
        }),
        relatedArticles, internalLinks,
        ultimateGuide: row.ultimate_guide_url ? { url: row.ultimate_guide_url, title: row.ultimate_guide_title || "" } : undefined,
      }),
    });
    const gen = await genRes.json().catch(() => ({}));
    if (!genRes.ok || !gen.content) {
      throw new Error(`generate failed: ${(gen.error || genRes.status).toString().slice(0, 200)}`);
    }

    // ── carry images + dates, then grade ─────────────────────────────────────
    let bodyHtml: string = gen.content;
    let imagesFound = 0;
    let imagesCarried = 0;
    if (keepImages) {
      const imgs = extractLegacyImages(live.body_html, 12);
      imagesFound = imgs.length;
      const merged = insertImagesIntoV2Body(bodyHtml, imgs);
      bodyHtml = merged.bodyHtml;
      imagesCarried = merged.carried;
    }
    bodyHtml = applyUpdatedLine(bodyHtml, live.published_at);
    const grade = gradePostV2(bodyHtml);

    // ── update the live article in place ─────────────────────────────────────
    // The slug and the published date are never sent, so the URL and its
    // history survive. The visible "Updated" line in the body carries the
    // freshness signal instead.
    let shopify: { ok: boolean; error?: string } = { ok: false };
    if (publish) {
      const upRes = await fetch(`${origin}/api/shopify/blog/update`, {
        method: "PUT",
        headers: h,
        body: JSON.stringify({
          shopifyArticleId: live.legacy_id,
          blogId: live.blog_id,
          fields: { body_html: bodyHtml },
        }),
      });
      const up = await upRes.json().catch(() => ({}));
      shopify = upRes.ok ? { ok: true } : { ok: false, error: (up.error || upRes.status).toString().slice(0, 200) };
      if (!shopify.ok) throw new Error(`shopify update failed: ${shopify.error}`);

      await sql`
        UPDATE blog_post_tracking
        SET status = 'revamped', last_shopify_sync_at = NOW(), updated_at = NOW()
        WHERE slug = ${slug}
      `;
      // The post is v2 now, so record WHICH checklist produced this score and
      // reset the v1-era quality markers. Without graded_with the row keeps its
      // old 'v1-checklist' label and the two scales get compared as if they
      // were the same number.
      await sql`
        UPDATE content_health
        SET grade = ${grade.score},
            voice_score = ${grade.voiceScore},
            grade_failures = ${grade.failures.join(",")},
            graded_with = 'v2-checklist',
            era = 'v2',
            em_dashes = 0,
            ai_tells = 0,
            old_faq = false,
            content_images = ${imagesCarried},
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE slug = ${slug}
      `;
    }

    return NextResponse.json({
      ok: true,
      slug,
      title,
      keyword,
      published: publish,
      articleId: live.legacy_id,
      imagesFound,
      imagesCarried,
      grade: grade.score,
      failures: grade.failures,
      words: grade.wordCount,
      seconds: Math.round((Date.now() - started) / 1000),
      bodyHtml: publish ? undefined : bodyHtml,
    });
  } catch (error) {
    reportError(error, { route: "//api/revamp/run-one", method: "POST" });
    console.error("[revamp/run-one]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Revamp failed", seconds: Math.round((Date.now() - started) / 1000) },
      { status: 500 }
    );
  }
}
