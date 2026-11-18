/**
 * GET  /api/products/collection-membership?handle=treadmills
 *        Reports whether a collection is SMART (rule-driven) or MANUAL, its
 *        rules if smart, and its current product count. Read-only.
 *
 * POST /api/products/collection-membership
 *        { handle, productIds, confirm: "APPLY", dryRun }
 *        Adds products to a MANUAL collection. Refuses a smart collection
 *        outright, because membership there is decided by rules and the honest
 *        fix is to satisfy the rule (usually a tag), not to force the join.
 *
 * Only ever ADDS. There is no path here that removes a product from a
 * collection, reorders one, or edits a product.
 */
import { type NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

const GRAPHQL_VERSION = "2024-10";

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
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

const COLLECTION_QUERY = `
  query Coll($handle: String!) {
    collectionByHandle(handle: $handle) {
      id
      title
      handle
      productsCount { count }
      ruleSet { appliedDisjunctively rules { column relation condition } }
    }
  }
`;

const ADD = `
  mutation Add($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      userErrors { field message }
    }
  }
`;

type Coll = {
  id: string; title: string; handle: string;
  productsCount: { count: number } | null;
  ruleSet: { appliedDisjunctively: boolean; rules: Array<{ column: string; relation: string; condition: string }> } | null;
};

function toGid(id: string): string | null {
  const s = String(id).trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return null;
}

export async function GET(request: NextRequest) {
  const handle = request.nextUrl.searchParams.get("handle") || "";
  if (!handle) return NextResponse.json({ error: "Pass ?handle=<collection-handle>" }, { status: 400 });
  try {
    const d = await gql<{ collectionByHandle: Coll | null }>(COLLECTION_QUERY, { handle });
    const c = d.collectionByHandle;
    if (!c) return NextResponse.json({ error: `No collection with handle "${handle}"` }, { status: 404 });
    return NextResponse.json({
      ok: true,
      handle: c.handle,
      title: c.title,
      id: c.id,
      type: c.ruleSet ? "smart" : "manual",
      productCount: c.productsCount?.count ?? null,
      matchMode: c.ruleSet ? (c.ruleSet.appliedDisjunctively ? "any rule" : "all rules") : null,
      rules: c.ruleSet?.rules ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "lookup failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const handle = String(body.handle || "").trim();
    const dryRun = body.dryRun !== false;
    const ids: string[] = Array.isArray(body.productIds) ? body.productIds.map(String) : [];

    if (!handle) return NextResponse.json({ error: "handle is required" }, { status: 400 });
    if (!ids.length) return NextResponse.json({ error: "productIds is required" }, { status: 400 });
    if (!dryRun && body.confirm !== "APPLY") {
      return NextResponse.json({ error: 'Writing requires confirm: "APPLY".' }, { status: 400 });
    }

    const gids = ids.map(toGid);
    const bad = ids.filter((_, i) => !gids[i]);
    if (bad.length) return NextResponse.json({ error: `Not product ids: ${bad.join(", ")}` }, { status: 400 });

    const d = await gql<{ collectionByHandle: Coll | null }>(COLLECTION_QUERY, { handle });
    const c = d.collectionByHandle;
    if (!c) return NextResponse.json({ error: `No collection with handle "${handle}"` }, { status: 404 });

    if (c.ruleSet) {
      return NextResponse.json(
        {
          error: `"${handle}" is a SMART collection. Products cannot be added to it directly; membership follows its rules. Satisfy the rule instead (usually by adding a tag).`,
          matchMode: c.ruleSet.appliedDisjunctively ? "any rule" : "all rules",
          rules: c.ruleSet.rules,
        },
        { status: 400 }
      );
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true, mode: "dryRun", handle, collectionId: c.id, type: "manual",
        currentProductCount: c.productsCount?.count ?? null,
        wouldAdd: gids.length,
        note: 'Nothing changed. POST again with dryRun:false and confirm:"APPLY".',
      });
    }

    const r = await gql<{ collectionAddProducts: { userErrors: Array<{ message: string }> } }>(ADD, {
      id: c.id,
      productIds: gids,
    });
    const errs = r.collectionAddProducts.userErrors;
    if (errs.length) {
      return NextResponse.json({ error: `Shopify refused: ${errs.map((e) => e.message).join("; ")}` }, { status: 400 });
    }
    const after = await gql<{ collectionByHandle: Coll | null }>(COLLECTION_QUERY, { handle });
    return NextResponse.json({
      ok: true, mode: "applied", handle,
      added: gids.length,
      productCountBefore: c.productsCount?.count ?? null,
      productCountAfter: after.collectionByHandle?.productsCount?.count ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "add failed" }, { status: 500 });
  }
}
