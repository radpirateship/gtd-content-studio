/**
 * Attribute derivation engine — turns unstructured product data (title, tags,
 * description HTML) into structured facet values with per-facet confidence.
 *
 * Ground rules (agreed with Ryan, validated against the 2026-06-01 export):
 *  - Range tags like "3-6 person" are COLLECTION BUCKET tags, not the
 *    product's true capacity. Only the title and exact single-number tags
 *    ("3 person") count as capacity truth.
 *  - Nothing is guessed: a facet that can't be derived confidently comes back
 *    empty with a flag, for a human to fill in the preview UI.
 */

import type { FilterCategory } from "./config";

export type Confidence = "high" | "medium" | "low" | "none";

export interface DerivedFacet {
  value: string[] | string | null;
  confidence: Confidence;
}

export interface DerivedProduct {
  facets: Record<string, DerivedFacet>;
  flags: string[];
}

export interface ProductInput {
  title: string;
  tags: string[];
  descriptionHtml: string;
}

function stripHtml(s: string): string {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const wb = (word: string, text: string) =>
  new RegExp(`\\b${word}\\b`, "i").test(text);

/* ── capacity ─────────────────────────────────────────────────────────── */

const CAP_RANGE = /\b(\d)\s*(?:-|–|to)\s*(\d)\s*[- ]?person\b/gi;
const CAP_SINGLE = /\b(\d)\s*[- ]?person\b/gi;

function capsFrom(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(CAP_RANGE)) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a >= 1 && b <= 12 && a <= b) for (let n = a; n <= b; n++) out.add(n);
  }
  // Remove range matches so singles don't double-count, then scan singles
  const rest = text.replace(CAP_RANGE, " ");
  for (const m of rest.matchAll(CAP_SINGLE)) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 12) out.add(n);
  }
  return out;
}

/* ── woods ────────────────────────────────────────────────────────────── */

const WOODS: Record<string, RegExp> = {
  cedar: /(?:red\s+)?cedar/i,
  hemlock: /hemlock/i,
  fir: /\bfir\b/i,
  spruce: /spruce/i,
  aspen: /aspen/i,
  pine: /\bpine\b/i,
  thermowood: /thermo[- ]?wood|thermally[- ]modified/i,
};
const CONSTRUCT_HINT =
  /(constructed|construction|made (?:of|from|with)|crafted|built (?:of|from|with)|wood:|walls?|panels? (?:of|made))/i;

/* ── sauna rules ──────────────────────────────────────────────────────── */

function deriveSauna(p: ProductInput): DerivedProduct {
  const title = p.title || "";
  const tags = p.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const body = stripHtml(p.descriptionHtml);
  const tl = title.toLowerCase();
  const bl = body.toLowerCase();
  const flags: string[] = [];
  const facets: Record<string, DerivedFacet> = {};

  /* capacity */
  const capTitle = capsFrom(title);
  const capSingles = new Set<number>();
  const capRanges = new Set<number>();
  for (const t of tags) {
    const single = t.match(/^(\d)[- ]person$/);
    if (single) capSingles.add(parseInt(single[1], 10));
    else for (const n of capsFrom(t)) capRanges.add(n);
  }
  let cap: number[] = [];
  let capConf: Confidence = "none";
  if (capTitle.size) {
    cap = [...capTitle].sort((a, b) => a - b);
    const overlap = [...capTitle].some((n) => capSingles.has(n));
    capConf = !capSingles.size || overlap ? "high" : "medium";
    if (capSingles.size && !overlap)
      flags.push(
        `capacity conflict: title says ${[...capTitle].sort().join(",")} but tags say ${[...capSingles].sort().join(",")}`
      );
  } else if (capSingles.size) {
    cap = [...capSingles].sort((a, b) => a - b);
    capConf = "medium";
    flags.push("capacity from tags only (no capacity in title)");
  } else {
    const capBody = capsFrom(body);
    if (capBody.size) {
      cap = [...capBody].sort((a, b) => a - b);
      capConf = "low";
      flags.push("capacity only found in description");
    } else if (capRanges.size) {
      cap = [...capRanges].sort((a, b) => a - b);
      capConf = "low";
      flags.push("capacity only from range bucket tags — verify");
    } else {
      flags.push("capacity NOT FOUND");
    }
  }
  facets.capacity = {
    value: cap.length ? cap.map((n) => `${n}-person`) : null,
    confidence: capConf,
  };

  /* placement */
  const hasIn = tags.includes("indoor") || wb("indoor", tl);
  const hasOut = tags.includes("outdoor") || wb("outdoor", tl);
  let placement = "";
  let pConf: Confidence = "none";
  if (hasIn && hasOut) {
    placement = "indoor-outdoor";
    pConf = "medium";
    flags.push("tagged both indoor and outdoor — confirm dual-rating vs tag error");
  } else if (hasIn) {
    placement = "indoor";
    pConf = "high";
  } else if (hasOut) {
    placement = "outdoor";
    pConf = "high";
  } else if (tags.includes("barrel") || wb("barrel", tl)) {
    placement = "outdoor";
    pConf = "medium";
    flags.push("placement inferred from barrel type");
  } else if (wb("outdoor", bl) && !wb("indoor", bl)) {
    placement = "outdoor";
    pConf = "low";
    flags.push("placement from description only");
  } else if (wb("indoor", bl) && !wb("outdoor", bl)) {
    placement = "indoor";
    pConf = "low";
    flags.push("placement from description only");
  } else {
    flags.push("placement NOT FOUND");
  }
  facets.placement = { value: placement || null, confidence: pConf };

  /* heat type */
  const ir =
    tags.includes("infrared") ||
    tags.includes("far infrared") ||
    tags.includes("full spectrum") ||
    wb("infrared", tl) ||
    /\b(?:far\s+)?ir\b/i.test(tl);
  const trad = tags.includes("traditional") || wb("traditional", tl);
  const hybrid = tags.includes("hybrid") || wb("hybrid", tl);
  const steam = wb("steam", tl);
  let heat = "";
  let hConf: Confidence = "none";
  if (hybrid || (ir && trad)) {
    heat = "hybrid";
    hConf = hybrid ? "high" : "medium";
    if (!hybrid) flags.push("both infrared and traditional signals — set hybrid, confirm");
  } else if (ir) {
    heat = "infrared";
    hConf = "high";
  } else if (trad) {
    heat = "traditional";
    hConf = "high";
  } else if (steam) {
    heat = "steam";
    hConf = "medium";
  } else {
    flags.push("heat type NOT FOUND");
  }
  // LIST facet: hybrids carry all three values so they surface under the
  // Infrared, Traditional, AND Hybrid filter choices.
  facets.heatType = {
    value: heat === "hybrid" ? ["infrared", "traditional", "hybrid"] : heat ? [heat] : null,
    confidence: hConf,
  };

  /* heater type — LIST facet: every heater the sauna supports or is offered
     with. Ryan's rule (2026-08-10): EVERY traditional sauna works with an
     electric heater; only some accept a wood-burning stove, and a chimney/
     flue in the description is the #1 signifier of wood compatibility. */
  const heaters: string[] = [];
  const RANK: Record<Confidence, number> = { none: 0, low: 1, medium: 2, high: 3 };
  let htConf: Confidence = "none";
  const bump = (c: Confidence) => {
    if (RANK[c] > RANK[htConf]) htConf = c;
  };
  if (heat === "infrared" || heat === "hybrid") {
    const fs =
      tags.includes("full spectrum") ||
      tags.includes("full-spectrum-infrared") ||
      wb("full spectrum", tl) ||
      wb("full spectrum", bl);
    const far =
      tags.includes("far infrared") || /\bfar\b/i.test(tl) || wb("far infrared", bl);
    const carbon = wb("carbon", bl);
    if (fs) {
      heaters.push("full-spectrum");
      bump("high");
    } else if (far) {
      heaters.push("far-infrared");
      bump(carbon ? "high" : "medium");
    } else if (carbon) {
      heaters.push("far-infrared");
      bump("low");
      flags.push("heater type inferred from carbon panel mention");
    } else {
      flags.push("infrared spectrum type NOT FOUND");
    }
  }
  if (heat === "traditional" || heat === "hybrid") {
    heaters.push("electric"); // categorical: all traditional saunas take electric
    bump("high");
    const woodExplicit = /wood[- ](?:burning|fired)/i.test(tl + " " + bl);
    const chimney = /chimney|flue|smoke\s*(?:pipe|stack|vent)/i.test(bl);
    if (woodExplicit || chimney) {
      heaters.push("wood-burning");
    } else if (/ventilat/i.test(bl)) {
      flags.push(
        "mentions ventilation but no chimney or wood-stove wording — verify wood-heater compatibility"
      );
    }
  }
  facets.heaterType = {
    value: heaters.length ? [...new Set(heaters)] : null,
    confidence: heaters.length ? htConf : "none",
  };

  /* wood type */
  const tally = new Map<string, number>();
  for (const [wname, pat] of Object.entries(WOODS)) {
    const global = new RegExp(pat.source, "gi");
    for (const m of bl.matchAll(global)) {
      const idx = m.index ?? 0;
      const ctx = bl.slice(Math.max(0, idx - 80), idx + m[0].length + 80);
      tally.set(wname, (tally.get(wname) || 0) + (CONSTRUCT_HINT.test(ctx) ? 2 : 1));
    }
    if (pat.test(tl)) tally.set(wname, (tally.get(wname) || 0) + 4);
  }
  // LIST facet: many saunas legitimately use more than one wood (walls vs
  // benches, exterior vs interior), so include every wood with
  // construction-level evidence instead of forcing a single winner.
  let woods: string[] = [];
  let wConf: Confidence = "none";
  if (tally.size) {
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const strong = sorted.filter(([, s]) => s >= 2).map(([w]) => w);
    if (strong.length) {
      woods = strong;
      wConf = sorted[0][1] >= 4 ? "high" : "medium";
    } else {
      woods = [sorted[0][0]];
      wConf = "low";
      flags.push("wood type from a passing mention only — verify");
    }
  } else {
    flags.push("wood type NOT FOUND");
  }
  facets.woodType = { value: woods.length ? woods : null, confidence: wConf };

  /* EMF level (bonus, tags are already consistent) */
  let emf = "";
  for (const t of tags) {
    if (t === "near zero emf") emf = "near-zero-emf";
    else if (t === "ultra low emf") emf = "ultra-low-emf";
    else if (t === "low emf") emf = "low-emf";
    if (emf) break;
  }
  facets.emfLevel = { value: emf || null, confidence: emf ? "high" : "none" };

  return { facets, flags };
}

/* ── registry ─────────────────────────────────────────────────────────── */

const DERIVERS: Record<string, (p: ProductInput) => DerivedProduct> = {
  saunas: deriveSauna,
};

export function deriveProduct(category: FilterCategory, p: ProductInput): DerivedProduct {
  const fn = DERIVERS[category.key];
  if (!fn) {
    return {
      facets: Object.fromEntries(
        category.facets.map((f) => [f.key, { value: null, confidence: "none" as Confidence }])
      ),
      flags: [`no derivation rules registered for category "${category.key}"`],
    };
  }
  return fn(p);
}
