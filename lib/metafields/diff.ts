/**
 * Delta computation between a product's CURRENT metafield values and the
 * proposed (derived or human-corrected) values. Only real changes become
 * writes, which makes apply re-runnable: a second run after a partial failure
 * rewrites only what still differs.
 */

import {
  serializeFacetValue,
  type FacetDef,
  type FilterCategory,
} from "./config";
import type { AdminProductRow } from "./admin";

export type FacetChange = "set" | "update" | "unchanged" | "skip";

export interface FacetDelta {
  facetKey: string;
  metafieldKey: string;
  current: string | null;
  proposed: string | null; // serialized (list values are JSON arrays)
  change: FacetChange;
}

/** Normalize a serialized value so cosmetic differences don't count as deltas. */
function normalize(f: FacetDef, raw: string | null): string | null {
  if (raw == null || raw === "") return null;
  if (f.type === "list") {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const clean = arr.map(String).filter(Boolean).sort();
        return clean.length ? JSON.stringify(clean) : null;
      }
    } catch {
      // A plain string in a list-typed field — treat as one-element list
      return JSON.stringify([String(raw)]);
    }
  }
  return String(raw).trim() || null;
}

/**
 * Compute per-facet deltas for one product.
 * `proposed` uses facet keys → value (string or string[]); missing/empty
 * entries mean "leave whatever is in Shopify untouched" (change: skip).
 */
export function diffProduct(
  category: FilterCategory,
  product: AdminProductRow,
  proposed: Record<string, string[] | string | null | undefined>
): FacetDelta[] {
  return category.facets.map((f) => {
    const currentRaw = product.metafields[f.metafieldKey]?.value ?? null;
    const current = normalize(f, currentRaw);
    const proposedSerialized = serializeFacetValue(f, proposed[f.key] ?? null);
    const proposedNorm = normalize(f, proposedSerialized);

    let change: FacetChange;
    if (proposedNorm == null) {
      // No proposed value: never delete existing data, never write blanks.
      change = "skip";
    } else if (current == null) {
      change = "set";
    } else if (current === proposedNorm) {
      change = "unchanged";
    } else {
      change = "update";
    }
    return {
      facetKey: f.key,
      metafieldKey: f.metafieldKey,
      current: currentRaw,
      proposed: proposedSerialized,
      change,
    };
  });
}

export function countChanges(deltas: FacetDelta[]): number {
  return deltas.filter((d) => d.change === "set" || d.change === "update").length;
}
