// POST /api/content-brain/ideas/bulk-csv
// Bulk-add planned ideas to Content Brain from the research CSV format
// (title, keyword, collection, articleType, audience, tone, wordCount,
//  includeComparisonTable, specialInstructions, priority, titleTag,
//  metaDescription, shopifySlug [, targetBrand, targetSubcollection]).
//
// Rows land as status='planned', source='bulk-csv'. They NEVER auto-generate —
// you review/confirm collection mapping in Content Brain before pushing to
// bulk generation. Accepts either a multipart file upload or a JSON {rows:[...]}.
import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { MASTER_COLLECTIONS } from "@/lib/collections";
import { asHub } from "@/lib/collection-category";

export const maxDuration = 60;

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// collection label/slug/handle -> { collection_slug, hub }
//
// Resolved against the SYNCED collections table first (gtd_collections, kept
// current from Shopify by /api/collections/sync-shopify), so any live
// collection is accepted and its hub is the synced category, which includes
// Clinical. The static MASTER_COLLECTIONS array is the fallback for when the
// table is unreachable. Previously only the static array was consulted, so a
// row filed under a newer collection got no hub and a guessed slug.
type SyncedColl = { slug: string; category: string | null; title_tag: string | null; primary_keyword: string | null };
let syncedCache: { at: number; rows: SyncedColl[] } | null = null;
async function loadSynced(): Promise<SyncedColl[]> {
  if (syncedCache && Date.now() - syncedCache.at < 5 * 60 * 1000) return syncedCache.rows;
  try {
    const sql = getSQL();
    const rows = Array.from(await sql`SELECT slug, category, title_tag, primary_keyword FROM gtd_collections WHERE COALESCE(is_hidden, false) = false`) as SyncedColl[];
    syncedCache = { at: Date.now(), rows };
    return rows;
  } catch {
    return [];
  }
}
const labelOf = (c: SyncedColl) =>
  (c.title_tag || "").split(/[|\-–:]/)[0].trim() || c.slug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

async function resolveCollection(input: string): Promise<{ collection: string; collection_slug: string | null; hub: string | null }> {
  const norm = (input || "").trim();
  if (!norm) return { collection: "", collection_slug: null, hub: null };
  const lower = norm.toLowerCase();
  const asSlug = slugify(norm);
  const synced = await loadSynced();
  const live = synced.find((c) => c.slug === lower || c.slug === asSlug || labelOf(c).toLowerCase() === lower);
  if (live) {
    const master = MASTER_COLLECTIONS.find((m) => m.slug === live.slug || m.shopifyHandle === live.slug);
    return { collection: master?.label || labelOf(live), collection_slug: live.slug, hub: asHub(live.category) || master?.hub || null };
  }
  const match = MASTER_COLLECTIONS.find(
    (c: { slug: string; label: string; shopifyHandle: string; hub: string }) =>
      c.label.toLowerCase() === lower || c.slug === lower || c.shopifyHandle === lower || c.slug === asSlug
  );
  if (match) return { collection: match.label, collection_slug: match.shopifyHandle, hub: match.hub };
  return { collection: norm, collection_slug: asSlug, hub: null };
}

/**
 * Pick the most specific live collection for a title and keyword, for rows
 * that leave targetSubcollection blank. Every slug word must appear; a slug
 * fully inside the keyword beats one that only matches the title; more words
 * beat fewer. Returns null when nothing fits, so the caller keeps the main
 * collection as before.
 */
function pickSubcollection(title: string, keyword: string, synced: SyncedColl[]): string | null {
  const n = (t: string) => ` ${(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const hay = n(`${title} ${keyword}`);
  const kw = n(keyword);
  const sing = (w: string) => w.replace(/s$/, "");
  const has = (t: string, w: string) => t.includes(` ${w} `) || t.includes(` ${sing(w)} `) || t.includes(` ${w}s `);
  let best: { slug: string; score: number } | null = null;
  for (const c of synced) {
    const words = c.slug.split("-").filter((w) => w.length > 2);
    if (!words.length || !words.every((w) => has(hay, w))) continue;
    const score = (words.every((w) => has(kw, w)) ? 100 : 0) + words.length * 10;
    if (!best || score > best.score) best = { slug: c.slug, score };
  }
  return best?.slug ?? null;
}

const truthy = (v: string) => /^(true|yes|1|y)$/i.test((v || "").trim());

type Row = Record<string, string>;

function rowsFromCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const r: Row = {};
    headers.forEach((h, idx) => { r[h] = (vals[idx] ?? "").trim(); });
    rows.push(r);
  }
  return rows;
}

export async function POST(req: NextRequest) {
  const sql = getSQL();
  try {
    // Ensure every column this route writes exists (idempotent) — different
    // content_brain migrations applied different subsets, so don't assume.
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS target_brand TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS ultimate_guide_url TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS ultimate_guide_title TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS target_subcollection TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS meta_title TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS description TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS article_type TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS audience TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS tone TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS word_count INTEGER`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS include_comparison_table BOOLEAN DEFAULT FALSE`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS special_instructions TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS priority TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS content_type TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS traffic_light TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS url_slug TEXT`;
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS collection_slug TEXT`;

    let rows: Row[] = [];
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      rows = Array.isArray(body.rows) ? body.rows : [];
    } else {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
      rows = rowsFromCsv(await file.text());
    }

    if (rows.length === 0) return NextResponse.json({ error: "No rows found" }, { status: 400 });

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const results: Array<{ title: string; action: string; collection_slug: string | null }> = [];

    for (const r of rows) {
      // Case/format-insensitive header access: "secondaryCollection",
      // "secondarycollection", "secondary_collection", "Secondary Collection"
      // all resolve to the same value. No header casing is required.
      const nmap: Record<string, string> = {};
      for (const k of Object.keys(r)) {
        const nk = k.toLowerCase().replace(/[\s_-]+/g, "");
        if (r[k] != null && String(r[k]) !== "") nmap[nk] = String(r[k]);
      }
      const g = (...keys: string[]): string => {
        for (const k of keys) {
          const v = nmap[k.toLowerCase().replace(/[\s_-]+/g, "")];
          if (v !== undefined && v !== "") return v;
        }
        return "";
      };

      const title = g("title");
      if (!title) { skipped++; continue; }

      const coll = await resolveCollection(g("collection"));
      // Explicit hub in the CSV wins; otherwise the synced category.
      const hubOverride = g("hub");
      if (hubOverride) coll.hub = asHub(hubOverride) || coll.hub;
      // shopifySlug may be a full path (/blogs/guides/handle) — keep just the handle.
      const rawSlug = g("shopifySlug", "slug");
      const url_slug = rawSlug ? rawSlug.split("/").filter(Boolean).pop() || slugify(title) : slugify(title);
      const wordCount = parseInt(g("wordCount", "word_count"), 10);

      const fields = {
        title,
        keyword: g("keyword") || null,
        hub: coll.hub,
        collection: coll.collection || null,
        collection_slug: coll.collection_slug,
        article_type: g("articleType", "article_type") || null,
        audience: g("audience") || null,
        tone: g("tone") || null,
        word_count: Number.isFinite(wordCount) ? wordCount : 2500,
        include_comparison_table: truthy(g("includeComparisonTable", "include_comparison_table")),
        special_instructions: g("specialInstructions", "special_instructions") || null,
        priority: g("priority") || null,
        meta_title: g("titleTag", "meta_title") || null,
        description: g("metaDescription", "description") || null,
        url_slug,
        target_brand: g("targetBrand", "target_brand") || null,
        // Per-row ultimate guide, for a cluster whose guide is not yet on the
        // collection record. Handle or /pages/ path; normalised to a path.
        ultimate_guide_url: (() => {
          const raw = g("ultimateGuideUrl", "ultimateGuide", "ultimate_guide_url", "ultimateGuideSlug").trim();
          if (!raw) return null;
          const path = raw.replace(/^https?:\/\/(www\.)?greenthumbdepot\.com/i, "");
          return path.startsWith("/") ? path : `/pages/${path.replace(/^pages\//, "")}`;
        })(),
        ultimate_guide_title: g("ultimateGuideTitle", "ultimate_guide_title") || null,
        // Products come from here. Blank means: pick the most specific live
        // collection the title and keyword name, else the main collection.
        target_subcollection:
          (await resolveCollection(g("secondaryCollection", "targetSubcollection", "target_subcollection", "productCollection"))).collection_slug
          || pickSubcollection(title, g("keyword"), await loadSynced())
          || coll.collection_slug,
      };

      // Dedupe on url_slug (or title) — update existing, otherwise insert.
      // On update, hub and collection only move when the new push resolved
      // them. A re-push with hub left blank used to write NULL over a hub that
      // was already correct (the 10 home gym rows, 21 Aug).
      const existing = await sql`SELECT id FROM content_brain WHERE url_slug = ${url_slug} OR title = ${title} LIMIT 1`;
      if (existing.length > 0) {
        const id = existing[0].id;
        await sql`
          UPDATE content_brain SET
            keyword = ${fields.keyword},
            hub = COALESCE(${fields.hub}, hub),
            collection = COALESCE(NULLIF(${fields.collection}, ''), collection),
            collection_slug = COALESCE(${fields.collection_slug}, collection_slug),
            article_type = ${fields.article_type},
            audience = ${fields.audience}, tone = ${fields.tone}, word_count = ${fields.word_count},
            include_comparison_table = ${fields.include_comparison_table},
            special_instructions = ${fields.special_instructions}, priority = ${fields.priority},
            meta_title = ${fields.meta_title}, description = ${fields.description},
            target_brand = ${fields.target_brand}, target_subcollection = ${fields.target_subcollection},
            ultimate_guide_url = COALESCE(${fields.ultimate_guide_url}, ultimate_guide_url),
            ultimate_guide_title = COALESCE(${fields.ultimate_guide_title}, ultimate_guide_title),
            status = 'review',
            updated_at = NOW()
          WHERE id = ${id}
        `;
        updated++;
        results.push({ title, action: "updated", collection_slug: fields.collection_slug });
      } else {
        await sql`
          INSERT INTO content_brain (
            title, keyword, hub, collection, collection_slug, content_type,
            article_type, audience, tone, word_count, include_comparison_table,
            special_instructions, priority, status, traffic_light, source,
            meta_title, description, url_slug, target_brand, target_subcollection,
            ultimate_guide_url, ultimate_guide_title
          ) VALUES (
            ${fields.title}, ${fields.keyword}, ${fields.hub}, ${fields.collection},
            ${fields.collection_slug}, 'cluster', ${fields.article_type}, ${fields.audience},
            ${fields.tone}, ${fields.word_count}, ${fields.include_comparison_table},
            ${fields.special_instructions}, ${fields.priority}, 'review', 'unvetted', 'bulk-csv',
            ${fields.meta_title}, ${fields.description}, ${fields.url_slug},
            ${fields.target_brand}, ${fields.target_subcollection},
            ${fields.ultimate_guide_url}, ${fields.ultimate_guide_title}
          )
        `;
        inserted++;
        results.push({ title, action: "inserted", collection_slug: fields.collection_slug });
      }
    }

    return NextResponse.json({
      ok: true,
      inserted,
      updated,
      skipped,
      total: rows.length,
      message: `Added ${inserted} new + updated ${updated} planned ideas (${skipped} skipped). Review their collections in Content Brain before generating.`,
      results,
    });
  } catch (err) {
    console.error("[content-brain/ideas/bulk-csv]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Bulk add failed" }, { status: 500 });
  }
}
