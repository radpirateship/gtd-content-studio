/**
 * GET /api/products/admin-search?q=<shopify product query>&limit=2000
 *
 * READ ONLY. A straight, fully paginated Admin API product query.
 *
 * Why this exists: /api/products is the article picker. It ranks, caps and
 * filters by relevance, so it is not a reliable way to enumerate a catalogue.
 * Sweeping 303 collections through it returned 7 treadmills where the same
 * collection had returned 53 minutes earlier. Anything that needs a complete,
 * repeatable list of products has to go to the Admin API directly.
 *
 * Query syntax is Shopify's, e.g.
 *   product_type:'Treadmill'
 *   product_type:*walk*
 *   title:*walking*
 *   status:active
 * Omit q to enumerate the whole catalogue.
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

const QUERY = `
  query Search($q: String, $cursor: String) {
    products(first: 250, query: $q, after: $cursor, sortKey: TITLE) {
      nodes {
        id legacyResourceId title handle vendor productType status tags
        description
        collections(first: 30) { nodes { handle } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type Node = {
  id: string; legacyResourceId: string; title: string; handle: string;
  vendor: string; productType: string; status: string; tags: string[];
  description: string; collections: { nodes: Array<{ handle: string }> };
};

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || undefined;
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 2000), 5000);
  try {
    const out: Node[] = [];
    let cursor: string | null = null;
    do {
      const d: { products: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } =
        await gql(QUERY, { q, cursor });
      out.push(...d.products.nodes);
      cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    } while (cursor && out.length < limit);

    return NextResponse.json({
      ok: true,
      query: q ?? "(everything)",
      count: out.length,
      products: out.map((n) => ({
        id: n.legacyResourceId,
        gid: n.id,
        title: n.title,
        handle: n.handle,
        vendor: n.vendor || "",
        productType: n.productType || "",
        status: n.status,
        tags: n.tags || [],
        description: n.description || "",
        collections: n.collections.nodes.map((c) => c.handle),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "search failed" }, { status: 500 });
  }
}
