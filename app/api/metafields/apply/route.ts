// POST /api/metafields/apply — THE ONLY WRITE PATH IN THIS MODULE.
//
// Safety gates, in order:
//   1. Body must carry confirm: "APPLY" (the UI requires typing it).
//   2. Every submitted value is validated against the facet's allowed list.
//   3. Metafield definitions must all exist, with the right type AND
//      storefront visibility — otherwise the write is refused outright,
//      because values written before definitions are invisible to Search &
//      Discovery (the classic failure mode for this kind of build).
//   4. Current values are RE-READ from Shopify at apply time and only real
//      deltas are written (delta-only, so the whole thing is re-runnable and
//      a stale preview can never cause redundant or destructive writes).
//   5. Empty values are skips, never deletes. This route cannot remove data,
//      touch tags, collections, URLs, redirects, or publish state.

import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api-response";
import { logRouteEvent, parseAndValidateJson } from "@/lib/api-utils";
import { getCategory, metafieldType, validateFacetValue } from "@/lib/metafields/config";
import {
  fetchCategoryProducts,
  getDefinitionStatus,
  setMetafields,
  type MetafieldWrite,
} from "@/lib/metafields/admin";
import { diffProduct } from "@/lib/metafields/diff";

export const maxDuration = 300;

const ValueSchema = z.union([z.string(), z.array(z.string())]);
const ApplySchema = z.object({
  category: z.string().min(1),
  confirm: z.literal("APPLY"),
  rows: z
    .array(
      z.object({
        productId: z.string().startsWith("gid://shopify/Product/"),
        values: z.record(z.string(), ValueSchema),
      })
    )
    .min(1)
    .max(2000),
});

export async function POST(request: NextRequest) {
  const started = Date.now();
  const parsed = await parseAndValidateJson(request, ApplySchema);
  if (!parsed.success) return parsed.response;
  const { category: categoryKey, rows } = parsed.data;

  const category = getCategory(categoryKey);
  if (!category) return apiError(`Unknown category "${categoryKey}"`, 400);

  try {
    // Gate 2: value validation before anything touches Shopify
    const validationErrors: string[] = [];
    for (const row of rows) {
      for (const [facetKey, value] of Object.entries(row.values)) {
        const facet = category.facets.find((f) => f.key === facetKey);
        if (!facet) {
          validationErrors.push(`${row.productId}: unknown facet "${facetKey}"`);
          continue;
        }
        const err = validateFacetValue(facet, value);
        if (err) validationErrors.push(`${row.productId}: ${err}`);
      }
    }
    if (validationErrors.length) {
      return apiError("Validation failed — nothing was written", 400, validationErrors.slice(0, 20).join(" | "));
    }

    // Gate 3: definitions must be fully ready
    const definitions = await getDefinitionStatus(category);
    const notReady = definitions.filter((d) => !d.exists || !d.typeOk || !d.storefrontVisible);
    if (notReady.length) {
      return apiError(
        "Metafield definitions are not ready — nothing was written. Create them first from the Definitions panel.",
        409,
        notReady
          .map(
            (d) =>
              `${d.key}: ${!d.exists ? "missing" : !d.typeOk ? `wrong type (${d.actualType})` : "no storefront visibility"}`
          )
          .join(" | ")
      );
    }

    // Gate 4: re-read current state and compute real deltas
    const products = await fetchCategoryProducts(category);
    const byId = new Map(products.map((p) => [p.id, p]));
    const writes: MetafieldWrite[] = [];
    let skippedUnknown = 0;
    let unchanged = 0;
    const perProduct: Array<{ productId: string; handle: string; changes: number }> = [];

    for (const row of rows) {
      const product = byId.get(row.productId);
      if (!product) {
        skippedUnknown++;
        continue;
      }
      const deltas = diffProduct(category, product, row.values);
      let changes = 0;
      for (const d of deltas) {
        if ((d.change === "set" || d.change === "update") && d.proposed != null) {
          const facet = category.facets.find((f) => f.key === d.facetKey)!;
          writes.push({
            ownerId: product.id,
            key: d.metafieldKey,
            type: metafieldType(facet),
            value: d.proposed,
          });
          changes++;
        } else if (d.change === "unchanged") {
          unchanged++;
        }
      }
      if (changes > 0) perProduct.push({ productId: product.id, handle: product.handle, changes });
    }

    if (!writes.length) {
      return apiSuccess({
        written: 0,
        unchanged,
        skippedUnknown,
        message: "Nothing to write — Shopify already matches the approved values.",
      });
    }

    const { written, errors } = await setMetafields(writes);

    logRouteEvent("metafields-apply", {
      category: "metafields",
      status: errors.length ? "warning" : "success",
      detail: `${category.key}: wrote ${written}/${writes.length} metafields across ${perProduct.length} products`,
      metadata: { errors: errors.slice(0, 10) },
      durationMs: Date.now() - started,
    });

    return apiSuccess(
      {
        written,
        attempted: writes.length,
        productsTouched: perProduct.length,
        unchanged,
        skippedUnknown,
        perProduct,
        errors,
      },
      errors.length
        ? { warning: "Some writes failed — fix the errors and re-run apply; only remaining deltas will be rewritten." }
        : undefined
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logRouteEvent("metafields-apply", {
      category: "metafields",
      status: "error",
      detail: msg,
      durationMs: Date.now() - started,
    });
    return apiError("Apply failed", 500, msg);
  }
}
