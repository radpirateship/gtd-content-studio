/**
 * Shopify Admin GraphQL client for the product filter module.
 *
 * Uses the same shpat_ token as the rest of Content Studio (write_products
 * scope confirmed 2026-08-09 via /api/shopify/whoami) but keeps its own,
 * deliberately narrow surface:
 *   - read products (title, tags, description, current custom.* metafields)
 *   - read/create metafield definitions in the `custom` namespace
 *   - write product metafield values via metafieldsSet, batched, delta-only
 *
 * It never touches collections, redirects, URLs, publish state, or themes.
 */

import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";
import {
  METAFIELD_NAMESPACE,
  metafieldType,
  type FacetDef,
  type FilterCategory,
} from "./config";

const GRAPHQL_VERSION = "2024-10";

async function adminGraphql<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const token = await getShopifyAccessToken();
  const res = await fetch(
    `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${GRAPHQL_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  if (!res.ok) {
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Shopify GraphQL returned no data");
  return json.data;
}

/* ── products ─────────────────────────────────────────────────────────── */

export interface AdminProductRow {
  id: string; // gid://shopify/Product/…
  legacyResourceId: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string[];
  descriptionHtml: string;
  /** current custom.* metafield values, keyed by metafield key */
  metafields: Record<string, { value: string; type: string }>;
}

const PRODUCTS_QUERY = `
  query FilterModuleProducts($cursor: String, $q: String) {
    products(first: 100, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        legacyResourceId
        title
        handle
        vendor
        productType
        status
        tags
        descriptionHtml
        metafields(first: 30, namespace: "${METAFIELD_NAMESPACE}") {
          nodes { key value type }
        }
      }
    }
  }
`;

interface ProductsQueryResult {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      legacyResourceId: string;
      title: string;
      handle: string;
      vendor: string | null;
      productType: string | null;
      status: string;
      tags: string[];
      descriptionHtml: string | null;
      metafields: { nodes: Array<{ key: string; value: string; type: string }> };
    }>;
  };
}

/** Fetch every product matching the category's product query (paginated). */
export async function fetchCategoryProducts(
  category: FilterCategory,
  maxPages = 30
): Promise<AdminProductRow[]> {
  const out: AdminProductRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: ProductsQueryResult = await adminGraphql<ProductsQueryResult>(PRODUCTS_QUERY, {
      cursor,
      q: category.productQuery,
    });
    for (const n of data.products.nodes) {
      out.push({
        id: n.id,
        legacyResourceId: n.legacyResourceId,
        title: n.title,
        handle: n.handle,
        vendor: n.vendor || "",
        productType: n.productType || "",
        status: n.status,
        tags: n.tags || [],
        descriptionHtml: n.descriptionHtml || "",
        metafields: Object.fromEntries(
          n.metafields.nodes.map((m) => [m.key, { value: m.value, type: m.type }])
        ),
      });
    }
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
  return out;
}

/* ── metafield definitions ────────────────────────────────────────────── */

export interface DefinitionStatus {
  key: string;
  name: string;
  exists: boolean;
  typeOk: boolean;
  actualType?: string;
  storefrontVisible: boolean;
}

const DEFINITIONS_QUERY = `
  query FilterModuleDefinitions {
    metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "${METAFIELD_NAMESPACE}") {
      nodes {
        key
        name
        type { name }
        access { storefront }
      }
    }
  }
`;

interface DefinitionsQueryResult {
  metafieldDefinitions: {
    nodes: Array<{
      key: string;
      name: string;
      type: { name: string };
      access: { storefront: string } | null;
    }>;
  };
}

/**
 * Report, for every facet in the category, whether its metafield definition
 * exists with the right type and storefront visibility. This is the standard
 * failure mode for filter builds — values written before the definition
 * exists (or without storefront access) are invisible to Search & Discovery.
 */
export async function getDefinitionStatus(category: FilterCategory): Promise<DefinitionStatus[]> {
  const data = await adminGraphql<DefinitionsQueryResult>(DEFINITIONS_QUERY);
  const existing = new Map(data.metafieldDefinitions.nodes.map((d) => [d.key, d]));
  return category.facets.map((f) => {
    const d = existing.get(f.metafieldKey);
    const expected = metafieldType(f);
    return {
      key: f.metafieldKey,
      name: f.name,
      exists: !!d,
      typeOk: !!d && d.type.name === expected,
      actualType: d?.type.name,
      storefrontVisible: !!d && d.access?.storefront === "PUBLIC_READ",
    };
  });
}

const DEFINITION_CREATE = `
  mutation FilterModuleDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id key }
      userErrors { field message code }
    }
  }
`;

interface DefinitionCreateResult {
  metafieldDefinitionCreate: {
    createdDefinition: { id: string; key: string } | null;
    userErrors: Array<{ field: string[] | null; message: string; code: string }>;
  };
}

/** Create the missing definitions (with storefront read access + pinned). */
export async function createMissingDefinitions(
  category: FilterCategory
): Promise<Array<{ key: string; created: boolean; error?: string }>> {
  const status = await getDefinitionStatus(category);
  const results: Array<{ key: string; created: boolean; error?: string }> = [];
  for (const f of category.facets) {
    const s = status.find((x) => x.key === f.metafieldKey);
    if (s?.exists) {
      results.push({
        key: f.metafieldKey,
        created: false,
        error: s.typeOk
          ? undefined
          : `exists with type ${s.actualType}, expected ${metafieldType(f)} — fix manually in Shopify admin`,
      });
      continue;
    }
    try {
      const data = await adminGraphql<DefinitionCreateResult>(DEFINITION_CREATE, {
        definition: {
          name: f.name,
          namespace: METAFIELD_NAMESPACE,
          key: f.metafieldKey,
          type: metafieldType(f),
          ownerType: "PRODUCT",
          pin: true,
          access: { storefront: "PUBLIC_READ" },
        },
      });
      const errs = data.metafieldDefinitionCreate.userErrors;
      results.push({
        key: f.metafieldKey,
        created: !!data.metafieldDefinitionCreate.createdDefinition,
        error: errs.length ? errs.map((e) => e.message).join("; ") : undefined,
      });
    } catch (e) {
      results.push({
        key: f.metafieldKey,
        created: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

/* ── metafield writes ─────────────────────────────────────────────────── */

export interface MetafieldWrite {
  ownerId: string; // product GID
  key: string;
  type: string;
  value: string;
}

const METAFIELDS_SET = `
  mutation FilterModuleMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key owner { ... on Product { id } } }
      userErrors { field message code }
    }
  }
`;

interface MetafieldsSetResult {
  metafieldsSet: {
    metafields: Array<{ key: string }> | null;
    userErrors: Array<{ field: string[] | null; message: string; code: string }>;
  };
}

/**
 * Write metafield values in batches of 25 (Shopify's metafieldsSet limit).
 * Returns per-batch errors; a failed batch does not stop later batches, so a
 * re-run only rewrites what still differs (apply is delta-only upstream).
 */
export async function setMetafields(
  writes: MetafieldWrite[]
): Promise<{ written: number; errors: string[] }> {
  let written = 0;
  const errors: string[] = [];
  for (let i = 0; i < writes.length; i += 25) {
    const batch = writes.slice(i, i + 25).map((w) => ({
      ownerId: w.ownerId,
      namespace: METAFIELD_NAMESPACE,
      key: w.key,
      type: w.type,
      value: w.value,
    }));
    try {
      const data = await adminGraphql<MetafieldsSetResult>(METAFIELDS_SET, {
        metafields: batch,
      });
      const errs = data.metafieldsSet.userErrors;
      if (errs.length) {
        errors.push(...errs.map((e) => `${(e.field || []).join(".")}: ${e.message}`));
        written += batch.length - errs.length;
      } else {
        written += batch.length;
      }
    } catch (e) {
      errors.push(`batch ${i / 25 + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { written, errors };
}

/** Facet lookup helper shared by scan/apply routes. */
export function facetByMetafieldKey(category: FilterCategory, key: string): FacetDef | undefined {
  return category.facets.find((f) => f.metafieldKey === key);
}
