// /api/metafields/definitions
//
// GET  ?category=saunas → status of every required metafield definition
// POST { category }     → create the MISSING definitions (namespace `custom`,
//                         ownerType PRODUCT, storefront PUBLIC_READ, pinned)
//
// Definitions must exist with storefront visibility BEFORE values are
// written, or Search & Discovery never sees them. Existing definitions are
// never modified or deleted here — a type mismatch is reported for a manual
// fix in Shopify admin instead.

import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api-response";
import { logRouteEvent, parseAndValidateJson } from "@/lib/api-utils";
import { getCategory, FILTER_CATEGORIES } from "@/lib/metafields/config";
import { createMissingDefinitions, getDefinitionStatus } from "@/lib/metafields/admin";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const categoryKey = request.nextUrl.searchParams.get("category") || "";
  const category = getCategory(categoryKey);
  if (!category) {
    return apiError(
      `Unknown category "${categoryKey}". Available: ${FILTER_CATEGORIES.map((c) => c.key).join(", ")}`,
      400
    );
  }
  try {
    const definitions = await getDefinitionStatus(category);
    return apiSuccess({ category: category.key, definitions });
  } catch (e) {
    return apiError("Definition check failed", 500, e instanceof Error ? e.message : String(e));
  }
}

const PostSchema = z.object({ category: z.string().min(1) });

export async function POST(request: NextRequest) {
  const parsed = await parseAndValidateJson(request, PostSchema);
  if (!parsed.success) return parsed.response;

  const category = getCategory(parsed.data.category);
  if (!category) return apiError(`Unknown category "${parsed.data.category}"`, 400);

  try {
    const results = await createMissingDefinitions(category);
    const definitions = await getDefinitionStatus(category);
    logRouteEvent("metafields-definitions-create", {
      category: "metafields",
      status: results.some((r) => r.error) ? "warning" : "success",
      detail: `${category.key}: created ${results.filter((r) => r.created).length}`,
    });
    return apiSuccess({ category: category.key, results, definitions });
  } catch (e) {
    return apiError("Definition create failed", 500, e instanceof Error ? e.message : String(e));
  }
}
