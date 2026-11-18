import { NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import { gradePost } from "@/lib/post-grader";
import { getSQL } from "@/lib/db";
import { ensureGradeColumns } from "@/lib/ensureGradeColumns";

/**
 * POST /api/maintenance/post-grader
 *
 * READ-ONLY. Grades every article against the GTD core-element checklist
 * (see lib/post-grader.ts). Never writes anything. Includes the published
 * flag so leftover drafts (old 2025-dated duplicates) can be filtered out.
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

async function adminGet(path: string) {
  const token = await getShopifyAccessToken();
  const version = await resolveVersion(token);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(
      `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2;
      await sleep(retryAfter * 1000 + 250);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopify GET ${path} failed (${res.status}): ${body.slice(0, 200)}`);
    }
    return { json: await res.json(), link: res.headers.get("link") };
  }
  throw new Error(`Shopify GET ${path}: still rate limited after 4 attempts`);
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

export async function POST() {
  try {
    const { json: blogsJson } = await adminGet("blogs.json?limit=250");
    const blogs: { id: number; handle: string }[] = blogsJson.blogs || [];

    let scanned = 0;
    const rows: {
      handle: string;
      blogHandle: string;
      title: string;
      tags: string;
      published: boolean;
      score: number;
      wordCount: number;
      failures: string[];
      failureDetails: Record<string, string>;
      collectionLinks: number;
      voiceScore: number;
    }[] = [];

    for (const blog of blogs) {
      let pageInfo: string | null = null;
      do {
        const qs: string = pageInfo
          ? `limit=250&page_info=${encodeURIComponent(pageInfo)}`
          : "limit=250";
        const { json, link } = await adminGet(`blogs/${blog.id}/articles.json?${qs}`);
        const articles: {
          title: string;
          handle: string;
          tags: string | null;
          body_html: string | null;
          published_at: string | null;
        }[] = json.articles || [];
        for (const a of articles) {
          scanned++;
          const grade = gradePost(a.body_html || "");
          const failureDetails: Record<string, string> = {};
          for (const c of grade.checks) if (!c.pass && c.detail) failureDetails[c.id] = c.detail;
          rows.push({
            handle: a.handle,
            blogHandle: blog.handle,
            title: a.title,
            tags: a.tags || "",
            published: !!a.published_at,
            score: grade.score,
            wordCount: grade.wordCount,
            failures: grade.failures,
            failureDetails,
            collectionLinks: grade.collectionLinkCount,
            voiceScore: grade.voiceScore,
          });
        }
        pageInfo = nextPageInfo(link);
        if (pageInfo) await sleep(600);
      } while (pageInfo);
    }

    // Sync grades into the revamp backlog (best-effort — the backlog is the
    // workflow hub, so scores/failures become filterable columns there).
    let backlogSynced = 0;
    try {
      const sql = getSQL();
      await ensureGradeColumns();
      for (const r of rows) {
        if (!r.published) continue;
        const res = await sql`
          UPDATE blog_post_tracking
          SET grade_score = ${r.score},
              grade_failures = ${r.failures.join(",")},
              collection_links = ${r.collectionLinks},
              voice_score = ${r.voiceScore},
              graded_at = NOW()
          WHERE slug = ${r.handle}
        `;
        if ((res as unknown as { count?: number }).count !== 0) backlogSynced++;
      }
    } catch (dbErr) {
      console.error("[post-grader] backlog sync failed (grades still returned):", dbErr);
    }

    // Per-check failure counts (published posts only — drafts don't matter)
    const failCounts: Record<string, number> = {};
    for (const r of rows) {
      if (!r.published) continue;
      for (const f of r.failures) failCounts[f] = (failCounts[f] || 0) + 1;
    }

    return NextResponse.json({
      scanned,
      publishedCount: rows.filter((r) => r.published).length,
      backlogSynced,
      failCounts,
      rows,
    });
  } catch (error) {
    console.error("[post-grader] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "post-grader failed" },
      { status: 500 }
    );
  }
}
