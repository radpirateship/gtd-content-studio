/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PRODUCT FILTER MODULE — category + facet registry (single source of truth)
 * ─────────────────────────────────────────────────────────────────────────────
 * This module bulk-writes structured metafield values so Shopify Search &
 * Discovery can power storefront sidebar filters. It is deliberately isolated
 * from the content publishing flow and has its own mandatory preview gate:
 * NOTHING is written to Shopify except through /api/metafields/apply, which
 * only accepts rows a human has reviewed in the /product-filters UI.
 *
 * To add a new category (e.g. cold plunges): add ONE entry to
 * FILTER_CATEGORIES below and, if it needs new derivation logic, a matching
 * rule set in lib/metafields/derive.ts. Everything else (scan, preview,
 * definitions, apply) picks it up automatically.
 *
 * Standing constraint: this module never touches URLs, redirects, collection
 * publish state, or link allocation. It reads products and writes product
 * metafields in the `custom` namespace only.
 */

export type FacetType = "single" | "list";

export interface FacetDef {
  /** Internal key, also used by the derivation engine */
  key: string;
  /** Metafield key under the `custom` namespace */
  metafieldKey: string;
  /** Human name, also used as the metafield definition name */
  name: string;
  /** single → single_line_text_field, list → list.single_line_text_field */
  type: FacetType;
  /** Allowed values — apply refuses anything outside this list */
  allowedValues: string[];
  /** Short explanation shown in the UI */
  description: string;
}

export interface FilterCategory {
  key: string;
  label: string;
  /**
   * Admin API product search query that bounds the product set for this
   * category. Kept intentionally explicit so the scan scope is auditable.
   */
  productQuery: string;
  facets: FacetDef[];
}

export const METAFIELD_NAMESPACE = "custom";

const SAUNA_FACETS: FacetDef[] = [
  {
    key: "capacity",
    metafieldKey: "capacity",
    name: "Capacity",
    type: "list",
    allowedValues: [
      "1-person", "2-person", "3-person", "4-person", "5-person",
      "6-person", "7-person", "8-person", "9-person", "10-person",
    ],
    description:
      "List type: a '1-2 Person' model carries both 1-person and 2-person so it matches either filter choice.",
  },
  {
    key: "placement",
    metafieldKey: "placement",
    name: "Placement",
    type: "single",
    allowedValues: ["indoor", "outdoor", "indoor-outdoor"],
    description: "Where the unit can be installed.",
  },
  {
    key: "heatType",
    metafieldKey: "heat_type",
    name: "Heat Type",
    type: "list",
    allowedValues: ["infrared", "traditional", "hybrid", "steam"],
    description:
      "List type: hybrids carry infrared + traditional + hybrid so they match any of those filter choices. The filter facet for non-type-specific parent collections.",
  },
  {
    key: "heaterType",
    metafieldKey: "heater_type",
    name: "Heater Type",
    type: "list",
    allowedValues: ["far-infrared", "full-spectrum", "electric", "wood-burning"],
    description:
      "List type: every heater the sauna supports or is offered with. A traditional sauna available with either stove carries both electric and wood-burning so it matches either filter choice; infrared saunas carry their spectrum.",
  },
  {
    key: "woodType",
    metafieldKey: "wood_type",
    name: "Wood Type",
    type: "list",
    allowedValues: [
      "hemlock", "cedar", "fir", "spruce", "aspen", "pine", "thermowood",
    ],
    description:
      "List type: every wood the sauna is built from (walls vs benches often differ), so it matches whichever wood a shopper filters by.",
  },
  {
    key: "emfLevel",
    metafieldKey: "emf_level",
    name: "EMF Level",
    type: "single",
    allowedValues: ["low-emf", "ultra-low-emf", "near-zero-emf"],
    description:
      "Derived from existing EMF tags. Optional facet — leave the column blank on apply to skip it.",
  },
];

export const FILTER_CATEGORIES: FilterCategory[] = [
  {
    key: "saunas",
    label: "Saunas",
    productQuery: "product_type:Sauna AND status:active",
    facets: SAUNA_FACETS,
  },
  // Next categories (cold-plunges, red-light-therapy, …) get added here once
  // their facet taxonomy is agreed. The scan/preview/apply pipeline is fully
  // category-agnostic.
];

export function getCategory(key: string): FilterCategory | undefined {
  return FILTER_CATEGORIES.find((c) => c.key === key);
}

/** Shopify metafield type string for a facet */
export function metafieldType(f: FacetDef): string {
  return f.type === "list" ? "list.single_line_text_field" : "single_line_text_field";
}

/**
 * Serialize a facet value for metafieldsSet. List values are JSON arrays;
 * single values are plain strings. Returns null for empty values (= skip).
 */
export function serializeFacetValue(f: FacetDef, value: string[] | string | null | undefined): string | null {
  if (value == null) return null;
  if (f.type === "list") {
    const arr = (Array.isArray(value) ? value : [value]).filter(Boolean);
    return arr.length ? JSON.stringify(arr) : null;
  }
  const v = Array.isArray(value) ? value[0] : value;
  return v ? String(v) : null;
}

/** Validate a proposed value against the facet's allowed list. */
export function validateFacetValue(f: FacetDef, value: string[] | string): string | null {
  const arr = Array.isArray(value) ? value : [value];
  for (const v of arr) {
    if (v && !f.allowedValues.includes(v)) {
      return `"${v}" is not an allowed value for ${f.name} (allowed: ${f.allowedValues.join(", ")})`;
    }
  }
  return null;
}
