// app/api/collections/create-brand-collections/route.ts
//
// POST /api/collections/create-brand-collections
//   body: { vendors: Array<string | { vendor: string; category?: string }>, confirm?: boolean, publish?: boolean }
//   category (optional, one of the five hubs) pins the queue row's category;
//   otherwise it is guessed from the vendor's product types.
//
// Creates a vendor-rule smart collection for each vendor that has products but
// no brand collection yet (James's convention: title = exact vendor string,
// rule VENDOR EQUALS <vendor>, handle = slugified vendor), then registers the
// collection in the content queue (ppw_collections) tagged as a brand page so
// the collection copy generator picks it up.
//
// Dry run unless confirm is true. The dry run reports, per vendor: product
// counts, whether a collection already exists on Shopify (by handle or by an
// identical vendor rule), and whether a queue row exists. Vendors with an
// existing collection are never duplicated; their queue row is stamped with
// the live id instead. Backed by /brand-collections-create.

import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ensureCollectionColumns } from "@/lib/ensureCollectionColumns";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import { guessCategory, asHub } from "@/lib/collection-category";

export const maxDuration = 120;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];
const STOREFRONT = "https://peakprimalwellness.com";

type Existing = { id: number; type: "custom" | "smart"; handle: string; title: string; published: boolean; via: "handle" | "rule" };

type Report = {
  vendor: string;
  slug: string;
  path: string;
  products: { total: number; live: number; types: Record<string, number> };
  existing: Existing | null;
  queueRow: { exists: boolean; shopifyId: string | null; primaryKeyword: string | null; category: string | null } | null;
  category: string;
  plan: string[];
  blockers: string[];
  result?: {
    created?: { id: number; handle: string; title: string; published: boolean } | string;
    handleDrifted?: boolean;
    queue?: "inserted" | "updated" | string;
    storefront?: { status: number };
  };
};

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function shopifyFetch(path: string, options: RequestInit = {}) {
  const token = await getShopifyAccessToken();
  const errors: string[] = [];
  for (const version of API_VERSIONS) {
    const url = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
            ...((options.headers as Record<string, string>) || {}),
          },
        });
        if (res.ok) return { ok: true as const, data: (await res.json()) as Record<string, any>, version };
        if (res.status === 429 || res.status >= 500) {
          const wait = Math.min(10, Number(res.headers.get("retry-after")) || 2);
          errors.push(`${version}: ${res.status} (attempt ${attempt + 1}, waiting ${wait}s)`);
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
        const body = await res.text();
        errors.push(`${version}: ${res.status} - ${body.slice(0, 200)}`);
        if (res.status === 401 || res.status === 403) throw new Error(`Shopify auth failed (${res.status})`);
        if (res.status === 422) return { ok: false as const, data: null, errors };
        break;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        break;
      }
    }
  }
  return { ok: false as const, data: null, errors };
}

async function findExisting(vendor: string, slug: string): Promise<Existing | null> {
  for (const type of ["custom", "smart"] as const) {
    const r = await shopifyFetch(`${type}_collections.json?handle=${encodeURIComponent(slug)}&limit=1`);
    if (!r.ok) continue;
    const list = (r.data[`${type}_collections`] as Array<Record<string, any>>) || [];
    const c = list.find((x) => x.handle === slug);
    if (c) return { id: Number(c.id), type, handle: slug, title: String(c.title || ""), published: c.published_at != null, via: "handle" };
  }
  // A collection with the same vendor rule under a different handle (e.g. one
  // James made by hand with a ® in the title) still counts as existing.
  const r = await shopifyFetch(`smart_collections.json?title=${encodeURIComponent(vendor)}&limit=5`);
  if (r.ok) {
    const list = (r.data.smart_collections as Array<Record<string, any>>) || [];
    for (const c of list) {
      const rules = (c.rules as Array<Record<string, string>>) || [];
      const vendorRule = rules.length === 1 && rules[0].column === "vendor" && rules[0].relation === "equals" && rules[0].condition.toLowerCase() === vendor.toLowerCase();
      if (vendorRule) return { id: Number(c.id), type: "smart", handle: String(c.handle), title: String(c.title || ""), published: c.published_at != null, via: "rule" };
    }
  }
  return null;
}

async function vendorProducts(vendor: string): Promise<{ total: number; live: number; types: Record<string, number> }> {
  const r = await shopifyFetch(`products.json?vendor=${encodeURIComponent(vendor)}&limit=250&fields=id,product_type,published_at,status`);
  if (!r.ok) return { total: 0, live: 0, types: {} };
  const list = (r.data.products as Array<Record<string, any>>) || [];
  const types: Record<string, number> = {};
  let live = 0;
  for (const p of list) {
    const t = String(p.product_type || "").trim() || "(no type)";
    types[t] = (types[t] || 0) + 1;
    if (p.published_at != null && p.status === "active") live++;
  }
  return { total: list.length, live, types };
}

function categoryFromTypes(types: Record<string, number>): string {
  const ranked = Object.entries(types).sort((a, b) => b[1] - a[1]);
  for (const [t] of ranked) {
    const guess = guessCategory(slugify(t));
    if (guess !== "Unsorted") return guess;
  }
  return "Unsorted";
}

async function storefrontStatus(path: string): Promise<{ status: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${STOREFRONT}${path}.json`, { redirect: "manual", cache: "no-store" });
      if (res.status === 200) return { status: 200 };
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      else return { status: res.status };
    } catch {
      if (attempt === 2) return { status: 0 };
    }
  }
  return { status: 0 };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      vendors?: Array<string | { vendor?: string; category?: string }>;
      confirm?: boolean;
      publish?: boolean;
    };
    const pinned = new Map<string, string>();
    const vendors: string[] = [];
    for (const v of body.vendors || []) {
      const name = (typeof v === "string" ? v : v?.vendor || "").trim();
      if (!name || vendors.includes(name)) continue;
      vendors.push(name);
      if (typeof v !== "string" && v.category) {
        const hub = asHub(v.category);
        if (!hub) return NextResponse.json({ error: `Unknown category "${v.category}" for ${name}; use Saunas, Recovery, Fitness, Clinical or Wellness` }, { status: 400 });
        pinned.set(name, hub);
      }
    }
    const confirm = body.confirm === true;
    const publish = body.publish !== false;
    if (vendors.length === 0) return NextResponse.json({ error: "vendors[] is required" }, { status: 400 });
    if (vendors.length > 40) return NextResponse.json({ error: "Max 40 vendors per run" }, { status: 400 });

    const sql = getSQL();
    await ensureCollectionColumns(sql);

    const reports: Report[] = [];
    for (const vendor of vendors) {
      const slug = slugify(vendor);
      const path = `/collections/${slug}`;
      const [products, existing, rows] = await Promise.all([
        vendorProducts(vendor),
        findExisting(vendor, slug),
        sql`SELECT slug, shopify_collection_id, primary_keyword, category FROM ppw_collections WHERE slug = ${slug}` as Promise<Array<Record<string, any>>>,
      ]);
      const row = rows[0] || null;
      const queueRow = row
        ? { exists: true, shopifyId: row.shopify_collection_id ? String(row.shopify_collection_id) : null, primaryKeyword: row.primary_keyword ?? null, category: row.category ?? null }
        : { exists: false, shopifyId: null, primaryKeyword: null, category: null };
      const category = pinned.get(vendor) || (row?.category && String(row.category).trim() ? String(row.category) : categoryFromTypes(products.types));

      const plan: string[] = [];
      const blockers: string[] = [];
      if (!slug) blockers.push("Vendor name produces an empty handle");
      if (existing) {
        blockers.push(`A ${existing.type} collection already exists: /collections/${existing.handle} (id ${existing.id}, ${existing.published ? "published" : "unpublished"}, matched by ${existing.via})`);
        plan.push(queueRow.exists ? "Stamp the queue row with the live collection id" : "Register the existing collection in the queue as a brand page");
      } else {
        if (products.total === 0) blockers.push("No products carry this vendor string in Shopify; check the spelling against the product vendor field");
        plan.push(`Create smart collection "${vendor}" at ${path} with rule VENDOR EQUALS "${vendor}" (${publish ? "published" : "unpublished"})`);
        plan.push(queueRow.exists ? `Update queue row ${slug} (brand, category ${category})` : `Insert queue row ${slug} (brand, category ${category}, primary keyword "${vendor.toLowerCase()}")`);
      }

      const report: Report = { vendor, slug, path, products, existing, queueRow, category, plan, blockers };
      reports.push(report);
      if (!confirm) continue;

      const result: Report["result"] = {};
      report.result = result;

      let liveId: number | null = null;
      let liveHandle = slug;
      let livePublished = false;
      if (existing) {
        liveId = existing.id;
        liveHandle = existing.handle;
        livePublished = existing.published;
        result.created = `skipped, exists (id ${existing.id})`;
      } else if (products.total === 0 || !slug) {
        result.created = "skipped: " + blockers.join("; ");
        continue;
      } else {
        const r = await shopifyFetch("smart_collections.json", {
          method: "POST",
          body: JSON.stringify({
            smart_collection: {
              title: vendor,
              handle: slug,
              published: publish,
              disjunctive: false,
              rules: [{ column: "vendor", relation: "equals", condition: vendor }],
            },
          }),
        });
        if (!r.ok) {
          result.created = `failed: ${(r.errors || []).join(" | ")}`;
          continue;
        }
        const c = r.data.smart_collection as Record<string, any>;
        liveId = Number(c.id);
        liveHandle = String(c.handle);
        livePublished = c.published_at != null;
        result.created = { id: liveId, handle: liveHandle, title: String(c.title), published: livePublished };
        result.handleDrifted = liveHandle !== slug;
      }

      const url = `${STOREFRONT}/collections/${liveHandle}`;
      const ruleSummary = `ALL: VENDOR EQUALS ${vendor}`;
      const status = livePublished ? "Created, published, needs content" : "Created, unpublished";
      try {
        if (queueRow.exists) {
          await sql`
            UPDATE ppw_collections SET
              shopify_collection_id = ${String(liveId)},
              url = ${url},
              collection_type = 'brand',
              category = ${pinned.has(vendor) ? category : sql`COALESCE(NULLIF(category, ''), ${category})`},
              primary_keyword = COALESCE(NULLIF(primary_keyword, ''), ${vendor.toLowerCase()}),
              rule_summary = COALESCE(NULLIF(rule_summary, ''), ${ruleSummary}),
              product_count = ${products.live},
              is_published = ${livePublished},
              is_hidden = FALSE,
              status = COALESCE(NULLIF(status, ''), ${status}),
              last_synced_at = NOW()
            WHERE slug = ${slug}
          `;
          result.queue = "updated";
        } else {
          await sql`
            INSERT INTO ppw_collections
              (slug, url, category, collection_type, primary_keyword, secondary_keywords, rule_summary,
               shopify_collection_id, product_count, is_published, is_hidden, status, last_synced_at)
            VALUES
              (${liveHandle}, ${url}, ${category}, 'brand', ${vendor.toLowerCase()}, ${[] as string[]}, ${ruleSummary},
               ${String(liveId)}, ${products.live}, ${livePublished}, FALSE, ${status}, NOW())
            ON CONFLICT (slug) DO UPDATE SET
              shopify_collection_id = EXCLUDED.shopify_collection_id,
              collection_type = 'brand',
              is_published = EXCLUDED.is_published,
              last_synced_at = NOW()
          `;
          result.queue = "inserted";
        }
      } catch (err) {
        result.queue = `failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      if (livePublished) result.storefront = await storefrontStatus(`/collections/${liveHandle}`);
    }

    const summary = {
      vendors: reports.length,
      wouldCreate: reports.filter((r) => !r.existing && r.blockers.length === 0).length,
      alreadyExist: reports.filter((r) => r.existing).length,
      blocked: reports.filter((r) => !r.existing && r.blockers.length > 0).length,
      created: reports.filter((r) => r.result && typeof r.result.created === "object").length,
      queued: reports.filter((r) => r.result && (r.result.queue === "inserted" || r.result.queue === "updated")).length,
    };
    return NextResponse.json({ dryRun: !confirm, publish, summary, reports });
  } catch (err) {
    console.error("[collections/create-brand-collections]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Create failed" }, { status: 500 });
  }
}
