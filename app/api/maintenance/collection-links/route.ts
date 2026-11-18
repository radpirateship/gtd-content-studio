import { NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import { auditCollectionLinks, injectCollectionLinks, deriveCategoryFromTags } from "@/lib/collection-links";
import { COLLECTION_DISPLAY_TAGS } from "@/lib/tagMapping";
import { getSQL } from "@/lib/db";

/**
 * POST /api/maintenance/collection-links
 *
 * Audit AND bulk-fix in-content collection links, without any AI rewriting —
 * the injector only wraps existing keyword mentions or adds one short sentence,
 * so ranking articles keep their prose.
 *
 * Body: {
 *   mode: "dry" | "apply",   // dry = audit + proposed links, zero writes (default)
 *   handles?: string[],      // apply only these handles (empty = all with proposals)
 *   batchSize?: number       // default 10, max 20
 * }
 */

export const maxDuration = 60;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];

let cachedVersion: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      const retryAfter = Number(res.headers.get("retry-after")) || 2;
      console.warn(`[collection-links] 429 on ${path}, waiting ${retryAfter}s (attempt ${attempt}/4)`);
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


type ScanRow = {
  blogId: number;
  articleId: number;
  handle: string;
  blogHandle: string;
  title: string;
  tags: string;
  published: boolean;
  category: string | null;
  inContentCount: number;
  inContentLinks: { href: string; text: string }[];
  hasBottomCta: boolean;
  finnmarkLinks: string[];
  /** Links the injector would add (dry preview / apply plan). */
  proposed: { handle: string; anchor: string; method: string }[];
};

async function scanAll(): Promise<{ scanned: number; rows: ScanRow[] }> {
  const { json: blogsJson } = await adminRequest("blogs.json?limit=250");
  const blogs: { id: number; handle: string }[] = blogsJson.blogs || [];
  let scanned = 0;
  const rows: ScanRow[] = [];

  for (const blog of blogs) {
    let pageInfo: string | null = null;
    do {
      const qs: string = pageInfo
        ? `limit=250&page_info=${encodeURIComponent(pageInfo)}`
        : "limit=250";
      const { json, link } = await adminRequest(`blogs/${blog.id}/articles.json?${qs}`);
      const articles: {
        id: number;
        title: string;
        handle: string;
        tags: string | null;
        body_html: string | null;
        published_at: string | null;
      }[] = json.articles || [];
      for (const a of articles) {
        scanned++;
        const body = a.body_html || "";
        const audit = auditCollectionLinks(body);
        const category = deriveCategoryFromTags(a.tags || "");
        let proposed: ScanRow["proposed"] = [];
        if (audit.inContent.length < 2 && category) {
          const preview = injectCollectionLinks(body, {
            category,
            keyword: a.title,
            title: a.title,
            seed: a.handle,
          });
          proposed = preview.added;
        }
        rows.push({
          blogId: blog.id,
          articleId: a.id,
          handle: a.handle,
          blogHandle: blog.handle,
          title: a.title,
          tags: a.tags || "",
          published: !!a.published_at,
          category,
          inContentCount: audit.inContent.length,
          inContentLinks: audit.inContent.map(({ href, text }) => ({ href, text })),
          hasBottomCta: audit.ctaButtons > 0,
          finnmarkLinks: audit.finnmarkLinks,
          proposed,
        });
      }
      pageInfo = nextPageInfo(link);
      if (pageInfo) await sleep(600);
    } while (pageInfo);
  }
  return { scanned, rows };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode: "dry" | "apply" = body.mode === "apply" ? "apply" : "dry";
    const onlyHandles: string[] = Array.isArray(body.handles) ? body.handles : [];
    const batchSize: number = Math.min(Math.max(Number(body.batchSize) || 10, 1), 20);

    const { scanned, rows } = await scanAll();

    if (mode === "dry") {
      const pub = rows.filter((r) => r.published);
      return NextResponse.json({
        mode,
        scanned,
        summary: {
          zeroInContent: pub.filter((r) => r.inContentCount === 0).length,
          oneInContent: pub.filter((r) => r.inContentCount === 1).length,
          compliant: pub.filter((r) => r.inContentCount >= 2).length,
          missingBottomCta: pub.filter((r) => !r.hasBottomCta).length,
          withFinnmark: pub.filter((r) => r.finnmarkLinks.length > 0).length,
          noCategory: pub.filter((r) => r.inContentCount < 2 && !r.category).length,
          fixable: pub.filter((r) => r.proposed.length > 0).length,
        },
        rows: rows.map(({ blogId, articleId, ...rest }) => rest),
      });
    }

    // Apply: published posts with proposals; restricted to handles when given.
    const targets = rows.filter(
      (r) =>
        r.published &&
        r.proposed.length > 0 &&
        (onlyHandles.length === 0 || onlyHandles.includes(r.handle))
    );
    const batch = targets.slice(0, batchSize);
    const remaining = targets.slice(batchSize).map((r) => r.handle);

    const sql = getSQL();
    const processed: { handle: string; title: string; added: string[]; ok: boolean; error?: string }[] = [];

    for (const t of batch) {
      try {
        // Fresh body immediately before writing.
        const { json } = await adminRequest(`blogs/${t.blogId}/articles/${t.articleId}.json`);
        await sleep(600);
        const fresh: string = json.article?.body_html || "";
        const result = injectCollectionLinks(fresh, {
          category: t.category as string,
          keyword: t.title,
          title: t.title,
          seed: t.handle,
        });
        if (result.added.length === 0) {
          processed.push({ handle: t.handle, title: t.title, added: [], ok: true });
          continue;
        }
        await adminRequest(`blogs/${t.blogId}/articles/${t.articleId}.json`, {
          method: "PUT",
          body: JSON.stringify({ article: { id: t.articleId, body_html: result.html } }),
        });
        try {
          await sql`UPDATE articles SET html_content = ${result.html}, updated_at = NOW() WHERE slug = ${t.handle}`;
        } catch (dbErr) {
          console.error(`[collection-links] DB sync failed for ${t.handle}:`, dbErr);
        }
        console.log(`[collection-links] ${t.handle}: added ${result.added.map((a) => a.handle).join(", ")}`);
        processed.push({ handle: t.handle, title: t.title, added: result.added.map((a) => `${a.handle} (${a.method})`), ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[collection-links] FAILED ${t.handle}: ${msg}`);
        processed.push({ handle: t.handle, title: t.title, added: [], ok: false, error: msg });
      }
      await sleep(1000);
    }

    return NextResponse.json({ mode, processed, remaining, done: remaining.length === 0 });
  } catch (error) {
    console.error("[collection-links] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "collection-links failed" },
      { status: 500 }
    );
  }
}
