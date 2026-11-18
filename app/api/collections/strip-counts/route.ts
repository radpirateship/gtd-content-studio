import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

/**
 * POST /api/collections/strip-counts
 *
 * Bulk-removes printed product/brand counts from PUBLISHED collection pages
 * and saved DRAFTS (partner rule, Aug 3 2026: inventory changes weekly, so
 * "[Category] · 11 models · 3 brands" eyebrows and "N models" brand-tile
 * lines go stale immediately). Idempotent — safe to run repeatedly.
 */

export const maxDuration = 300;

const API_VERSION = "2024-10";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eyebrow: "<div class=\"gtd-eyebrow\">Exercise Bikes &middot; 11 models &middot; 4 brands</div>"
// -> keep just the category label. Entity or literal middot both handled.
const EYEBROW_RE = /(<div class="gtd-eyebrow">)([^<]*?)\s*(?:&middot;|·)\s*\d+\s*models?(?:\s*(?:&middot;|·)\s*\d+\s*brands?)?\s*(<\/div>)/gi;
// brand tile "N models" subtitle line
const TILE_RE = /<div class="gtd-btile-sub">\s*\d+\s*models?\s*<\/div>/gi;

function stripCounts(html: string): string {
  return html
    .replace(EYEBROW_RE, (_m, open: string, label: string, close: string) => `${open}${label.trim()}${close}`)
    .replace(TILE_RE, () => "");
}

async function shopifyFetch(path: string, token: string, init: RequestInit = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${API_VERSION}/${path}`, {
      ...init,
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json", ...(init.headers as Record<string, string> || {}) },
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(Number(res.headers.get("retry-after") || 2) * 1000); continue; }
    return null;
  }
  return null;
}

export async function POST() {
  try {
    const sql = getSQL();
    const token = await getShopifyAccessToken();
    let publishedUpdated = 0, draftsUpdated = 0, checked = 0;
    const failures: string[] = [];

    // ── published pages: list bodies in bulk, PUT back only the changed ones ─
    for (const type of ["custom", "smart"] as const) {
      let sinceId = 0;
      for (let page = 0; page < 4; page++) {
        const d = await shopifyFetch(`${type}_collections.json?limit=250&since_id=${sinceId}&fields=id,handle,body_html`, token);
        const list: Array<{ id: number; handle: string; body_html: string | null }> = d?.[`${type}_collections`] || [];
        if (list.length === 0) break;
        for (const c of list) {
          checked++;
          const body = c.body_html || "";
          if (!body.includes("gtd-eyebrow")) continue;
          const stripped = stripCounts(body);
          if (stripped === body) continue;
          const r = await shopifyFetch(`${type}_collections/${c.id}.json`, token, {
            method: "PUT",
            body: JSON.stringify({ [`${type}_collection`]: { id: c.id, body_html: stripped } }),
          });
          if (r) publishedUpdated++;
          else failures.push(c.handle);
          await sleep(600);
        }
        sinceId = list[list.length - 1].id;
        if (list.length < 250) break;
      }
    }

    // ── drafts ───────────────────────────────────────────────────────────────
    const drafts = (await sql`SELECT slug, body_html FROM collection_improve_drafts`) as Array<{ slug: string; body_html: string | null }>;
    for (const d of drafts) {
      const body = d.body_html || "";
      if (!body.includes("gtd-eyebrow")) continue;
      const stripped = stripCounts(body);
      if (stripped === body) continue;
      await sql`UPDATE collection_improve_drafts SET body_html = ${stripped} WHERE slug = ${d.slug}`;
      draftsUpdated++;
    }

    return NextResponse.json({ ok: true, checked, publishedUpdated, draftsUpdated, failures: failures.slice(0, 20) });
  } catch (error) {
    console.error("[collections/strip-counts] Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "strip failed" }, { status: 500 });
  }
}
