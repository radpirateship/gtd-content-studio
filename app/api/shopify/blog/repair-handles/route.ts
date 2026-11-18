/**
 * GET  /api/shopify/blog/repair-handles            — report only, changes nothing
 * POST /api/shopify/blog/repair-handles            — { dryRun?: boolean }  (dryRun defaults to TRUE)
 *
 * Repairs live blog articles whose handle carries a 13-digit millisecond epoch,
 * e.g. /blogs/wellness/home-gym-essentials-...-1787401458275.
 *
 * Those handles are residue from an old /api/articles collision bug that
 * appended Date.now() whenever a new slug PREFIX-matched an existing row. The
 * bug is fixed and the publish route now strips the suffix, but URLs that
 * already went live need repairing by hand, and Search Console indexed several
 * of them, so a 404 throws away the only version Google had.
 *
 * Two outcomes, decided per article, never guessed:
 *
 *   RENAME  the clean handle is free  ->  move the article onto it, then 301
 *                                        the old path at the new one.
 *   DELETE  the clean handle is taken by a DIFFERENT article with the SAME
 *           title  ->  this is a duplicate of a post that already exists.
 *           Delete it, then 301 the old path at the survivor.
 *
 * Anything else (clean handle taken by an article with a different title) is
 * reported as SKIP and left alone for a person to look at. A conflict that is
 * not obviously a duplicate is not something a script should resolve.
 *
 * SAFETY, in three layers.
 *
 *  1. The only articles this route can touch are ones whose live handle matches
 *     /-\d{13}$/. It cannot rename or delete a normal article, whatever it is
 *     asked to do: it finds candidates by scanning for that pattern, and an id
 *     that is not among them is refused.
 *  2. It NEVER acts on everything it finds. POST requires an explicit
 *     `articleIds` list. This matters more than it looks: one of these mangled
 *     URLs was earning 11,122 impressions across 612 queries, and renaming a
 *     ranking page for the sake of a tidier slug trades a real asset for
 *     nothing. Which URLs are worth touching is a traffic judgement the route
 *     cannot make, so it refuses to guess.
 *  3. Deletion re-confirms, at the moment of deletion, that a live survivor
 *     holds the clean handle, so the content always still exists somewhere.
 *
 * Every repair creates the 301 before returning, so no repaired URL is ever
 * left as a bare 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];
const MANGLED = /-\d{13}$/;

let cachedVersion: string | null = null;

async function version(token: string): Promise<string> {
  if (cachedVersion) return cachedVersion;
  for (const v of API_VERSIONS) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs.json?limit=1`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (res.ok) return (cachedVersion = v);
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Shopify auth failed (${res.status}) — check SHOPIFY_ACCESS_TOKEN`);
    }
  }
  throw new Error("No working Shopify Admin API version found");
}

async function admin(path: string, init: RequestInit = {}) {
  const token = await getShopifyAccessToken();
  const v = await version(token);
  const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/${path}`, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* Shopify returns an empty body on DELETE */
  }
  return { ok: res.ok, status: res.status, json, link: res.headers.get("link"), text };
}

function nextPageInfo(link: string | null): string | null {
  const next = link?.split(",").find((p) => p.includes('rel="next"'));
  const url = next?.match(/<([^>]+)>/)?.[1];
  try {
    return url ? new URL(url).searchParams.get("page_info") : null;
  } catch {
    return null;
  }
}

type Article = { id: number; handle: string; title: string; published_at: string | null };

/** Every article on every blog. Paginated; the corpus is ~1,100 so this is 5 calls. */
async function allArticles(): Promise<{ blogId: number; blogHandle: string; article: Article }[]> {
  const blogsRes = await admin("blogs.json?limit=250");
  const blogs = ((blogsRes.json?.blogs as { id: number; handle: string }[]) || []);
  const out: { blogId: number; blogHandle: string; article: Article }[] = [];

  for (const blog of blogs) {
    let pageInfo: string | null = null;
    do {
      const qs = pageInfo
        ? `limit=250&page_info=${encodeURIComponent(pageInfo)}`
        : `limit=250&fields=id,handle,title,published_at`;
      const res = await admin(`blogs/${blog.id}/articles.json?${qs}`);
      if (!res.ok) break;
      for (const a of ((res.json?.articles as Article[]) || [])) {
        out.push({ blogId: blog.id, blogHandle: blog.handle, article: a });
      }
      pageInfo = nextPageInfo(res.link);
    } while (pageInfo);
  }
  return out;
}

type Plan = {
  action: "rename" | "delete-duplicate" | "skip";
  reason: string;
  articleId: number;
  blogId: number;
  blogHandle: string;
  title: string;
  from: string;
  to: string;
  survivorId?: number;
  redirectPath: string;
  redirectTarget: string;
};

async function buildPlan(): Promise<Plan[]> {
  const all = await allArticles();
  const byHandle = new Map<string, Article>();
  for (const { article } of all) byHandle.set(article.handle, article);

  const plans: Plan[] = [];
  for (const { article, blogId, blogHandle } of all) {
    if (!MANGLED.test(article.handle)) continue;
    const clean = article.handle.replace(MANGLED, "");
    const occupant = byHandle.get(clean);

    const base = {
      articleId: article.id,
      blogId,
      blogHandle,
      title: article.title,
      from: article.handle,
      to: clean,
      redirectPath: `/blogs/${blogHandle}/${article.handle}`,
      redirectTarget: `/blogs/${blogHandle}/${clean}`,
    };

    if (!occupant) {
      plans.push({ ...base, action: "rename", reason: "clean handle is free" });
    } else if (occupant.id !== article.id && occupant.title.trim() === article.title.trim()) {
      plans.push({
        ...base,
        action: "delete-duplicate",
        reason: `duplicate of live article ${occupant.id} with an identical title`,
        survivorId: occupant.id,
      });
    } else {
      plans.push({
        ...base,
        action: "skip",
        reason: occupant.id === article.id
          ? "already on the clean handle"
          : `clean handle held by article ${occupant.id} with a DIFFERENT title ("${occupant.title}") — resolve by hand`,
        survivorId: occupant.id,
      });
    }
  }
  return plans;
}

/** Create a 301 unless one already exists for that path. */
async function ensureRedirect(path: string, target: string) {
  const existing = await admin(`redirects.json?path=${encodeURIComponent(path)}&limit=1`);
  const found = (existing.json?.redirects as { id: number }[] | undefined)?.[0];
  if (found) return { created: false, id: found.id };
  const made = await admin("redirects.json", {
    method: "POST",
    body: JSON.stringify({ redirect: { path, target } }),
  });
  if (!made.ok) {
    return { created: false, error: `redirect failed (${made.status}): ${made.text.slice(0, 200)}` };
  }
  return { created: true, id: (made.json?.redirect as { id: number } | undefined)?.id };
}

export async function GET() {
  try {
    const plan = await buildPlan();
    return NextResponse.json({
      ok: true,
      mode: "report",
      counts: {
        rename: plan.filter((p) => p.action === "rename").length,
        deleteDuplicate: plan.filter((p) => p.action === "delete-duplicate").length,
        skip: plan.filter((p) => p.action === "skip").length,
      },
      plan,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "repair scan failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // opt IN to writing
    const requested: number[] = Array.isArray(body.articleIds)
      ? body.articleIds.map(Number).filter((n: number) => Number.isFinite(n))
      : [];

    const plan = await buildPlan();

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        mode: "dryRun",
        found: plan.length,
        note: "Nothing was changed. To apply, POST again with dryRun:false and an explicit articleIds list.",
        plan,
      });
    }

    if (!requested.length) {
      return NextResponse.json(
        {
          error:
            "articleIds is required when dryRun is false. This route never repairs everything it finds: a mangled URL can still be a page that ranks, and renaming it costs more than the tidier slug is worth. Pick the ids deliberately.",
          candidates: plan.map((p) => ({
            articleId: p.articleId,
            action: p.action,
            from: p.from,
            to: p.to,
            reason: p.reason,
          })),
        },
        { status: 400 }
      );
    }

    const selected = plan.filter((p) => requested.includes(p.articleId));
    const unknown = requested.filter((id) => !plan.some((p) => p.articleId === id));
    if (unknown.length) {
      return NextResponse.json(
        {
          error: `Refused. These ids are not live articles with a timestamp-mangled handle: ${unknown.join(", ")}. This route only ever touches those.`,
        },
        { status: 400 }
      );
    }

    const results: (Plan & { result: string })[] = [];
    for (const p of selected) {
      if (p.action === "skip") {
        results.push({ ...p, result: `skipped: ${p.reason}` });
        continue;
      }

      if (p.action === "rename") {
        const put = await admin(`blogs/${p.blogId}/articles/${p.articleId}.json`, {
          method: "PUT",
          body: JSON.stringify({ article: { id: p.articleId, handle: p.to } }),
        });
        if (!put.ok) {
          results.push({ ...p, result: `RENAME FAILED (${put.status}): ${put.text.slice(0, 200)}` });
          continue;
        }
        const r = await ensureRedirect(p.redirectPath, p.redirectTarget);
        results.push({
          ...p,
          result: `renamed to ${p.to}; redirect ${r.created ? "created " + r.id : r.error || "already existed"}`,
        });
        continue;
      }

      // delete-duplicate. The survivor was confirmed live with an identical
      // title when the plan was built; re-confirm before destroying anything.
      const survivor = await admin(`blogs/${p.blogId}/articles/${p.survivorId}.json`);
      const survivorHandle = (survivor.json?.article as { handle?: string } | undefined)?.handle;
      if (!survivor.ok || survivorHandle !== p.to) {
        results.push({
          ...p,
          result: `ABORTED: survivor ${p.survivorId} is not live at "${p.to}" (handle "${survivorHandle}")`,
        });
        continue;
      }
      const del = await admin(`blogs/${p.blogId}/articles/${p.articleId}.json`, { method: "DELETE" });
      if (!del.ok) {
        results.push({ ...p, result: `DELETE FAILED (${del.status}): ${del.text.slice(0, 200)}` });
        continue;
      }
      const r = await ensureRedirect(p.redirectPath, p.redirectTarget);
      results.push({
        ...p,
        result: `deleted duplicate ${p.articleId}, kept ${p.survivorId}; redirect ${
          r.created ? "created " + r.id : r.error || "already existed"
        }`,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "applied",
      applied: results.length,
      skippedNotRequested: plan.length - selected.length,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "repair failed" },
      { status: 500 }
    );
  }
}
