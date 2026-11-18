/**
 * GET  /api/products/add-tag?tag=walking-pads   — who already has the tag
 * POST /api/products/add-tag                    — add one tag to named products
 *
 * Built for the walking-pads collection: the walking pads are all tagged
 * "treadmills" and need a second tag so a smart collection can pick them up
 * WITHOUT taking them out of treadmills, which stays the parent.
 *
 * Uses Shopify's `tagsAdd` mutation, which is purely additive. There is no
 * code path here that removes a tag, changes a collection, edits a product, or
 * touches publish state. The worst case for a mistake is one extra tag on one
 * product, removable in the Shopify admin in a click.
 *
 * Gates:
 *   1. POST must carry confirm: "APPLY".
 *   2. productIds must be given explicitly. It never selects its own targets.
 *   3. One tag per call, validated as a plain handle-ish string.
 *   4. dryRun (the default) reports what would change and writes nothing.
 *   5. Products that already carry the tag are reported as skipped, so the
 *      whole thing is re-runnable.
 */
import { type NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

const GRAPHQL_VERSION = "2024-10";
const TAG_RE = /^[a-z0-9][a-z0-9 \-_]{0,48}[a-z0-9]$/i;

async function adminGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = await getShopifyAccessToken();
  const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${GRAPHQL_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify GraphQL HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  if (!json.data) throw new Error("Shopify GraphQL returned no data");
  return json.data;
}

const NODES_QUERY = `
  query Nodes($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { id title handle vendor tags status } }
  }
`;

const TAGS_ADD = `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
  }
`;

const BY_TAG_QUERY = `
  query ByTag($q: String!, $cursor: String) {
    products(first: 250, query: $q, after: $cursor) {
      nodes { id title handle vendor tags }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type ProductNode = { id: string; title: string; handle: string; vendor: string; tags: string[]; status?: string };

/** Normalise "8041455517814" or a full gid into a product gid. */
function toGid(id: string): string | null {
  const s = String(id).trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return null;
}

export async function GET(request: NextRequest) {
  const tag = request.nextUrl.searchParams.get("tag") || "";
  if (!TAG_RE.test(tag)) return NextResponse.json({ error: "Pass ?tag=<tag>" }, { status: 400 });
  try {
    const out: ProductNode[] = [];
    let cursor: string | null = null;
    do {
      const d: { products: { nodes: ProductNode[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } =
        await adminGraphql(BY_TAG_QUERY, { q: `tag:'${tag.replace(/'/g, "")}'`, cursor });
      out.push(...d.products.nodes);
      cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    } while (cursor);
    return NextResponse.json({ ok: true, tag, count: out.length, products: out });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "lookup failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const tag = String(body.tag || "").trim();
    const dryRun = body.dryRun !== false;
    const ids: string[] = Array.isArray(body.productIds) ? body.productIds.map(String) : [];

    if (!TAG_RE.test(tag)) {
      return NextResponse.json({ error: `Invalid tag "${tag}". Letters, numbers, spaces, hyphens and underscores only.` }, { status: 400 });
    }
    if (!ids.length) {
      return NextResponse.json({ error: "productIds is required. This route never picks its own targets." }, { status: 400 });
    }
    if (!dryRun && body.confirm !== "APPLY") {
      return NextResponse.json({ error: 'Writing requires confirm: "APPLY".' }, { status: 400 });
    }

    const gids = ids.map(toGid);
    const bad = ids.filter((_, i) => !gids[i]);
    if (bad.length) return NextResponse.json({ error: `Not product ids: ${bad.join(", ")}` }, { status: 400 });

    // Read current state so the diff is real, not assumed.
    const found: ProductNode[] = [];
    for (let i = 0; i < gids.length; i += 100) {
      const d = await adminGraphql<{ nodes: (ProductNode | null)[] }>(NODES_QUERY, { ids: gids.slice(i, i + 100) });
      for (const n of d.nodes) if (n) found.push(n);
    }
    const missing = gids.filter((g) => !found.some((f) => f.id === g));
    if (missing.length) {
      return NextResponse.json({ error: `These product ids do not exist: ${missing.join(", ")}` }, { status: 400 });
    }

    const needs = found.filter((p) => !p.tags.map((t) => t.toLowerCase()).includes(tag.toLowerCase()));
    const already = found.filter((p) => !needs.includes(p));

    if (dryRun) {
      return NextResponse.json({
        ok: true, mode: "dryRun", tag,
        wouldTag: needs.length, alreadyTagged: already.length,
        note: 'Nothing changed. POST again with dryRun:false and confirm:"APPLY" to write.',
        products: needs.map((p) => ({ id: p.id, title: p.title, currentTags: p.tags })),
      });
    }

    const results: Array<{ id: string; title: string; result: string }> = [];
    for (const p of needs) {
      const d = await adminGraphql<{ tagsAdd: { userErrors: Array<{ message: string }> } }>(TAGS_ADD, { id: p.id, tags: [tag] });
      const errs = d.tagsAdd.userErrors;
      results.push({ id: p.id, title: p.title, result: errs.length ? `FAILED: ${errs.map((e) => e.message).join("; ")}` : "tagged" });
    }
    return NextResponse.json({
      ok: true, mode: "applied", tag,
      tagged: results.filter((r) => r.result === "tagged").length,
      failed: results.filter((r) => r.result !== "tagged").length,
      skippedAlreadyTagged: already.length,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "tag write failed" }, { status: 500 });
  }
}
