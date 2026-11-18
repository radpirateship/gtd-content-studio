// POST /api/content-brain/recategorize
// Re-derive each published article's hub/collection from its REAL Shopify tags
// (not the title), fixing miscategorized rows. Matches tags against the master
// collection list; the hub comes from the matched collection.
//
// GET = dry-run preview (first 30 rows: title, tags, computed category).
import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import { MASTER_COLLECTIONS, COLLECTION_TO_CATEGORY } from "@/lib/collections";

export const maxDuration = 120;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];
let cachedVersion: string | null = null;

type Coll = { slug: string; label: string; shopifyHandle: string; hub: string };

// One normalized lookup: label, slug, handle, and every alias in
// COLLECTION_TO_CATEGORY → the matching master collection. Normalization
// lowercases and strips spaces/_/- so "Massage Guns", "massage-guns",
// "massage_guns" all resolve to the same collection.
const norm = (s: string) => (s || "").toLowerCase().replace(/[\s_-]+/g, "");
const COLL_BY_SLUG = new Map<string, Coll>((MASTER_COLLECTIONS as Coll[]).map((c) => [c.slug, c]));
const TAG_TO_COLL = new Map<string, Coll>();
for (const c of MASTER_COLLECTIONS as Coll[]) {
  TAG_TO_COLL.set(norm(c.label), c);
  TAG_TO_COLL.set(norm(c.slug), c);
  TAG_TO_COLL.set(norm(c.shopifyHandle), c);
}
for (const [alias, slug] of Object.entries(COLLECTION_TO_CATEGORY)) {
  const c = COLL_BY_SLUG.get(slug);
  if (c) TAG_TO_COLL.set(norm(alias), c);
}
const HUB_TAGS = new Set(["saunas", "recovery", "wellness", "cardio", "fitness"]);

function categorize(tagsStr: string): { hub: string | null; collection: string | null; collection_slug: string | null } {
  const tags = (tagsStr || "").split(",").map((t) => t.trim()).filter(Boolean);
  // 1) prefer a specific collection tag — matched against label/slug/handle/alias
  for (const t of tags) {
    const m = TAG_TO_COLL.get(norm(t));
    if (m) return { hub: m.hub, collection: m.label, collection_slug: m.shopifyHandle };
  }
  // 2) fall back to a hub-level tag (e.g. "Recovery", "Wellness")
  for (const t of tags) {
    if (HUB_TAGS.has(t.toLowerCase())) {
      return { hub: t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(), collection: null, collection_slug: null };
    }
  }
  return { hub: null, collection: null, collection_slug: null };
}

type Article = { id: number; title: string; handle: string; tags: string | null };
type Blog = { id: number; handle: string };

async function resolveVersion(token: string): Promise<string> {
  if (cachedVersion) return cachedVersion;
  for (const v of API_VERSIONS) {
    const r = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs.json?limit=1`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (r.ok) { cachedVersion = v; return v; }
    if (r.status === 401 || r.status === 403) throw new Error(`Shopify auth failed (${r.status})`);
  }
  throw new Error("No working Shopify Admin API version");
}

function nextPageInfo(link: string | null): string | null {
  if (!link) return null;
  const n = link.split(",").find((p) => p.includes('rel="next"'));
  const u = n?.match(/<([^>]+)>/)?.[1];
  try { return u ? new URL(u).searchParams.get("page_info") : null; } catch { return null; }
}

async function fetchAllArticles(): Promise<Article[]> {
  const token = await getShopifyAccessToken();
  const version = await resolveVersion(token);
  const base = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}`;
  const headers = { "X-Shopify-Access-Token": token };
  const blogs: Blog[] = ((await (await fetch(`${base}/blogs.json?limit=250`, { headers })).json()).blogs) || [];
  const out: Article[] = [];
  for (const blog of blogs) {
    let page: string | null = null;
    do {
      const q = page ? `limit=250&page_info=${encodeURIComponent(page)}` : `limit=250`;
      const res = await fetch(`${base}/blogs/${blog.id}/articles.json?${q}`, { headers });
      if (!res.ok) break;
      const data = await res.json();
      for (const a of (data.articles || []) as Article[]) out.push(a);
      page = nextPageInfo(res.headers.get("link"));
    } while (page);
  }
  return out;
}

export async function GET() {
  try {
    const articles = await fetchAllArticles();
    const preview = articles.slice(0, 30).map((a) => ({
      title: (a.title || "").slice(0, 50),
      tags: a.tags,
      ...categorize(a.tags || ""),
    }));
    const uncategorized = articles.filter((a) => !categorize(a.tags || "").hub).length;

    // Histogram of tags that match NEITHER a collection NOR a hub — these are
    // the categories still missing from MASTER_COLLECTIONS. Articles with no
    // matched collection (hub-only or fully uncategorized) drive the gaps.
    const unmatchedTagCounts: Record<string, number> = {};
    let hubOnly = 0;
    for (const a of articles) {
      const cat = categorize(a.tags || "");
      if (!cat.collection_slug && cat.hub) hubOnly++;
      const tags = (a.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      for (const t of tags) {
        const isColl = !!TAG_TO_COLL.get(norm(t));
        const isHub = HUB_TAGS.has(t.toLowerCase());
        const isMeta = /^(how-to|buyers-guide|guide|review|comparison|listicle|how to)$/i.test(t);
        if (!isColl && !isHub && !isMeta) unmatchedTagCounts[t] = (unmatchedTagCounts[t] || 0) + 1;
      }
    }
    const unmatchedTags = Object.entries(unmatchedTagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));

    return NextResponse.json({
      mode: "dry-run",
      totalArticles: articles.length,
      uncategorized,
      hubOnlyNoCollection: hubOnly,
      unmatchedTags,
      preview,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "preview failed" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const sql = getSQL();
    // Ensure every column we write exists (idempotent).
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS tags TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS hub TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS cluster_group TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS collection TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS collection_slug TEXT`;
    const articles = await fetchAllArticles();
    let updated = 0;
    let uncategorized = 0;
    for (const a of articles) {
      const cat = categorize(a.tags || "");
      if (!cat.hub) uncategorized++;
      await sql`
        UPDATE content_brain SET
          hub = ${cat.hub},
          cluster_group = ${cat.collection},
          collection = ${cat.collection},
          collection_slug = ${cat.collection_slug},
          tags = ${a.tags || null},
          updated_at = NOW()
        WHERE shopify_article_id = ${String(a.id)}
      `;
      updated++;
    }
    return NextResponse.json({
      ok: true,
      articles: articles.length,
      updated,
      uncategorized,
      message: `Recategorized ${updated} articles from Shopify tags (${uncategorized} had no matching category tag).`,
    });
  } catch (err) {
    console.error("[content-brain/recategorize]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "recategorize failed" }, { status: 500 });
  }
}
