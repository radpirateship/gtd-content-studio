// GET /api/metafields/scan?category=saunas
//
// DRY RUN ONLY — pulls the category's products live from the Admin API, runs
// attribute derivation, diffs against the metafield values currently on each
// product, and returns the full SKU-by-SKU preview. Zero writes, always safe.

import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api-response";
import { logRouteEvent } from "@/lib/api-utils";
import { getCategory, FILTER_CATEGORIES } from "@/lib/metafields/config";
import { fetchCategoryProducts, getDefinitionStatus } from "@/lib/metafields/admin";
import { deriveProduct } from "@/lib/metafields/derive";
import { diffProduct, countChanges } from "@/lib/metafields/diff";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const started = Date.now();
  const categoryKey = request.nextUrl.searchParams.get("category") || "";
  const category = getCategory(categoryKey);
  if (!category) {
    return apiError(
      `Unknown category "${categoryKey}". Available: ${FILTER_CATEGORIES.map((c) => c.key).join(", ")}`,
      400
    );
  }

  try {
    const [products, definitions] = await Promise.all([
      fetchCategoryProducts(category),
      getDefinitionStatus(category),
    ]);

    const rows = products.map((p) => {
      const derived = deriveProduct(category, {
        title: p.title,
        tags: p.tags,
        descriptionHtml: p.descriptionHtml,
      });
      const proposed = Object.fromEntries(
        Object.entries(derived.facets).map(([k, v]) => [k, v.value])
      );
      const deltas = diffProduct(category, p, proposed);
      return {
        productId: p.id,
        legacyId: p.legacyResourceId,
        handle: p.handle,
        title: p.title,
        vendor: p.vendor,
        tags: p.tags,
        facets: derived.facets,
        flags: derived.flags,
        deltas,
        changeCount: countChanges(deltas),
      };
    });

    const summary = {
      products: rows.length,
      flagged: rows.filter((r) => r.flags.length > 0).length,
      totalChanges: rows.reduce((n, r) => n + r.changeCount, 0),
      definitionsReady: definitions.every((d) => d.exists && d.typeOk && d.storefrontVisible),
    };

    logRouteEvent("metafields-scan", {
      category: "metafields",
      status: "success",
      detail: `${category.key}: ${summary.products} products, ${summary.totalChanges} deltas`,
      durationMs: Date.now() - started,
    });

    return apiSuccess({ category: category.key, summary, definitions, rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logRouteEvent("metafields-scan", {
      category: "metafields",
      status: "error",
      detail: msg,
      durationMs: Date.now() - started,
    });
    return apiError("Scan failed", 500, msg);
  }
}
