/**
 * POST /api/products/set-product-type
 *   { productType, productIds, confirm: "APPLY", dryRun }
 *
 * Sets productType on named products. House convention is that the main
 * collections are driven by product type and tags carry the specifics
 * ("Sauna" as the type, "infrared" as the tag), so a product missing from a
 * main collection is usually a product-type problem, not a tag problem.
 *
 * READ THIS BEFORE USING IT. product_type is not a private field. It feeds the
 * Google Shopping / Meta product feeds, so changing it can change how a product
 * is categorised in live ad campaigns. This route therefore:
 *
 *   1. requires an explicit productIds list, never selecting its own targets;
 *   2. dry-runs by default, and the dry run shows the BEFORE and AFTER type
 *      for every product so the change can be read before it happens;
 *   3. requires confirm: "APPLY" to write;
 *   4. records the previous value for every product it changes, in the
 *      response, so the change can be reversed exactly.
 *
 * It cannot touch tags, collections, titles, prices or publish state.
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

const NODES = `
  query Nodes($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { id title productType vendor status } }
  }
`;

const UPDATE = `
  mutation Upd($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id productType }
      userErrors { field message }
    }
  }
`;

type P = { id: string; title: string; productType: string; vendor: string; status: string };

function toGid(id: string): string | null {
  const s = String(id).trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const productType = String(body.productType ?? "").trim();
    const dryRun = body.dryRun !== false;
    const ids: string[] = Array.isArray(body.productIds) ? body.productIds.map(String) : [];

    if (!productType) return NextResponse.json({ error: "productType is required" }, { status: 400 });
    if (productType.length > 80) return NextResponse.json({ error: "productType is too long" }, { status: 400 });
    if (!ids.length) {
      return NextResponse.json({ error: "productIds is required. This route never picks its own targets." }, { status: 400 });
    }
    if (!dryRun && body.confirm !== "APPLY") {
      return NextResponse.json({ error: 'Writing requires confirm: "APPLY".' }, { status: 400 });
    }

    const gids = ids.map(toGid);
    const bad = ids.filter((_, i) => !gids[i]);
    if (bad.length) return NextResponse.json({ error: `Not product ids: ${bad.join(", ")}` }, { status: 400 });

    const found: P[] = [];
    for (let i = 0; i < gids.length; i += 100) {
      const d = await gql<{ nodes: (P | null)[] }>(NODES, { ids: gids.slice(i, i + 100) });
      for (const n of d.nodes) if (n) found.push(n);
    }
    const missing = gids.filter((g) => !found.some((f) => f.id === g));
    if (missing.length) return NextResponse.json({ error: `Do not exist: ${missing.join(", ")}` }, { status: 400 });

    const changing = found.filter((p) => (p.productType || "") !== productType);
    const same = found.filter((p) => (p.productType || "") === productType);

    if (dryRun) {
      return NextResponse.json({
        ok: true, mode: "dryRun", productType,
        wouldChange: changing.length, alreadyCorrect: same.length,
        warning: "product_type feeds the Google Shopping and Meta product feeds. Check with whoever runs the ad campaigns before applying.",
        changes: changing.map((p) => ({ id: p.id, title: p.title, from: p.productType || "(empty)", to: productType })),
      });
    }

    const results: Array<{ id: string; title: string; from: string; to: string; result: string }> = [];
    for (const p of changing) {
      const d = await gql<{ productUpdate: { product: { productType: string } | null; userErrors: Array<{ message: string }> } }>(
        UPDATE, { input: { id: p.id, productType } }
      );
      const errs = d.productUpdate.userErrors;
      results.push({
        id: p.id, title: p.title, from: p.productType || "(empty)", to: productType,
        result: errs.length ? `FAILED: ${errs.map((e) => e.message).join("; ")}` : "changed",
      });
    }
    return NextResponse.json({
      ok: true, mode: "applied", productType,
      changed: results.filter((r) => r.result === "changed").length,
      failed: results.filter((r) => r.result !== "changed").length,
      alreadyCorrect: same.length,
      revertWith: results.filter((r) => r.result === "changed").map((r) => ({ id: r.id, productType: r.from })),
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "update failed" }, { status: 500 });
  }
}
