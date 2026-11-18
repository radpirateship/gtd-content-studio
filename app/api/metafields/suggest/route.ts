// POST /api/metafields/suggest — AI-assisted suggestions for FLAGGED rows.
//
// READ-ONLY with respect to Shopify: this route never writes anything. It has
// Claude read each flagged product's full title/tags/description and propose
// values for the facets derivation couldn't settle, with one line of
// reasoning each. Suggestions flow back into the editable preview UI, where
// they still need a human check-in + the APPLY gate before any write.
//
// The model is explicitly told to return null when the content contains no
// real evidence — an AI guess is worse than a blank cell.

import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api-response";
import { logRouteEvent, parseAndValidateJson } from "@/lib/api-utils";
import { callAI } from "@/lib/ai";
import { getCategory } from "@/lib/metafields/config";
import { fetchCategoryProducts, type AdminProductRow } from "@/lib/metafields/admin";

export const maxDuration = 300;

const BATCH_SIZE = 10;
const CONCURRENCY = 3;
const MAX_DESC_CHARS = 2600;

const SuggestSchema = z.object({
  category: z.string().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().startsWith("gid://shopify/Product/"),
        facetKeys: z.array(z.string()).min(1).max(10),
      })
    )
    .min(1)
    .max(400),
});

type Suggestion = { value: string | string[] | null; reasoning: string };

function stripHtml(s: string): string {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json\s*|```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON array in AI response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  const parsed = await parseAndValidateJson(request, SuggestSchema);
  if (!parsed.success) return parsed.response;
  const { category: categoryKey, items } = parsed.data;

  const category = getCategory(categoryKey);
  if (!category) return apiError(`Unknown category "${categoryKey}"`, 400);

  for (const item of items) {
    for (const fk of item.facetKeys) {
      if (!category.facets.some((f) => f.key === fk)) {
        return apiError(`Unknown facet "${fk}" for category "${categoryKey}"`, 400);
      }
    }
  }

  try {
    const products = await fetchCategoryProducts(category);
    const byId = new Map(products.map((p) => [p.id, p]));
    const known = items.filter((i) => byId.has(i.productId));

    const facetGuide = category.facets
      .map(
        (f) =>
          `- ${f.key} (${f.type === "list" ? "array of strings" : "string"}): allowed values ONLY from [${f.allowedValues.join(", ")}]. ${f.description}`
      )
      .join("\n");

    const system = `You extract product attributes for a wellness equipment store's filter system.
You will receive products (title, vendor, tags, description) and, per product, the list of facets that automated rules could NOT settle.
For each requested facet, decide the value ONLY from evidence in the provided content.

Rules:
- Use ONLY the allowed values listed for each facet. Never invent other values.
- If the content contains no real evidence for a facet, return null for it and say "no evidence" in the reasoning. A null is correct and expected; a guess is a defect.
- "capacity" is how many people the sauna seats. A range like "seats 2-3" means ["2-person","3-person"].
- "heaterType" is a LIST of every heater the sauna supports or is offered with. Infrared saunas get their spectrum (full-spectrum = near+mid+far IR, otherwise far-infrared). EVERY traditional sauna includes "electric" (they all work with electric heaters). Add "wood-burning" ONLY when the content indicates wood-stove compatibility: a chimney, flue, or smoke pipe is the #1 signifier, as is an explicit wood-fired/wood-burning stove mention or a ventilation system described as being for a stove. Generic ventilation mentions alone are NOT enough.
- "woodType" is a LIST: include every wood the sauna is BUILT from (walls, benches, exterior can differ — include each), but not woods mentioned in passing or for accessories.
- "heatType" is a LIST: a hybrid sauna gets all three of ["infrared","traditional","hybrid"]; otherwise the single applicable value.
- Keep reasoning to one short sentence quoting or paraphrasing the evidence.

Facets for this category:
${facetGuide}

Respond with ONLY a JSON array, one object per product:
[{"productId": "...", "suggestions": {"<facetKey>": {"value": <string|array|null>, "reasoning": "..."}}}]
Include every requested facet key for every product.`;

    const batches: Array<typeof known> = [];
    for (let i = 0; i < known.length; i += BATCH_SIZE) batches.push(known.slice(i, i + BATCH_SIZE));

    const results = new Map<string, Record<string, Suggestion>>();
    const errors: string[] = [];

    async function runBatch(batch: typeof known) {
      const payload = batch.map((item) => {
        const p = byId.get(item.productId) as AdminProductRow;
        return {
          productId: p.id,
          title: p.title,
          vendor: p.vendor,
          tags: p.tags,
          description: stripHtml(p.descriptionHtml).slice(0, MAX_DESC_CHARS),
          facetsToFill: item.facetKeys,
        };
      });
      const text = await callAI(system, JSON.stringify(payload, null, 1), {
        maxTokens: 6000,
        timeoutMs: 120_000,
      });
      const arr = extractJson(text);
      if (!Array.isArray(arr)) throw new Error("AI response was not an array");
      for (const entry of arr) {
        if (!entry || typeof entry.productId !== "string" || typeof entry.suggestions !== "object") continue;
        const clean: Record<string, Suggestion> = {};
        for (const [fk, s] of Object.entries(entry.suggestions as Record<string, Suggestion>)) {
          const facet = category!.facets.find((f) => f.key === fk);
          if (!facet || !s || typeof s !== "object") continue;
          let value = (s as Suggestion).value ?? null;
          if (value != null) {
            const arrVal = (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
            const valid = arrVal.filter((v) => facet.allowedValues.includes(v));
            if (!valid.length) value = null; // invalid suggestion → treat as no evidence
            else value = facet.type === "list" ? valid : valid[0];
          }
          clean[fk] = {
            value,
            reasoning: String((s as Suggestion).reasoning || "").slice(0, 300),
          };
        }
        results.set(entry.productId, clean);
      }
    }

    // Small concurrency pool so 100+ flagged rows finish inside the route budget
    let cursor = 0;
    async function worker() {
      while (cursor < batches.length) {
        const mine = batches[cursor++];
        try {
          await runBatch(mine);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

    const out = known.map((i) => ({
      productId: i.productId,
      suggestions: results.get(i.productId) || null,
    }));
    const suggested = out.filter((o) => o.suggestions).length;

    logRouteEvent("metafields-suggest", {
      category: "metafields",
      status: errors.length ? "warning" : "success",
      detail: `${category.key}: AI suggestions for ${suggested}/${known.length} products (${batches.length} batches)`,
      durationMs: Date.now() - started,
    });

    return apiSuccess(
      {
        requested: items.length,
        matched: known.length,
        suggested,
        results: out,
        errors,
      },
      errors.length
        ? { warning: `${errors.length} batch(es) failed — run Suggest again; already-filled cells are kept.` }
        : undefined
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logRouteEvent("metafields-suggest", {
      category: "metafields",
      status: "error",
      detail: msg,
      durationMs: Date.now() - started,
    });
    return apiError("Suggest failed", 500, msg);
  }
}
