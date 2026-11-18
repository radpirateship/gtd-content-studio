import { NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

// One-time admin utility: mint (or list) a Storefront API access token using the
// app's existing Admin API token. New Dev Dashboard apps don't expose a static
// Storefront token in the UI, so we create one via the Admin API.
//
// GET  -> list existing storefront access tokens (tests the Admin token too)
// POST -> create a new storefront access token and return it
const ADMIN_API_VERSION = "2024-01";

function adminUrl() {
  return `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
}

async function adminFetch(query: string) {
  const token = await getShopifyAccessToken();
  const res = await fetch(adminUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

export async function GET() {
  try {
    const q = `{ shop { name } storefrontAccessTokens(first: 20) { edges { node { id title accessToken accessScopes { handle } } } } }`;
    const { status, ok, json } = await adminFetch(q);
    if (!ok || json.errors) {
      return NextResponse.json({ ok: false, status, errors: json.errors ?? json }, { status: 500 });
    }
    const shop = json?.data?.shop?.name ?? null;
    const tokens = (json?.data?.storefrontAccessTokens?.edges ?? []).map((e: { node: { title: string; accessToken: string; accessScopes: { handle: string }[] } }) => ({
      title: e.node.title,
      accessToken: e.node.accessToken,
      scopes: e.node.accessScopes.map((s) => s.handle),
    }));
    return NextResponse.json({ ok: true, shop, count: tokens.length, tokens });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "list failed" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const q = `mutation {
      storefrontAccessTokenCreate(input: { title: "PPW Content Studio Revamp" }) {
        storefrontAccessToken { accessToken title accessScopes { handle } }
        userErrors { field message }
      }
    }`;
    const { status, ok, json } = await adminFetch(q);
    const result = json?.data?.storefrontAccessTokenCreate;
    if (!ok || json.errors || (result?.userErrors?.length ?? 0) > 0) {
      return NextResponse.json(
        { ok: false, status, errors: json.errors, userErrors: result?.userErrors },
        { status: 500 }
      );
    }
    const t = result.storefrontAccessToken;
    return NextResponse.json({
      ok: true,
      accessToken: t.accessToken,
      title: t.title,
      scopes: (t.accessScopes ?? []).map((s: { handle: string }) => s.handle),
      note: "Set this value as SHOPIFY_STOREFRONT_ACCESS_TOKEN in Vercel, then redeploy.",
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "mint failed" }, { status: 500 });
  }
}
