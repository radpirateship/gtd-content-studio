import { type NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import { getSQL } from "@/lib/db";
import { callAI } from "@/lib/ai";
import {
  buildCardRewrite,
  inventoryHandles,
  parseCards,
  normalizeLabel,
  REMOVE_BULLETS,
  SERVICE_BULLET,
  reviewReasons,
  swapCardProduct,
} from "@/lib/product-bullets";

/**
 * POST /api/maintenance/product-bullets
 *
 * Replaces the generic template bullets on published product cards with two
 * short, product-specific specs plus one service line.
 *
 * The Aug 3 2026 audit found 66% of all card bullets were filler. Deleting the
 * false claims alone would have left 955 cards (30%) with no product
 * information, so the bullets are regenerated per product instead. Cards whose
 * bullets are already product-specific are left as written.
 *
 * ── WHY THIS IS DB-BACKED ───────────────────────────────────────────────────
 * The first version swept every blog article AND the whole product catalog on
 * every single invocation. That is ~800 articles plus the catalog, which blew
 * straight past the 60s Vercel limit and returned a 504 (an HTML error page,
 * which is why the client saw "Unexpected token 'A'" instead of JSON).
 *
 * Now the Shopify sweeps happen ONCE into three index tables, each resumable
 * via a cursor and each self-limiting on a wall-clock budget. Every other mode
 * reads Postgres and returns in milliseconds.
 *
 * Modes:
 *   scan       sweep articles into pb_article_index + pb_card_index. Resumable.
 *   catalog    sweep products into pb_catalog. Resumable.
 *   inventory  pure DB read. Instant. Run scan + catalog first.
 *   draft      generate + store bullets. Reads the DB, no Shopify sweep.
 *   list       return stored bullets for review.
 *   save       upsert edited bullets for one handle (sets status=approved).
 *   apply      rewrite article cards from approved bullets. Resumable.
 *
 * Claim removal and the service-bullet rename across ALL cards (including the
 * protected ones) stay in /api/maintenance/bullet-audit. Run that once at the
 * end. This route only rewrites cards backed by an approved product.
 */

export const maxDuration = 60;

/** Stop work and hand a cursor back well before the platform kills us. */
const TIME_BUDGET_MS = 40_000;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];
let cachedVersion: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolveVersion(token: string): Promise<string> {
  if (cachedVersion) return cachedVersion;
  for (const v of API_VERSIONS) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/shop.json`, {
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

// ── Schema ──────────────────────────────────────────────────────────────────

type SQL = ReturnType<typeof getSQL>;
let schemaReady = false;

async function ensureSchema(sql: SQL) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS product_bullets (
      handle       TEXT PRIMARY KEY,
      title        TEXT,
      bullets      JSONB NOT NULL,
      source       TEXT NOT NULL DEFAULT 'ai',
      status       TEXT NOT NULL DEFAULT 'draft',
      card_count   INTEGER DEFAULT 0,
      notes        TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_product_bullets_status ON product_bullets(status)`;
  // Catalog snapshot: enough per product to draft bullets without re-fetching.
  await sql`
    CREATE TABLE IF NOT EXISTS pb_catalog (
      handle       TEXT PRIMARY KEY,
      title        TEXT,
      description  TEXT,
      vendor       TEXT,
      product_type TEXT,
      tags         TEXT,
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Per-product card totals across every article.
  await sql`
    CREATE TABLE IF NOT EXISTS pb_card_index (
      handle         TEXT PRIMARY KEY,
      title          TEXT,
      cards          INTEGER DEFAULT 0,
      template_cards INTEGER DEFAULT 0,
      bespoke_cards  INTEGER DEFAULT 0,
      articles       INTEGER DEFAULT 0,
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Per-article record, with the product handles it features, so apply can
  // target only the articles that contain an approved product.
  await sql`
    CREATE TABLE IF NOT EXISTS pb_article_index (
      article_id     BIGINT PRIMARY KEY,
      blog_id        BIGINT,
      blog_handle    TEXT,
      handle         TEXT,
      title          TEXT,
      cards          INTEGER DEFAULT 0,
      template_cards INTEGER DEFAULT 0,
      handles        TEXT[] DEFAULT '{}',
      applied_at     TIMESTAMPTZ,
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Older installs predate applied_at; add it in place rather than forcing a
  // rescan. Cheap no-op once the column exists.
  await sql`ALTER TABLE pb_article_index ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pb_article_handles ON pb_article_index USING GIN (handles)`;
  schemaReady = true;
}

// ── scan: articles -> pb_article_index + pb_card_index ──────────────────────

type ScanCursor = { blogIndex: number; pageInfo: string | null } | null;

async function scanArticles(sql: SQL, cursor: ScanCursor, startedAt: number) {
  const { json: blogsJson } = await adminRequest("blogs.json?limit=250");
  const blogs: { id: number; handle: string }[] = blogsJson.blogs || [];

  // A fresh scan wipes the index so counts accumulate cleanly rather than
  // doubling on a re-run.
  if (!cursor) {
    await sql`TRUNCATE pb_article_index`;
    await sql`TRUNCATE pb_card_index`;
  }

  let blogIndex = cursor?.blogIndex ?? 0;
  let pageInfo = cursor?.pageInfo ?? null;
  let articlesScanned = 0;

  while (blogIndex < blogs.length) {
    const blog = blogs[blogIndex];
    const qs = pageInfo
      ? `limit=250&page_info=${encodeURIComponent(pageInfo)}`
      : "limit=250";
    const { json, link } = await adminRequest(`blogs/${blog.id}/articles.json?${qs}`);
    const articles: {
      id: number;
      title: string;
      handle: string;
      body_html: string | null;
    }[] = json.articles || [];

    const articleRows: Record<string, unknown>[] = [];
    // Keyed by handle so one page can never propose the same handle twice.
    // Postgres rejects an ON CONFLICT statement that would touch a row more
    // than once, and the same product does appear under slightly different
    // card titles across articles.
    const cardAgg = new Map<
      string,
      { handle: string; title: string; cards: number; template_cards: number; bespoke_cards: number; articles: number }
    >();

    for (const a of articles) {
      articlesScanned++;
      const inv = inventoryHandles(a.body_html || "");
      if (inv.size === 0) continue;

      let cards = 0;
      let templateCards = 0;
      for (const [handle, info] of inv) {
        cards += info.cards;
        templateCards += info.templateCards;
        const agg =
          cardAgg.get(handle) ||
          { handle, title: info.title, cards: 0, template_cards: 0, bespoke_cards: 0, articles: 0 };
        agg.cards += info.cards;
        agg.template_cards += info.templateCards;
        agg.bespoke_cards += info.bespokeCards;
        agg.articles += 1;
        if (!agg.title && info.title) agg.title = info.title;
        cardAgg.set(handle, agg);
      }
      articleRows.push({
        article_id: a.id,
        blog_id: blog.id,
        blog_handle: blog.handle,
        handle: a.handle,
        title: a.title,
        cards,
        template_cards: templateCards,
        handles: [...inv.keys()],
      });
    }

    // One round trip per page, not one per row. At ~4 handles per article and
    // 250 articles per page that is the difference between 1 query and 1,000.
    if (articleRows.length) {
      await sql`
        INSERT INTO pb_article_index (article_id, blog_id, blog_handle, handle, title, cards, template_cards, handles)
        SELECT article_id, blog_id, blog_handle, handle, title, cards, template_cards,
               ARRAY(SELECT jsonb_array_elements_text(handles))
        FROM (
          SELECT DISTINCT ON (article_id) *
          FROM jsonb_to_recordset(${JSON.stringify(articleRows)}::jsonb)
            AS y(article_id bigint, blog_id bigint, blog_handle text, handle text, title text,
                 cards int, template_cards int, handles jsonb)
          ORDER BY article_id
        ) AS x
        ON CONFLICT (article_id) DO UPDATE SET
          cards = EXCLUDED.cards, template_cards = EXCLUDED.template_cards,
          handles = EXCLUDED.handles, title = EXCLUDED.title, updated_at = NOW()
      `;
    }
    const cardRows = [...cardAgg.values()];
    if (cardRows.length) {
      await sql`
        INSERT INTO pb_card_index (handle, title, cards, template_cards, bespoke_cards, articles)
        SELECT handle, MAX(title), SUM(cards)::int, SUM(template_cards)::int,
               SUM(bespoke_cards)::int, SUM(articles)::int
        FROM jsonb_to_recordset(${JSON.stringify(cardRows)}::jsonb)
          AS x(handle text, title text, cards int, template_cards int, bespoke_cards int, articles int)
        GROUP BY handle
        ON CONFLICT (handle) DO UPDATE SET
          cards = pb_card_index.cards + EXCLUDED.cards,
          template_cards = pb_card_index.template_cards + EXCLUDED.template_cards,
          bespoke_cards = pb_card_index.bespoke_cards + EXCLUDED.bespoke_cards,
          articles = pb_card_index.articles + EXCLUDED.articles,
          title = COALESCE(NULLIF(pb_card_index.title, ''), EXCLUDED.title),
          updated_at = NOW()
      `;
    }

    pageInfo = nextPageInfo(link);
    if (!pageInfo) {
      blogIndex++;
      pageInfo = null;
    }

    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    await sleep(400);
  }

  const done = blogIndex >= blogs.length;
  return {
    articlesScanned,
    done,
    cursor: done ? null : { blogIndex, pageInfo },
    blogs: blogs.length,
  };
}

// ── catalog: products -> pb_catalog ─────────────────────────────────────────

async function scanCatalog(sql: SQL, cursor: string | null, startedAt: number, first: boolean) {
  if (first) await sql`TRUNCATE pb_catalog`;

  let pageInfo = cursor;
  let scanned = 0;

  for (;;) {
    const qs = pageInfo ? `limit=250&page_info=${encodeURIComponent(pageInfo)}` : "limit=250";
    const { json, link } = await adminRequest(`products.json?${qs}`);
    const products: {
      handle: string;
      title: string;
      body_html: string | null;
      vendor: string | null;
      product_type: string | null;
      tags: string | null;
    }[] = json.products || [];

    const rows = products.map((p) => ({
      handle: p.handle,
      title: p.title || "",
      // Tags and stripped body only. 2,500 chars is plenty for drafting and
      // keeps the table small.
      description: (p.body_html || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2500),
      vendor: p.vendor || "",
      product_type: p.product_type || "",
      tags: p.tags || "",
    }));
    scanned += rows.length;

    if (rows.length) {
      await sql`
        INSERT INTO pb_catalog (handle, title, description, vendor, product_type, tags)
        SELECT handle, title, description, vendor, product_type, tags
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
          AS x(handle text, title text, description text, vendor text, product_type text, tags text)
        ON CONFLICT (handle) DO UPDATE SET
          title = EXCLUDED.title, description = EXCLUDED.description,
          vendor = EXCLUDED.vendor, product_type = EXCLUDED.product_type,
          tags = EXCLUDED.tags, updated_at = NOW()
      `;
    }

    pageInfo = nextPageInfo(link);
    if (!pageInfo) break;
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    await sleep(400);
  }

  return { scanned, done: !pageInfo, cursor: pageInfo };
}

// ── Drafting ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You write product feature bullets for Green Thumb Depot product cards in blog articles.

Return exactly 2 bullets as a JSON array of strings and nothing else. No prose, no markdown fence.

A third bullet is added automatically by the system and is not your job. Your 2 bullets must both be product facts.

STYLE
- Each bullet is a short spec: 3 to 6 words, roughly 15 to 40 characters. Title Case.
- Examples of the right shape: "Water Resistance Flywheel", "1 HP Chiller, 37-50F", "Canadian Cedar Construction", "20-Micron Filtration", "6-Person Capacity", "Low EMF Certified".
- Each bullet must describe THE PRODUCT: material, construction, resistance type, capacity, dimensions, power, temperature range, certification, control system.
- The 2 bullets must be distinct facts. Pick the two that would most influence a buying decision: the defining mechanism or material first, then capacity, power, or certification.

HARD RULES
- Use ONLY facts present in the product data given to you. Never infer, estimate, or round a number that is not stated.
- Never mention shipping, delivery, white-glove service, assembly, installation, warranty, support, financing, or price. Those are not product features and several are claims Green Thumb Depot cannot make.
- Never restate the product category as a feature. A card for a sauna does not need a bullet that says "Infrared Sauna".
- Never use an em dash. Use a comma or a hyphen.
- If the product data supports fewer than 2 real specs, return only the one you can support, or an empty array. Returning 1 accurate bullet is correct; inventing a second is not. A product with a thin description is flagged for a human rather than padded.`;

type CatalogRow = {
  handle: string;
  title: string;
  description: string;
  vendor: string;
  product_type: string;
  tags: string;
};

function buildUserPrompt(p: CatalogRow): string {
  return [
    `Product title: ${p.title}`,
    p.vendor ? `Brand: ${p.vendor}` : "",
    p.product_type ? `Product type: ${p.product_type}` : "",
    p.tags ? `Tags: ${p.tags}` : "",
    "",
    "Description:",
    p.description || "(no description available)",
  ]
    .filter(Boolean)
    .join("\n");
}

const BANNED_IN_BULLET =
  /shipping|deliver|white[\s-]?glove|assembl|install|warrant|guarantee|financ|\bAPR\b|support|\$\d|free\b/i;

function parseBullets(raw: string): string[] {
  const jsonText = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const m = jsonText.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const b = item.replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
    if (!b || b.length > 60) continue;
    // Belt and braces: the prompt bans these, this guarantees it.
    if (BANNED_IN_BULLET.test(b)) continue;
    if (reviewReasons(b).length > 0) continue;
    const key = normalizeLabel(b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
    if (out.length === 2) break;
  }
  return out;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const mode: string = body.mode || "inventory";
    const sql = getSQL();
    await ensureSchema(sql);

    // ── scan ────────────────────────────────────────────────────────────────
    if (mode === "scan") {
      const cursor: ScanCursor = body.cursor ?? null;
      const r = await scanArticles(sql, cursor, startedAt);
      const [{ articles, cards }] = (await sql`
        SELECT COUNT(*)::int AS articles, COALESCE(SUM(cards), 0)::int AS cards FROM pb_article_index
      `) as { articles: number; cards: number }[];
      return NextResponse.json({ mode, ...r, indexedArticles: articles, indexedCards: cards });
    }

    // ── catalog ─────────────────────────────────────────────────────────────
    if (mode === "catalog") {
      const cursor: string | null = body.cursor ?? null;
      const r = await scanCatalog(sql, cursor, startedAt, !cursor);
      const [{ total }] = (await sql`SELECT COUNT(*)::int AS total FROM pb_catalog`) as {
        total: number;
      }[];
      return NextResponse.json({ mode, ...r, catalogSize: total });
    }

    // ── inventory (pure DB read) ────────────────────────────────────────────
    if (mode === "inventory") {
      const items = (await sql`
        SELECT c.handle,
               COALESCE(NULLIF(c.title, ''), p.title, '') AS title,
               c.cards, c.template_cards, c.bespoke_cards, c.articles,
               (p.handle IS NOT NULL) AS in_catalog,
               COALESCE(LENGTH(p.description), 0) > 80 AS has_description,
               (b.handle IS NOT NULL) AS has_bullets
        FROM pb_card_index c
        LEFT JOIN pb_catalog p ON p.handle = c.handle
        LEFT JOIN product_bullets b ON b.handle = c.handle
        ORDER BY c.template_cards DESC, c.cards DESC
      `) as {
        handle: string;
        title: string;
        cards: number;
        template_cards: number;
        bespoke_cards: number;
        articles: number;
        in_catalog: boolean;
        has_description: boolean;
        has_bullets: boolean;
      }[];

      const [{ articles_indexed }] = (await sql`
        SELECT COUNT(*)::int AS articles_indexed FROM pb_article_index
      `) as { articles_indexed: number }[];
      const [{ catalog_size }] = (await sql`
        SELECT COUNT(*)::int AS catalog_size FROM pb_catalog
      `) as { catalog_size: number }[];

      const draftable = items.filter((i) => i.in_catalog && i.template_cards > 0);

      return NextResponse.json({
        mode,
        needsScan: items.length === 0,
        needsCatalog: catalog_size === 0,
        articlesScanned: articles_indexed,
        catalogSize: catalog_size,
        totalCards: items.reduce((s, i) => s + i.cards, 0),
        templateCards: items.reduce((s, i) => s + i.template_cards, 0),
        protectedCards: items.reduce((s, i) => s + i.bespoke_cards, 0),
        uniqueProducts: items.length,
        inCatalog: items.filter((i) => i.in_catalog).length,
        missingFromCatalog: items.filter((i) => !i.in_catalog).map((i) => i.handle),
        thinDescription: draftable.filter((i) => !i.has_description).length,
        alreadyDrafted: items.filter((i) => i.has_bullets).length,
        fullyBespoke: items.filter((i) => i.in_catalog && i.template_cards === 0).length,
        toDraft: draftable.filter((i) => !i.has_bullets).length,
        items: items.map((i) => ({
          handle: i.handle,
          title: i.title,
          cards: i.cards,
          templateCards: i.template_cards,
          bespokeCards: i.bespoke_cards,
          articles: i.articles,
          inCatalog: i.in_catalog,
          hasDescription: i.has_description,
          hasBullets: i.has_bullets,
        })),
      });
    }

    // ── list ────────────────────────────────────────────────────────────────
    if (mode === "list") {
      const rows = await sql`
        SELECT handle, title, bullets, source, status, card_count, notes, updated_at
        FROM product_bullets ORDER BY card_count DESC NULLS LAST, handle
      `;
      return NextResponse.json({ mode, items: rows });
    }

    // ── save ────────────────────────────────────────────────────────────────
    if (mode === "save") {
      const handle: string = String(body.handle || "").trim();
      // Stored rows hold PRODUCT SPECS ONLY. The service bullet is appended at
      // apply time from SERVICE_BULLET, so it must never be saved into a row.
      const bullets: string[] = (Array.isArray(body.bullets) ? body.bullets : [])
        .map((b: unknown) => String(b).trim())
        .filter(Boolean)
        .filter((b: string) => normalizeLabel(b) !== normalizeLabel(SERVICE_BULLET))
        .slice(0, 3);
      if (!handle) {
        return NextResponse.json({ error: "handle is required" }, { status: 400 });
      }
      if (bullets.length < 1) {
        return NextResponse.json(
          { error: "at least 1 product spec is required; the service bullet is added automatically" },
          { status: 400 }
        );
      }
      await sql`
        INSERT INTO product_bullets (handle, bullets, source, status, updated_at)
        VALUES (${handle}, ${JSON.stringify(bullets)}::jsonb, 'manual', 'approved', NOW())
        ON CONFLICT (handle) DO UPDATE
        SET bullets = ${JSON.stringify(bullets)}::jsonb,
            source = 'manual', status = 'approved', updated_at = NOW()
      `;
      return NextResponse.json({ mode, handle, bullets, saved: true });
    }

    // ── broken ──────────────────────────────────────────────────────────────
    /**
     * Diagnose card links whose handle is not in the catalog.
     *
     * Two different faults land in the same bucket and need different fixes:
     *  - a genuinely discontinued product (a real handle, 404 on the storefront)
     *  - a malformed link, where something wrote bullet text or description
     *    prose into href="/products/...". Those were never valid URLs.
     *
     * Read-only. Returns the raw href and the surrounding card fields so the
     * fault type is obvious before anything is rewritten.
     */
    if (mode === "broken") {
      const missing = (await sql`
        SELECT c.handle, c.cards, c.articles
        FROM pb_card_index c
        LEFT JOIN pb_catalog p ON p.handle = c.handle
        WHERE p.handle IS NULL
        ORDER BY c.cards DESC
      `) as { handle: string; cards: number; articles: number }[];

      const out: {
        handle: string;
        looksLikeHandle: boolean;
        fault: string;
        cards: number;
        suggestions: { handle: string; title: string; product_type: string; vendor: string; score: number }[];
        articles: { articleId: number; blogHandle: string; handle: string; title: string }[];
        samples: { cardTitle: string; rawHref: string; bullets: string[] }[];
      }[] = [];

      for (const m of missing) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        const arts = (await sql`
          SELECT article_id, blog_id, blog_handle, handle, title
          FROM pb_article_index
          WHERE ${m.handle} = ANY(handles)
          ORDER BY template_cards DESC
          LIMIT 25
        `) as {
          article_id: number;
          blog_id: number;
          blog_handle: string;
          handle: string;
          title: string;
        }[];

        // A valid Shopify handle is lowercase alphanumerics and hyphens.
        const looksLikeHandle = /^[a-z0-9][a-z0-9-]*$/.test(m.handle) && m.handle.length < 120;

        const samples: { cardTitle: string; rawHref: string; bullets: string[] }[] = [];
        if (arts.length && Date.now() - startedAt < TIME_BUDGET_MS) {
          try {
            const { json } = await adminRequest(
              `blogs/${arts[0].blog_id}/articles/${arts[0].article_id}.json`
            );
            const html: string = json.article?.body_html || "";
            for (const card of parseCards(html)) {
              if (card.handle !== m.handle) continue;
              const chunkStart = Math.max(0, card.ulStart - 2500);
              const chunk = html.slice(chunkStart, card.ulEnd + 400);
              const rawHref = /href="([^"]*\/products\/[^"]*)"/i.exec(chunk)?.[1] || "(none found)";
              samples.push({
                cardTitle: card.title,
                rawHref,
                bullets: card.bullets.map((b) => b.label),
              });
              if (samples.length >= 2) break;
            }
          } catch (err) {
            console.error(`[product-bullets] broken sample fetch failed for ${m.handle}:`, err);
          }
        }

        // Candidate replacements: score active catalog products by word overlap
        // with the dead handle and the card title. Cheap, and good enough to
        // shortlist five for a human to pick from.
        const words = `${m.handle} ${samples[0]?.cardTitle || ""}`
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 2 && !/^\d+$/.test(w));
        const suggestions = words.length
          ? ((await sql`
              SELECT handle, title, product_type, vendor,
                     -- jsonb cannot be cast to text[] directly; unwrap the array
                     -- with jsonb_array_elements_text and rebuild it.
                     (SELECT COUNT(*)
                      FROM unnest(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(words)}::jsonb))) AS w
                      WHERE lower(pb_catalog.title || ' ' || pb_catalog.handle || ' ' ||
                            COALESCE(pb_catalog.tags, '')) LIKE '%' || w || '%')::int AS score
              FROM pb_catalog
              ORDER BY score DESC, title
              LIMIT 5
            `) as { handle: string; title: string; product_type: string; vendor: string; score: number }[])
              .filter((c) => c.score > 0)
          : [];

        out.push({
          handle: m.handle,
          looksLikeHandle,
          suggestions,
          fault: looksLikeHandle
            ? "handle is well formed, so the product was most likely discontinued or renamed"
            : "not a valid Shopify handle; something wrote bullet text or description prose into the href",
          cards: m.cards,
          articles: arts.map((a) => ({
            articleId: a.article_id,
            blogHandle: a.blog_handle,
            handle: a.handle,
            title: a.title,
          })),
          samples,
        });
      }

      // Distinguish "nothing is broken" from "there is nothing indexed to
      // check". The scan truncates before it repopulates, so an interrupted
      // index leaves these tables empty and both cases return zero rows.
      const [{ indexed_products }] = (await sql`
        SELECT COUNT(*)::int AS indexed_products FROM pb_card_index
      `) as { indexed_products: number }[];
      const [{ catalog_size }] = (await sql`
        SELECT COUNT(*)::int AS catalog_size FROM pb_catalog
      `) as { catalog_size: number }[];

      return NextResponse.json({
        mode,
        count: out.length,
        indexedProducts: indexed_products,
        catalogSize: catalog_size,
        needsIndex: indexed_products === 0 || catalog_size === 0,
        items: out,
      });
    }

    // ── swap ────────────────────────────────────────────────────────────────
    /**
     * Repoint every card for a dead handle at a live product.
     *
     * Edits the fields inside each existing card (href, title, image, price,
     * bullets, CTA label) rather than rebuilding the block, so the badge and
     * grid position survive. The badge encodes price rank within the article;
     * regenerating it would reshuffle the section.
     *
     * Works for both fault types: a discontinued product, and a card whose href
     * was never a valid handle because prose got written into it.
     *
     * Body: { from: string, to: string, dry?: boolean }
     */
    if (mode === "swap") {
      const from = String(body.from || "").trim();
      const to = String(body.to || "").trim();
      const dry = body.dry !== false ? body.dry === true : false;
      if (!from || !to) {
        return NextResponse.json({ error: "both from and to are required" }, { status: 400 });
      }

      // Pull the replacement live so image and price are current, and so a typo
      // in the target handle fails loudly here rather than writing a dead link.
      const { json: prodJson } = await adminRequest(
        `products.json?handle=${encodeURIComponent(to)}&limit=1`
      );
      const target = prodJson.products?.[0];
      if (!target) {
        return NextResponse.json(
          { error: `no active product found with handle "${to}"` },
          { status: 400 }
        );
      }

      const curated = (await sql`
        SELECT bullets FROM product_bullets WHERE handle = ${to} AND status = 'approved'
      `) as { bullets: string[] }[];

      const replacement = {
        handle: target.handle as string,
        title: (target.title || "") as string,
        imageUrl: (target.image?.src || target.images?.[0]?.src || null) as string | null,
        price: (target.variants?.[0]?.price || null) as string | null,
        bullets: Array.isArray(curated[0]?.bullets) ? curated[0].bullets : undefined,
      };

      const targets = (await sql`
        SELECT article_id, blog_id, blog_handle, handle, title
        FROM pb_article_index
        WHERE ${from} = ANY(handles)
        ORDER BY article_id
      `) as {
        article_id: number;
        blog_id: number;
        blog_handle: string;
        handle: string;
        title: string;
      }[];

      const processed: {
        handle: string;
        title: string;
        cardsSwapped: number;
        ok: boolean;
        error?: string;
      }[] = [];

      for (const t of targets) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        try {
          const { json } = await adminRequest(`blogs/${t.blog_id}/articles/${t.article_id}.json`);
          const fresh: string = json.article?.body_html || "";
          const swapped = swapCardProduct(fresh, from, replacement, SERVICE_BULLET);
          if (!swapped) {
            processed.push({ handle: t.handle, title: t.title, cardsSwapped: 0, ok: true });
            continue;
          }
          if (!dry) {
            await sleep(500);
            await adminRequest(`blogs/${t.blog_id}/articles/${t.article_id}.json`, {
              method: "PUT",
              body: JSON.stringify({
                article: { id: t.article_id, body_html: swapped.fixed },
              }),
            });
            try {
              await sql`
                UPDATE articles SET html_content = ${swapped.fixed}, updated_at = NOW()
                WHERE slug = ${t.handle}
              `;
            } catch (dbErr) {
              console.error(`[product-bullets] swap DB sync failed for ${t.handle}:`, dbErr);
            }
            // Keep the index honest so a later pass targets the new handle.
            await sql`
              UPDATE pb_article_index
              SET handles = array_replace(handles, ${from}, ${replacement.handle}), updated_at = NOW()
              WHERE article_id = ${t.article_id}
            `;
          }
          processed.push({
            handle: t.handle,
            title: t.title,
            cardsSwapped: swapped.cardsSwapped,
            ok: true,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[product-bullets] swap FAILED ${t.handle}: ${msg}`);
          processed.push({
            handle: t.handle,
            title: t.title,
            cardsSwapped: 0,
            ok: false,
            error: msg,
          });
        }
        await sleep(600);
      }

      if (!dry) {
        await sql`DELETE FROM pb_card_index WHERE handle = ${from}`;
      }

      return NextResponse.json({
        mode,
        dry,
        from,
        to: replacement.handle,
        replacement: {
          title: replacement.title,
          price: replacement.price,
          hasImage: !!replacement.imageUrl,
          usedCuratedBullets: !!replacement.bullets,
        },
        articles: targets.length,
        processed,
        cardsSwapped: processed.reduce((n, p) => n + p.cardsSwapped, 0),
      });
    }

    // ── approve-all ─────────────────────────────────────────────────────────
    /**
     * Bulk-approve every clean draft in one statement.
     *
     * Deliberately scoped to status = 'draft'. Rows sitting at 'needs_input'
     * are the ones where the Shopify description yielded fewer than 2
     * verifiable specs, so they stay untouched for a human to write or accept.
     *
     * This replaces a client loop that fired one request per product. At ~300
     * remaining drafts that was 300 sequential round trips and 300 chances for
     * a tab crash to interrupt the run.
     */
    if (mode === "approve-all") {
      const approved = (await sql`
        UPDATE product_bullets
        SET status = 'approved', updated_at = NOW()
        WHERE status = 'draft' AND jsonb_array_length(bullets) >= 1
        RETURNING handle
      `) as { handle: string }[];

      const [{ left_needs_input }] = (await sql`
        SELECT COUNT(*)::int AS left_needs_input FROM product_bullets WHERE status = 'needs_input'
      `) as { left_needs_input: number }[];
      const [{ total_approved }] = (await sql`
        SELECT COUNT(*)::int AS total_approved FROM product_bullets WHERE status = 'approved'
      `) as { total_approved: number }[];
      const [{ cards_covered }] = (await sql`
        SELECT COALESCE(SUM(card_count), 0)::int AS cards_covered
        FROM product_bullets WHERE status = 'approved'
      `) as { cards_covered: number }[];

      console.log(
        `[product-bullets] bulk approved ${approved.length}; ${total_approved} approved total, ${left_needs_input} left at needs_input`
      );
      return NextResponse.json({
        mode,
        approvedNow: approved.length,
        totalApproved: total_approved,
        leftNeedsInput: left_needs_input,
        cardsCovered: cards_covered,
      });
    }

    // ── draft ───────────────────────────────────────────────────────────────
    if (mode === "draft") {
      const batchSize = Math.min(Math.max(Number(body.batchSize) || 8, 1), 12);

      const queue = (await sql`
        SELECT c.handle, c.template_cards,
               p.title, p.description, p.vendor, p.product_type, p.tags
        FROM pb_card_index c
        JOIN pb_catalog p ON p.handle = c.handle
        LEFT JOIN product_bullets b ON b.handle = c.handle
        WHERE b.handle IS NULL AND c.template_cards > 0
        ORDER BY c.template_cards DESC
        LIMIT ${batchSize}
      `) as (CatalogRow & { template_cards: number })[];

      const [{ remaining }] = (await sql`
        SELECT COUNT(*)::int AS remaining
        FROM pb_card_index c
        JOIN pb_catalog p ON p.handle = c.handle
        LEFT JOIN product_bullets b ON b.handle = c.handle
        WHERE b.handle IS NULL AND c.template_cards > 0
      `) as { remaining: number }[];

      const drafted: {
        handle: string;
        title: string;
        bullets: string[];
        cards: number;
        ok: boolean;
        note?: string;
      }[] = [];

      for (const p of queue) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        try {
          const raw = await callAI(SYSTEM_PROMPT, buildUserPrompt(p), {
            maxTokens: 300,
            timeoutMs: 25_000,
            retryOnTimeout: false,
          });
          const bullets = parseBullets(raw);
          const thin = bullets.length < 2;
          const status = thin ? "needs_input" : "draft";
          const note = thin
            ? `only ${bullets.length} verifiable spec(s) in the Shopify description`
            : null;

          await sql`
            INSERT INTO product_bullets (handle, title, bullets, source, status, card_count, notes, updated_at)
            VALUES (${p.handle}, ${p.title}, ${JSON.stringify(bullets)}::jsonb, 'ai', ${status},
                    ${p.template_cards}, ${note}, NOW())
            ON CONFLICT (handle) DO UPDATE
            SET bullets = ${JSON.stringify(bullets)}::jsonb, title = ${p.title},
                source = 'ai', status = ${status}, card_count = ${p.template_cards},
                notes = ${note}, updated_at = NOW()
          `;
          drafted.push({
            handle: p.handle,
            title: p.title,
            bullets,
            cards: p.template_cards,
            ok: !thin,
            note: note || undefined,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[product-bullets] draft failed for ${p.handle}: ${msg}`);
          drafted.push({
            handle: p.handle,
            title: p.title,
            bullets: [],
            cards: p.template_cards,
            ok: false,
            note: msg.slice(0, 160),
          });
        }
      }

      const left = Math.max(remaining - drafted.length, 0);
      return NextResponse.json({ mode, drafted, remaining: left, done: left === 0 });
    }

    // ── apply ───────────────────────────────────────────────────────────────
    if (mode === "apply") {
      const batchSize = Math.min(Math.max(Number(body.batchSize) || 10, 1), 20);

      const approvedRows = (await sql`
        SELECT handle, bullets FROM product_bullets WHERE status = 'approved'
      `) as { handle: string; bullets: string[] }[];

      const bulletsByHandle: Record<string, string[]> = {};
      for (const r of approvedRows) {
        const b = Array.isArray(r.bullets) ? r.bullets : [];
        // 1 stored spec is enough: the service bullet makes it a 2-bullet card.
        if (b.length >= 1) bulletsByHandle[r.handle] = b;
      }
      const approvedHandles = Object.keys(bulletsByHandle);
      if (approvedHandles.length === 0) {
        return NextResponse.json({
          mode,
          approvedProducts: 0,
          processed: [],
          remaining: 0,
          done: true,
        });
      }

      /**
       * Target articles that feature an approved product and have not been
       * written since the most recent approval. Tracking progress in the DB
       * rather than in the client means a refresh mid-run resumes correctly,
       * and a later batch of approvals automatically re-queues the articles
       * they affect. The GIN index on handles keeps this cheap at 800 articles.
       */
      const targets = (await sql`
        SELECT article_id, blog_id, blog_handle, handle, title
        FROM pb_article_index
        WHERE handles && ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(approvedHandles)}::jsonb))
          AND (applied_at IS NULL
               OR applied_at < (SELECT COALESCE(MAX(updated_at), NOW())
                                FROM product_bullets WHERE status = 'approved'))
        ORDER BY template_cards DESC
        LIMIT ${batchSize}
      `) as {
        article_id: number;
        blog_id: number;
        blog_handle: string;
        handle: string;
        title: string;
      }[];

      const [{ remaining }] = (await sql`
        SELECT COUNT(*)::int AS remaining
        FROM pb_article_index
        WHERE handles && ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(approvedHandles)}::jsonb))
          AND (applied_at IS NULL
               OR applied_at < (SELECT COALESCE(MAX(updated_at), NOW())
                                FROM product_bullets WHERE status = 'approved'))
      `) as { remaining: number }[];

      const processed: {
        articleId: number;
        handle: string;
        title: string;
        rewritten: number;
        removed: number;
        protectedCards: number;
        ok: boolean;
        error?: string;
        dbSynced: boolean;
      }[] = [];

      for (const target of targets) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        try {
          // Re-fetch fresh right before writing; the index can be stale.
          const { json } = await adminRequest(
            `blogs/${target.blog_id}/articles/${target.article_id}.json`
          );
          const fresh: string = json.article?.body_html || "";
          const rewrite = buildCardRewrite(fresh, bulletsByHandle, {
            removeLabels: REMOVE_BULLETS,
            serviceBullet: SERVICE_BULLET,
          });

          if (!rewrite) {
            processed.push({
              articleId: target.article_id,
              handle: target.handle,
              title: target.title,
              rewritten: 0,
              removed: 0,
              protectedCards: 0,
              ok: true,
              dbSynced: false,
            });
            await sql`UPDATE pb_article_index SET applied_at = NOW() WHERE article_id = ${target.article_id}`;
            continue;
          }

          await sleep(500);
          await adminRequest(`blogs/${target.blog_id}/articles/${target.article_id}.json`, {
            method: "PUT",
            body: JSON.stringify({
              article: { id: target.article_id, body_html: rewrite.fixed },
            }),
          });

          let dbSynced = false;
          try {
            await sql`
              UPDATE articles SET html_content = ${rewrite.fixed}, updated_at = NOW()
              WHERE slug = ${target.handle}
            `;
            dbSynced = true;
          } catch (dbErr) {
            console.error(
              `[product-bullets] DB sync failed for ${target.handle} (Shopify already updated):`,
              dbErr
            );
          }

          console.log(
            `[product-bullets] ${target.handle}: ${rewrite.cardsRewritten} rewritten, ${rewrite.cardsProtected} left as written, ${rewrite.removed} flagged bullet(s) removed`
          );
          await sql`UPDATE pb_article_index SET applied_at = NOW() WHERE article_id = ${target.article_id}`;
          processed.push({
            articleId: target.article_id,
            handle: target.handle,
            title: target.title,
            rewritten: rewrite.cardsRewritten,
            removed: rewrite.removed,
            protectedCards: rewrite.cardsProtected,
            ok: true,
            dbSynced,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[product-bullets] FAILED ${target.handle}: ${msg}`);
          processed.push({
            articleId: target.article_id,
            handle: target.handle,
            title: target.title,
            rewritten: 0,
            removed: 0,
            protectedCards: 0,
            ok: false,
            error: msg,
            dbSynced: false,
          });
        }
        await sleep(700);
      }

      const left = Math.max(remaining - processed.length, 0);
      return NextResponse.json({
        mode,
        approvedProducts: approvedHandles.length,
        processed,
        remaining: left,
        done: left === 0 || processed.length === 0,
      });
    }

    return NextResponse.json({ error: `unknown mode "${mode}"` }, { status: 400 });
  } catch (error) {
    console.error("[product-bullets] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "product-bullets failed" },
      { status: 500 }
    );
  }
}
