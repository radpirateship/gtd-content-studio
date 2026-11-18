import { type NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import { getSQL } from "@/lib/db";
import {
  buildBulletFix,
  parseCards,
  scanProse,
  normalizeLabel,
  reviewReasons,
  REMOVE_BULLETS,
  type ProseHit,
} from "@/lib/product-bullets";

/**
 * POST /api/maintenance/bullet-audit
 *
 * Inventories and repairs the feature bullets inside .gtd-product-card blocks
 * across every published article.
 *
 * Background: extractFeatures() always forced "White-Glove Delivery Included"
 * into slot 1 and padded thin cards with "Free Shipping Included". GTD offers
 * neither universally (free shipping is conditional on product class and is not
 * offered on freight items such as saunas), so both claims had to be pulled from
 * every live post. See lib/product-bullets.ts.
 *
 * Body: {
 *   mode: "dry" | "apply",     // dry = report only, zero writes (default)
 *   handles?: string[],        // apply only these article handles (empty = all affected)
 *   removeLabels?: string[],   // override the removal list (defaults to REMOVE_BULLETS)
 *   batchSize?: number         // articles updated per invocation (default 10, max 20)
 * }
 *
 * Dry mode returns a full bullet-frequency table so the most common bullets can
 * be reviewed before anything is deleted. Apply mode processes one batch per
 * call and returns { remaining } so the client loops until done, keeping each
 * invocation well under maxDuration.
 *
 * Mirrors the pacing and batching of /api/maintenance/fix-anchors.
 */

export const maxDuration = 60;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];

let cachedVersion: string | null = null;

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
      const retryAfter = Number(res.headers.get("retry-after")) || 2;
      console.warn(`[bullet-audit] 429 on ${path}, waiting ${retryAfter}s (attempt ${attempt}/4)`);
      await sleep(retryAfter * 1000 + 250);
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Shopify ${init.method || "GET"} ${path} failed (${res.status}): ${body.slice(0, 200)}`
      );
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
  cardCount: number;
  cardsTouched: number;
  removed: number;
  replaced: number;
  proseFixed: number;
  removedLabels: string[];
  /** Cards the minBullets guard refused to shrink — need a manual look. */
  skippedCards: string[];
  proseHits: ProseHit[];
};

type BulletStat = {
  label: string;
  count: number;
  articles: number;
  /** How often this bullet sits in the bolded first slot. */
  firstSlot: number;
  /** Distinct product handles carrying this bullet. */
  products: number;
  flagged: boolean;
  /** Non-empty when the bullet makes a claim a human has to verify. */
  review: string[];
};

type ProductStat = { handle: string; title: string; cards: number; articles: number };

async function scanAll(removeLabels: string[]) {
  const { json: blogsJson } = await adminRequest("blogs.json?limit=250");
  const blogs: { id: number; handle: string }[] = blogsJson.blogs || [];
  const removeSet = new Set(removeLabels.map(normalizeLabel));

  let scanned = 0;
  let articlesWithCards = 0;
  let totalCards = 0;

  const affected: AffectedArticle[] = [];
  // label -> aggregate counters
  const stats = new Map<
    string,
    { label: string; count: number; firstSlot: number; articles: Set<string>; products: Set<string> }
  >();
  const products = new Map<string, { title: string; cards: number; articles: Set<string> }>();

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
        body_html: string | null;
      }[] = json.articles || [];

      for (const a of articles) {
        scanned++;
        const html = a.body_html || "";
        const cards = parseCards(html);
        if (cards.length === 0) continue;
        articlesWithCards++;
        totalCards += cards.length;

        // Frequency table over every bullet, not just the ones being removed.
        for (const card of cards) {
          if (card.handle) {
            const p = products.get(card.handle) || {
              title: card.title,
              cards: 0,
              articles: new Set<string>(),
            };
            p.cards++;
            p.articles.add(a.handle);
            if (!p.title && card.title) p.title = card.title;
            products.set(card.handle, p);
          }
          card.bullets.forEach((b, i) => {
            const key = normalizeLabel(b.label);
            const s =
              stats.get(key) ||
              { label: b.label, count: 0, firstSlot: 0, articles: new Set<string>(), products: new Set<string>() };
            s.count++;
            if (i === 0) s.firstSlot++;
            s.articles.add(a.handle);
            if (card.handle) s.products.add(card.handle);
            stats.set(key, s);
          });
        }

        const fix = buildBulletFix(html, removeLabels);
        const proseHits = scanProse(html);

        // Cards the guard skipped: they contain a doomed bullet but would drop
        // below the minimum, so they need a human (or a product-specific rewrite).
        const skippedCards = cards
          .filter((c) => {
            const doomed = c.bullets.filter((b) => removeSet.has(normalizeLabel(b.label))).length;
            return doomed > 0 && c.bullets.length - doomed < 2;
          })
          .map((c) => c.title || c.handle || "(untitled card)");

        if (fix || proseHits.length > 0 || skippedCards.length > 0) {
          affected.push({
            blogId: blog.id,
            blogHandle: blog.handle,
            articleId: a.id,
            title: a.title,
            handle: a.handle,
            cardCount: cards.length,
            cardsTouched: fix?.cardsTouched ?? 0,
            removed: fix?.removed ?? 0,
            replaced: fix?.replaced ?? 0,
            proseFixed: fix?.proseFixed ?? 0,
            removedLabels: fix?.removedLabels ?? [],
            skippedCards,
            proseHits,
          });
        }
      }

      pageInfo = nextPageInfo(link);
      if (pageInfo) await sleep(600);
    } while (pageInfo);
  }

  const bulletStats: BulletStat[] = [...stats.values()]
    .map((s) => ({
      label: s.label,
      count: s.count,
      articles: s.articles.size,
      firstSlot: s.firstSlot,
      products: s.products.size,
      flagged: removeSet.has(normalizeLabel(s.label)),
      review: removeSet.has(normalizeLabel(s.label)) ? [] : reviewReasons(s.label),
    }))
    .sort((a, b) => b.count - a.count);

  const productStats: ProductStat[] = [...products.entries()]
    .map(([handle, p]) => ({ handle, title: p.title, cards: p.cards, articles: p.articles.size }))
    .sort((a, b) => b.cards - a.cards);

  return { scanned, articlesWithCards, totalCards, affected, bulletStats, productStats };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode: "dry" | "apply" = body.mode === "apply" ? "apply" : "dry";
    const onlyHandles: string[] = Array.isArray(body.handles) ? body.handles : [];
    const removeLabels: string[] =
      Array.isArray(body.removeLabels) && body.removeLabels.length ? body.removeLabels : REMOVE_BULLETS;
    const batchSize: number = Math.min(Math.max(Number(body.batchSize) || 10, 1), 20);

    const { scanned, articlesWithCards, totalCards, affected, bulletStats, productStats } =
      await scanAll(removeLabels);

    if (mode === "dry") {
      const writable = affected.filter((a) => a.removed + a.replaced + a.proseFixed > 0);
      return NextResponse.json({
        mode,
        scanned,
        articlesWithCards,
        totalCards,
        uniqueProducts: productStats.length,
        uniqueBullets: bulletStats.length,
        affectedCount: writable.length,
        totalRemovals: affected.reduce((s, a) => s + a.removed, 0),
        totalProseFixes: affected.reduce((s, a) => s + a.proseFixed, 0),
        bulletStats,
        productStats,
        items: affected,
      });
    }

    // ── Apply ────────────────────────────────────────────────────────────────
    const writable = affected.filter((a) => a.removed + a.replaced + a.proseFixed > 0);
    const targets = onlyHandles.length
      ? writable.filter((a) => onlyHandles.includes(a.handle))
      : writable;
    const batch = targets.slice(0, batchSize);
    const remaining = targets.slice(batchSize).map((a) => a.handle);

    const sql = getSQL();
    const processed: {
      handle: string;
      title: string;
      removed: number;
      proseFixed: number;
      ok: boolean;
      error?: string;
      dbSynced: boolean;
    }[] = [];

    for (const target of batch) {
      try {
        // Re-fetch the live body right before writing; scan data can be stale.
        const { json } = await adminRequest(
          `blogs/${target.blogId}/articles/${target.articleId}.json`
        );
        await sleep(600);
        const fresh: string = json.article?.body_html || "";
        const fix = buildBulletFix(fresh, removeLabels);
        if (!fix) {
          processed.push({
            handle: target.handle,
            title: target.title,
            removed: 0,
            proseFixed: 0,
            ok: true,
            dbSynced: false,
          });
          continue;
        }

        await adminRequest(`blogs/${target.blogId}/articles/${target.articleId}.json`, {
          method: "PUT",
          body: JSON.stringify({ article: { id: target.articleId, body_html: fix.fixed } }),
        });

        let dbSynced = false;
        try {
          await sql`
            UPDATE articles
            SET html_content = ${fix.fixed}, updated_at = NOW()
            WHERE slug = ${target.handle}
          `;
          dbSynced = true;
        } catch (dbErr) {
          console.error(
            `[bullet-audit] DB sync failed for ${target.handle} (Shopify already updated):`,
            dbErr
          );
        }

        console.log(
          `[bullet-audit] Updated "${target.title}" (${target.handle}): ${fix.removed} bullet(s) removed, ${fix.proseFixed} prose fix(es)`
        );
        processed.push({
          handle: target.handle,
          title: target.title,
          removed: fix.removed,
          proseFixed: fix.proseFixed,
          ok: true,
          dbSynced,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[bullet-audit] FAILED ${target.handle}: ${msg}`);
        processed.push({
          handle: target.handle,
          title: target.title,
          removed: 0,
          proseFixed: 0,
          ok: false,
          error: msg,
          dbSynced: false,
        });
      }
      // GET + PUT per article; with the 600ms pause after the GET this keeps the
      // sustained rate near 1.2 req/s, under Shopify's 2 req/s leak rate.
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
    console.error("[bullet-audit] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "bullet-audit failed" },
      { status: 500 }
    );
  }
}
