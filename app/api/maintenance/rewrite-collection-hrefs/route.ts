// app/api/maintenance/rewrite-collection-hrefs/route.ts
//
// POST /api/maintenance/rewrite-collection-hrefs
//
// Repoints in-article links that target retired collection URLs so they go
// straight to the live destination instead of through the 301. Only href
// values change; anchor text and prose are untouched. Mirrors
// /api/maintenance/fix-anchors: dry run scans every article and reports,
// apply rewrites one batch per call and returns { remaining } so the client
// loops, and the Content Studio DB copy is kept in sync best-effort.
//
// Body: {
//   mode: "dry" | "apply",            // default dry (zero writes)
//   map?: Record<string, string>,     // old handle -> new handle; defaults to
//                                     // RETIRED_COLLECTION_REDIRECTS
//   handles?: string[],               // apply only these article handles
//   batchSize?: number                // default 10, max 20
// }
import { type NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import { getSQL } from "@/lib/db";
import { buildHrefRewrite, RETIRED_COLLECTION_REDIRECTS } from "@/lib/collection-href-rewrite";

export const maxDuration = 60;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];
let cachedVersion: string | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolveVersion(token: string): Promise<string> {
  if (cachedVersion) return cachedVersion;
  for (const v of API_VERSIONS) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs.json?limit=1`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (res.ok) {
      cachedVersion = v;
      return v;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Shopify auth failed (${res.status})`);
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
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token, ...init.headers },
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2;
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

type Affected = {
  blogId: number;
  blogHandle: string;
  articleId: number;
  title: string;
  handle: string;
  published: boolean;
  replacements: number;
  byHandle: Record<string, number>;
};

function normaliseMap(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : RETIRED_COLLECTION_REDIRECTS;
  for (const [k, v] of Object.entries(src)) {
    const from = String(k).trim().toLowerCase().replace(/^\/?collections\//, "").replace(/\/$/, "");
    const to = String(v ?? "").trim().toLowerCase().replace(/^\/?collections\//, "").replace(/\/$/, "");
    if (from && to && from !== to) out[from] = to;
  }
  return out;
}

async function scanAllArticles(map: Record<string, string>): Promise<{ scanned: number; affected: Affected[] }> {
  const { json: blogsJson } = await adminRequest("blogs.json?limit=250");
  const blogs: { id: number; handle: string }[] = blogsJson.blogs || [];
  let scanned = 0;
  const affected: Affected[] = [];
  for (const blog of blogs) {
    let pageInfo: string | null = null;
    do {
      const qs: string = pageInfo ? `limit=250&page_info=${encodeURIComponent(pageInfo)}` : "limit=250";
      const { json, link } = await adminRequest(`blogs/${blog.id}/articles.json?${qs}`);
      const articles: { id: number; title: string; handle: string; body_html: string | null; published_at: string | null }[] = json.articles || [];
      for (const a of articles) {
        scanned++;
        const fix = buildHrefRewrite(a.body_html || "", map);
        if (fix) {
          affected.push({
            blogId: blog.id,
            blogHandle: blog.handle,
            articleId: a.id,
            title: a.title,
            handle: a.handle,
            published: a.published_at != null,
            replacements: fix.replacements,
            byHandle: fix.byHandle,
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
    const map = normaliseMap(body.map);
    const onlyHandles: string[] = Array.isArray(body.handles) ? body.handles : [];
    const batchSize: number = Math.min(Math.max(Number(body.batchSize) || 10, 1), 20);

    if (Object.keys(map).length === 0) {
      return NextResponse.json({ error: "map is empty: give at least one old -> new handle pair" }, { status: 400 });
    }
    // Refuse chains: a destination that is itself a source would leave a hop.
    const chained = Object.values(map).filter((v) => v in map);
    if (chained.length) {
      return NextResponse.json({ error: `destination(s) also listed as sources (would chain): ${chained.join(", ")}` }, { status: 400 });
    }

    const { scanned, affected } = await scanAllArticles(map);
    const totalsByHandle: Record<string, number> = {};
    for (const a of affected) for (const [h, n] of Object.entries(a.byHandle)) totalsByHandle[h] = (totalsByHandle[h] || 0) + n;

    if (mode === "dry") {
      return NextResponse.json({
        mode,
        scanned,
        affectedCount: affected.length,
        totalReplacements: affected.reduce((s, a) => s + a.replacements, 0),
        totalsByHandle,
        map,
        items: affected,
      });
    }

    const targets = onlyHandles.length ? affected.filter((a) => onlyHandles.includes(a.handle)) : affected;
    const batch = targets.slice(0, batchSize);
    const remaining = targets.slice(batchSize).map((a) => a.handle);

    const sql = getSQL();
    const processed: { handle: string; title: string; replacements: number; ok: boolean; error?: string; dbSynced: boolean }[] = [];

    for (const target of batch) {
      try {
        const { json } = await adminRequest(`blogs/${target.blogId}/articles/${target.articleId}.json`);
        await sleep(600);
        const fresh: string = json.article?.body_html || "";
        const fix = buildHrefRewrite(fresh, map);
        if (!fix) {
          processed.push({ handle: target.handle, title: target.title, replacements: 0, ok: true, dbSynced: false });
          continue;
        }
        await adminRequest(`blogs/${target.blogId}/articles/${target.articleId}.json`, {
          method: "PUT",
          body: JSON.stringify({ article: { id: target.articleId, body_html: fix.fixed } }),
        });
        let dbSynced = false;
        try {
          await sql`UPDATE articles SET html_content = ${fix.fixed}, updated_at = NOW() WHERE slug = ${target.handle}`;
          dbSynced = true;
        } catch (dbErr) {
          console.error(`[rewrite-collection-hrefs] DB sync failed for ${target.handle} (Shopify already updated):`, dbErr);
        }
        console.log(`[rewrite-collection-hrefs] Updated "${target.title}" (${target.handle}): ${fix.replacements} href(s)`);
        processed.push({ handle: target.handle, title: target.title, replacements: fix.replacements, ok: true, dbSynced });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[rewrite-collection-hrefs] FAILED ${target.handle}: ${msg}`);
        processed.push({ handle: target.handle, title: target.title, replacements: 0, ok: false, error: msg, dbSynced: false });
      }
      await sleep(1000);
    }

    return NextResponse.json({ mode, scanned, processed, remaining, done: remaining.length === 0 });
  } catch (error) {
    console.error("[rewrite-collection-hrefs] Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "rewrite failed" }, { status: 500 });
  }
}
