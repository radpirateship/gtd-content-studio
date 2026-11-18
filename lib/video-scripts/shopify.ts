// Shopify GraphQL reads for the Video Scripts module. Read-only.
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

const GRAPHQL_VERSION = "2024-10";

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = await getShopifyAccessToken();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${GRAPHQL_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Shopify GraphQL HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> };
    if (json.errors?.length) {
      // Cost throttling: wait and retry rather than failing a long refresh.
      if (json.errors.some((e) => e.extensions?.code === "THROTTLED") && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
    }
    if (!json.data) throw new Error("Shopify GraphQL returned no data");
    return json.data;
  }
  throw new Error("Shopify GraphQL: throttled");
}

export const numericId = (gid: string) => gid.split("/").pop() || gid;
export const productGid = (id: string) => (id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`);

export type CatalogProduct = {
  id: string; // numeric
  title: string;
  handle: string;
  status: string; // ACTIVE | DRAFT | ARCHIVED
  vendor: string;
  productType: string;
  imageUrl: string | null;
  price: string | null;
};

const CATALOG_QUERY = `
  query Catalog($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle status vendor productType
        featuredImage { url }
        priceRangeV2 { minVariantPrice { amount } }
      }
    }
  }
`;

/** Every product in the store, any status, so old sales still match. */
export async function fetchCatalog(): Promise<CatalogProduct[]> {
  type Resp = {
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        id: string; title: string; handle: string; status: string; vendor: string; productType: string;
        featuredImage: { url: string } | null;
        priceRangeV2: { minVariantPrice: { amount: string } } | null;
      }>;
    };
  };
  const out: CatalogProduct[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 60; page++) {
    const d: Resp = await gql<Resp>(CATALOG_QUERY, { cursor });
    for (const n of d.products.nodes) {
      out.push({
        id: numericId(n.id),
        title: n.title,
        handle: n.handle,
        status: n.status,
        vendor: n.vendor || "",
        productType: n.productType || "",
        imageUrl: n.featuredImage?.url || null,
        price: n.priceRangeV2?.minVariantPrice?.amount ?? null,
      });
    }
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }
  return out;
}

const MEMBERSHIP_QUERY = `
  query Membership($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id collections(first: 40) { nodes { handle title } } }
    }
  }
`;

/** Collection membership for a set of product ids (numeric). */
export async function fetchCollectionsForProducts(ids: string[]): Promise<Map<string, Array<{ handle: string; title: string }>>> {
  type Resp = { nodes: Array<{ id: string; collections: { nodes: Array<{ handle: string; title: string }> } } | null> };
  const out = new Map<string, Array<{ handle: string; title: string }>>();
  const BATCH = 20;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH).map(productGid);
    const d = await gql<Resp>(MEMBERSHIP_QUERY, { ids: batch });
    for (const n of d.nodes) {
      if (!n?.id) continue;
      out.set(numericId(n.id), n.collections?.nodes || []);
    }
  }
  return out;
}

export type ProductDetail = {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string;
  productType: string;
  tags: string[];
  descriptionHtml: string;
  url: string;
  price: string | null;
  compareAtPrice: string | null;
  variants: Array<{ title: string; price: string; compareAtPrice: string | null; sku: string | null }>;
  images: string[];
  metafields: Array<{ namespace: string; key: string; value: string }>;
  collections: Array<{ handle: string; title: string }>;
  imageUrl: string | null;
};

const PRODUCT_QUERY = `
  query Product($id: ID!) {
    product(id: $id) {
      id title handle status vendor productType tags descriptionHtml
      featuredImage { url }
      priceRangeV2 { minVariantPrice { amount } }
      compareAtPriceRange { minVariantCompareAtPrice { amount } }
      variants(first: 25) { nodes { title price compareAtPrice sku } }
      images(first: 12) { nodes { url } }
      metafields(first: 50) { nodes { namespace key value type } }
      collections(first: 40) { nodes { handle title } }
    }
  }
`;

// Metafields that are app plumbing rather than product facts.
const SKIP_NAMESPACES = /^(judgeme|reviews|shopify--|mm-google-shopping|global|seo|app--|loox|yotpo|klaviyo)/i;

export async function fetchProductDetail(id: string): Promise<ProductDetail | null> {
  type P = {
    id: string; title: string; handle: string; status: string; vendor: string; productType: string; tags: string[];
    descriptionHtml: string; featuredImage: { url: string } | null;
    priceRangeV2: { minVariantPrice: { amount: string } } | null;
    compareAtPriceRange: { minVariantCompareAtPrice: { amount: string } | null } | null;
    variants: { nodes: Array<{ title: string; price: string; compareAtPrice: string | null; sku: string | null }> };
    images: { nodes: Array<{ url: string }> };
    metafields: { nodes: Array<{ namespace: string; key: string; value: string; type: string }> };
    collections: { nodes: Array<{ handle: string; title: string }> };
  };
  const d = await gql<{ product: P | null }>(PRODUCT_QUERY, { id: productGid(id) });
  const p = d.product;
  if (!p) return null;
  const compare = p.compareAtPriceRange?.minVariantCompareAtPrice?.amount ?? null;
  return {
    id: numericId(p.id),
    title: p.title,
    handle: p.handle,
    status: p.status,
    vendor: p.vendor || "",
    productType: p.productType || "",
    tags: p.tags || [],
    descriptionHtml: p.descriptionHtml || "",
    url: `https://greenthumbdepot.com/products/${p.handle}`,
    price: p.priceRangeV2?.minVariantPrice?.amount ?? null,
    compareAtPrice: compare && Number(compare) > 0 ? compare : null,
    variants: p.variants?.nodes || [],
    images: (p.images?.nodes || []).map((i) => i.url).filter(Boolean),
    metafields: (p.metafields?.nodes || [])
      .filter((m) => !SKIP_NAMESPACES.test(m.namespace))
      .filter((m) => !/reference|file_reference|json/.test(m.type))
      .filter((m) => m.value && m.value.length < 600)
      .map(({ namespace, key, value }) => ({ namespace, key, value })),
    collections: p.collections?.nodes || [],
    imageUrl: p.featuredImage?.url || null,
  };
}

export type CollectionDetail = {
  handle: string;
  title: string;
  descriptionHtml: string;
  productsCount: number;
  url: string;
};

const COLLECTION_QUERY = `
  query Coll($handle: String!) {
    collectionByHandle(handle: $handle) {
      handle title descriptionHtml
      productsCount { count }
    }
  }
`;

export async function fetchCollectionDetail(handle: string): Promise<CollectionDetail | null> {
  type C = { handle: string; title: string; descriptionHtml: string; productsCount: { count: number } | null };
  const d = await gql<{ collectionByHandle: C | null }>(COLLECTION_QUERY, { handle });
  const c = d.collectionByHandle;
  if (!c) return null;
  return {
    handle: c.handle,
    title: c.title,
    descriptionHtml: c.descriptionHtml || "",
    productsCount: c.productsCount?.count ?? 0,
    url: `https://greenthumbdepot.com/collections/${c.handle}`,
  };
}

export { htmlToText } from "./text";
