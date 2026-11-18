// Admin-API blog reads (uses the app's shpat_ Admin token), as a drop-in for the
// Storefront-based readers. The Admin token is provisioned at install, so these
// need no Storefront access token or unauthenticated scopes.
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];

type RestArticle = {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  summary_html: string | null;
  tags: string | null;
  author: string | null;
  published_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  image?: { src?: string; alt?: string | null } | null;
};

type RestBlog = { id: number; handle: string; title: string };

// Normalized shape matching what the Storefront readers returned to callers.
export type AdminArticleResult = {
  id: string;
  legacy_id: number;
  title: string;
  handle: string;
  body_html: string;
  tags: string;
  summary_html: string | null;
  author: string | null;
  published_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  image: { src: string; alt: string } | null;
  metafields: unknown[];
  blog_id: number;
  blog_handle: string;
  blog_title: string;
  online_store_url: string;
};

let cachedVersion: string | null = null;

async function getVersion(token: string): Promise<string> {
  if (cachedVersion) return cachedVersion;
  for (const v of API_VERSIONS) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs.json?limit=1`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (res.ok) {
      cachedVersion = v;
      return v;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Shopify auth failed (${res.status}) — check SHOPIFY_ACCESS_TOKEN`);
    }
  }
  throw new Error("No working Shopify Admin API version found");
}

async function adminGet(path: string) {
  const token = await getShopifyAccessToken();
  const version = await getVersion(token);
  const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!res.ok) return { ok: false as const, status: res.status, json: null, link: null };
  return { ok: true as const, status: res.status, json: await res.json(), link: res.headers.get("link") };
}

async function listBlogs(): Promise<RestBlog[]> {
  const r = await adminGet("blogs.json?limit=250");
  return r.ok ? (r.json.blogs || []) : [];
}

/** Pull the next page_info cursor out of a Shopify Link header. */
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

// ── PUBLISHED ARTICLE PATHS ─────────────────────────────────────────────────
// Shopify is the only authority on what is actually live. The content_brain and
// topical_authority tables both carry URLs that were planned rather than
// published — /blogs/guides/tips-for-beginners-using-cold-plunges sat in the
// link inventory with status 'live' and 404s on the site. Anything offered to
// the article generator as a link target gets checked against this set first.

let publishedPathCache: { at: number; paths: Set<string> } | null = null;
const PUBLISHED_TTL_MS = 10 * 60 * 1000;

/**
 * Every published article as a root-relative, lowercased path
 * ("/blogs/guides/cold-plunge-and-meditation"). Drafts and unpublished
 * articles are excluded. Cached for ten minutes; a warm lambda pays nothing.
 * Returns an EMPTY set on failure so callers can tell "nothing is published"
 * (never true in practice) apart from "the check did not run".
 */
export async function listPublishedArticlePaths(force = false): Promise<Set<string>> {
  if (!force && publishedPathCache && Date.now() - publishedPathCache.at < PUBLISHED_TTL_MS) {
    return publishedPathCache.paths;
  }

  const paths = new Set<string>();
  for (const blog of await listBlogs()) {
    let pageInfo: string | null = null;
    do {
      const qs: string = pageInfo
        ? `limit=250&page_info=${encodeURIComponent(pageInfo)}`
        : `limit=250`;
      const r = await adminGet(`blogs/${blog.id}/articles.json?${qs}`);
      if (!r.ok) break;
      for (const a of (r.json.articles || []) as RestArticle[]) {
        if (!a.published_at) continue;
        paths.add(`/blogs/${blog.handle}/${a.handle}`.toLowerCase());
      }
      pageInfo = nextPageInfo(r.link);
    } while (pageInfo);
  }

  if (paths.size) publishedPathCache = { at: Date.now(), paths };
  return paths;
}

function normalize(a: RestArticle, blog: RestBlog): AdminArticleResult {
  return {
    id: String(a.id),
    legacy_id: a.id,
    title: a.title,
    handle: a.handle,
    body_html: a.body_html || "",
    tags: a.tags || "",
    summary_html: a.summary_html || null,
    author: a.author || null,
    published_at: a.published_at,
    updated_at: a.updated_at,
    created_at: a.created_at,
    image: a.image?.src ? { src: a.image.src, alt: a.image.alt || a.title } : null,
    metafields: [],
    blog_id: blog.id,
    blog_handle: blog.handle,
    blog_title: blog.title,
    online_store_url: `https://greenthumbdepot.com/blogs/${blog.handle}/${a.handle}`,
  };
}

export async function fetchAdminArticleByHandle(handle: string): Promise<AdminArticleResult | null> {
  if (!handle) return null;
  for (const blog of await listBlogs()) {
    const r = await adminGet(`blogs/${blog.id}/articles.json?handle=${encodeURIComponent(handle)}&limit=1`);
    const article: RestArticle | undefined = r.ok ? r.json.articles?.[0] : undefined;
    if (article) return normalize(article, blog);
  }
  return null;
}

export async function fetchAdminArticleById(id: string): Promise<AdminArticleResult | null> {
  for (const blog of await listBlogs()) {
    const r = await adminGet(`blogs/${blog.id}/articles/${id}.json`);
    const article: RestArticle | undefined = r.ok ? r.json.article : undefined;
    if (article) return normalize(article, blog);
  }
  return null;
}

// Admin REST has no full-text article search, so fetch + filter in-memory.
export async function searchAdminArticles({
  query,
  tag,
  limit = 50,
}: {
  query?: string | null;
  tag?: string | null;
  limit?: number;
}): Promise<AdminArticleResult[]> {
  const q = (query || "").toLowerCase().trim();
  const t = (tag || "").toLowerCase().trim();
  const out: AdminArticleResult[] = [];

  for (const blog of await listBlogs()) {
    let pageInfo: string | null = null;
    do {
      const qs = pageInfo ? `limit=250&page_info=${encodeURIComponent(pageInfo)}` : `limit=250`;
      const r = await adminGet(`blogs/${blog.id}/articles.json?${qs}`);
      if (!r.ok) break;
      const articles: RestArticle[] = r.json.articles || [];
      for (const a of articles) {
        const tags = (a.tags || "").toLowerCase();
        const matchesQ = !q || a.title.toLowerCase().includes(q) || a.handle.toLowerCase().includes(q) || tags.includes(q);
        const matchesT = !t || tags.split(",").map((x) => x.trim()).includes(t);
        if (matchesQ && matchesT) out.push(normalize(a, blog));
        if (out.length >= limit) return out;
      }
      pageInfo = nextPageInfo(r.link);
    } while (pageInfo);
  }
  return out;
}
