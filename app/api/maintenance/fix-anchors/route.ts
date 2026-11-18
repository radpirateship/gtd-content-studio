import { type NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import { getSQL } from "@/lib/db";
import { buildFix } from "@/lib/fix-anchors";

/**
 * POST /api/maintenance/fix-anchors
 *
 * Bulk-fixes legacy descriptive H2 anchor IDs (both id="1-product-name" and
 * id="descriptive-heading-slug") that Google AI Mode indexes as separate
 * zero-CTR SERP entries. Replaces them with sequential id="section-N" anchors
 * and rewrites the matching TOC href="#..." links in the same pass so
 * navigation never desyncs. See lib/fix-anchors.ts.
 *
 * Body: {
 *   mode: "dry" | "apply",   // dry = report only, zero writes (default)
 *   handles?: string[],      // apply only these article handles (empty = all affected)
 *   batchSize?: number       // articles updated per invocation (default 15, max 30)
 * }
 *
 * Apply mode processes one batch per call and returns { remaining } so the
 * client loops until done — keeps each invocation well under maxDuration.
 */

export const maxDuration = 60;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];

let cachedVersion: string | null = null;

async function resolveVersion(token: string): Promise<string> {
  if (cachedVersion) return cachedVersion;
  for (const v of API_VERSIONS) {
    const res = await fetch(
      `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs.json?limit=1`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (res.ok) {
      cachedVersion = v;
      return v;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Shopify auth failed (${res.status}) — check the Admin token`);
    }
  }
  throw new Error("No working Shopify Admin API version found");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function adminRequest(path: string, init: RequestInit = {}) {
  const token = await getShopifyAccessToken();
  const version = await resolveVersion(token);
  const url = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
        ...init.headers,
      },
    });

    if (res.status === 429) {
      // Rate limited — honor Retry-After (Shopify sends it in seconds).
      const retryAfter = Number(res.headers.get("retry-after")) || 2;
      console.warn(`[fix-anchors] 429 rate limited on ${path}, waiting ${retryAfter}s (attempt ${attempt}/4)`);
      await sleep(retryAfter * 1000 + 250);
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopify ${init.method || "GET"} ${path} failed (${res.status}): ${body.slice(0, 200)}`);
    }
    return { json: await res.json(), link: res.headers.get("link") };
  }
  throw new Error(`Shopify ${init.method || "GET"} ${path}: still rate limited after 4 attempts`);
}

function nextPageInfo(link: string | null): string | null {
  if (!link) return null;
  const next = link.split(",").find((p) => p.includes('rel="next"'));
  const url = next?.match(/<([^>]+)>/)?.[1];
  try {
    return url ? new URL(url).searchParams.get("page_info") : null;
  } catch {
    return null;
  }
}

type AffectedArticle = {
  blogId: number;
  blogHandle: string;
  articleId: number;
  title: string;
  handle: string;
  replacements: number;
  brokenLinks: number;
  mapping: Record<string, string>;
};

async function scanAllArticles(): Promise<{ scanned: number; affected: AffectedArticle[] }> {
  const { json: blogsJson } = await adminRequest("blogs.json?limit=250");
  const blogs: { id: number; handle: string }[] = blogsJson.blogs || [];

  let scanned = 0;
  const affected: AffectedArticle[] = [];

  for (const blog of blogs) {
    let pageInfo: string | null = null;
    do {
      const qs: string = pageInfo
        ? `limit=250&page_info=${encodeURIComponent(pageInfo)}`
        : "limit=250";
      const { json, link } = await adminRequest(`blogs/${blog.id}/articles.json?${qs}`);
      const articles: { id: number; title: string; handle: string; body_html: string | null }[] =
        json.articles || [];
      for (const a of articles) {
        scanned++;
        const fix = buildFix(a.body_html || "");
        if (fix) {
          affected.push({
            blogId: blog.id,
            blogHandle: blog.handle,
            articleId: a.id,
            title: a.title,
            handle: a.handle,
            replacements: fix.replacements,
            brokenLinks: fix.brokenLinks,
            mapping: fix.mapping,
          });
        }
      }
      pageInfo = nextPageInfo(link);
      if (pageInfo) await sleep(600);
    } while (pageInfo);
  }

  return { scanned, affected };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode: "dry" | "apply" = body.mode === "apply" ? "apply" : "dry";
    const onlyHandles: string[] = Array.isArray(body.handles) ? body.handles : [];
    const batchSize: number = Math.min(Math.max(Number(body.batchSize) || 10, 1), 20);

    const { scanned, affected } = await scanAllArticles();

    if (mode === "dry") {
      return NextResponse.json({
        mode,
        scanned,
        affectedCount: affected.length,
        totalReplacements: affected.reduce((s, a) => s + a.replacements, 0),
        items: affected,
      });
    }

    // Apply mode
    const targets = onlyHandles.length
      ? affected.filter((a) => onlyHandles.includes(a.handle))
      : affected;
    const batch = targets.slice(0, batchSize);
    const remaining = targets.slice(batchSize).map((a) => a.handle);

    const sql = getSQL();
    const processed: {
      handle: string;
      title: string;
      replacements: number;
      ok: boolean;
      error?: string;
      dbSynced: boolean;
    }[] = [];

    for (const target of batch) {
      try {
        // Re-fetch fresh body right before writing (scan data could be stale).
        const { json } = await adminRequest(`blogs/${target.blogId}/articles/${target.articleId}.json`);
        await sleep(600);
        const fresh: string = json.article?.body_html || "";
        const fix = buildFix(fresh);
        if (!fix) {
          processed.push({ handle: target.handle, title: target.title, replacements: 0, ok: true, dbSynced: false });
          continue;
        }

        await adminRequest(`blogs/${target.blogId}/articles/${target.articleId}.json`, {
          method: "PUT",
          body: JSON.stringify({ article: { id: target.articleId, body_html: fix.fixed } }),
        });

        // Keep the Content Studio DB copy in sync (best-effort).
        let dbSynced = false;
        try {
          await sql`
            UPDATE articles
            SET html_content = ${fix.fixed}, updated_at = NOW()
            WHERE slug = ${target.handle}
          `;
          dbSynced = true;
        } catch (dbErr) {
          console.error(`[fix-anchors] DB sync failed for ${target.handle} (Shopify already updated):`, dbErr);
        }

        console.log(`[fix-anchors] Updated "${target.title}" (${target.handle}): ${fix.replacements} tokens replaced`);
        processed.push({ handle: target.handle, title: target.title, replacements: fix.replacements, ok: true, dbSynced });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[fix-anchors] FAILED ${target.handle}: ${msg}`);
        processed.push({ handle: target.handle, title: target.title, replacements: 0, ok: false, error: msg, dbSynced: false });
      }
      // Each article costs a GET + PUT. With the 600ms pause after the GET and
      // this one after the PUT, the sustained rate stays near 1.2 req/s, well
      // under Shopify's 2 req/s leak rate.
      await sleep(1000);
    }

    return NextResponse.json({
      mode,
      scanned,
      processed,
      remaining,
      done: remaining.length === 0,
    });
  } catch (error) {
    console.error("[fix-anchors] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "fix-anchors failed" },
      { status: 500 }
    );
  }
}
