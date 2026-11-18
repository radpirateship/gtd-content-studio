import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

/**
 * POST /api/collections/repair-draft-seo
 *
 * One-time repair for drafts generated while SEO tag reading was broken
 * (pagination past 50 metafields + the "must contain a pipe" rule that
 * discarded colon-style tags). For every saved draft: re-read the LIVE
 * title/description tags from Shopify; if the draft's seo_title is a
 * fabricated "[X] | Peak Primal Wellness" or the bare collection title while
 * a real live tag exists, restore the live tag into the draft. Generated
 * meta descriptions are kept (they're intentional); only empty ones are
 * back-filled from live. Safe to run repeatedly.
 */

export const maxDuration = 300;

const API_VERSION = "2024-10";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shopifyGet(path: string, token: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${API_VERSION}/${path}`, {
      headers: { "X-Shopify-Access-Token": token },
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
    const drafts = (await sql`SELECT slug, seo_title, seo_description FROM collection_improve_drafts`) as Array<{ slug: string; seo_title: string | null; seo_description: string | null }>;
    let repairedTitles = 0, filledDescs = 0, checked = 0;
    const log: string[] = [];

    for (const d of drafts) {
      checked++;
      let collection: { id: number; title: string } | null = null;
      for (const type of ["custom", "smart"] as const) {
        const r = await shopifyGet(`${type}_collections.json?handle=${encodeURIComponent(d.slug)}&limit=1`, token);
        const hit = r?.[`${type}_collections`]?.[0];
        if (hit) { collection = hit; break; }
      }
      if (!collection) { log.push(`${d.slug}: not found on Shopify`); continue; }
      const mf = await shopifyGet(`collections/${collection.id}/metafields.json?limit=250`, token);
      const metafields: Array<{ namespace: string; key: string; value: string }> = mf?.metafields || [];
      const pick = (keys: string[]) => {
        for (const key of keys) {
          const v = metafields.find((m) => m.namespace === "global" && m.key === key)?.value ||
            metafields.find((m) => m.key === key)?.value;
          if (v) return v;
        }
        return undefined;
      };
      const liveTitle = (pick(["title_tag", "seo_title", "meta_title"]) || "").trim();
      const liveDesc = (pick(["description_tag", "seo_description", "meta_description"]) || "").trim();
      const bare = (collection.title || "").trim().toLowerCase();

      const draftTitle = (d.seo_title || "").trim();
      const fabricated = draftTitle === "" ||
        draftTitle.toLowerCase() === bare ||
        /\|\s*peak primal wellness\s*$/i.test(draftTitle);
      if (liveTitle && liveTitle.toLowerCase() !== bare && fabricated && draftTitle !== liveTitle) {
        await sql`UPDATE collection_improve_drafts SET seo_title = ${liveTitle} WHERE slug = ${d.slug}`;
        repairedTitles++;
        log.push(`${d.slug}: title "${draftTitle.slice(0, 40)}" -> "${liveTitle.slice(0, 50)}"`);
      }
      if (liveDesc && !(d.seo_description || "").trim()) {
        await sql`UPDATE collection_improve_drafts SET seo_description = ${liveDesc} WHERE slug = ${d.slug}`;
        filledDescs++;
      }
      await sleep(600); // pace Shopify
    }

    return NextResponse.json({ ok: true, checked, repairedTitles, filledDescs, log: log.slice(0, 60) });
  } catch (error) {
    console.error("[collections/repair-draft-seo] Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "repair failed" }, { status: 500 });
  }
}
