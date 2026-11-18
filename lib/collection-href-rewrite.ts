// lib/collection-href-rewrite.ts
//
// Rewrites links that point at retired collection URLs so they go straight
// to the destination instead of through the 301. Touches href values only:
// anchor text, prose, classes and everything else in the HTML are left as
// they are. Used by /api/maintenance/rewrite-collection-hrefs.

/**
 * Retired collection handle -> live destination handle.
 * Sauna consolidation wave 1, applied 16 Sep 2026. Extend for the December
 * barrel wave once those redirects are live.
 */
export const RETIRED_COLLECTION_REDIRECTS: Record<string, string> = {
  "1-person-traditional-sauna": "1-person-saunas",
  "1-person-traditional-saunas": "1-person-saunas",
  "2-person-traditional-sauna": "2-person-saunas",
  "3-person-traditional-sauna": "3-person-saunas",
  "4-person-traditional-sauna": "4-person-saunas",
  "5-person-traditional-sauna": "5-person-saunas",
  "6-person-traditional-sauna": "6-person-saunas",
  "8-person-traditional-sauna": "8-person-saunas",
  "2-person-hybrid-sauna": "hybrid-saunas",
  "3-person-hybrid-sauna": "hybrid-saunas",
  "4-person-hybrid-sauna": "hybrid-saunas",
  "outdoor-traditional-saunas": "traditional-saunas",
  "indoor-traditional-saunas": "traditional-saunas",
  "indoor-infrared-saunas": "infrared-saunas",
  "outdoor-infrared-saunas": "infrared-saunas",
  "dry-saunas": "traditional-saunas",
  "sauna-wood": "sauna-kits",
  "sauna-doors-glass": "sauna-doors",
  "ultra-low-emf-saunas": "low-emf-saunas",
  "near-zero-emf-saunas": "low-emf-saunas",
  "sauna-heater-accessories": "sauna-heater-parts",
};

export type HrefRewrite = {
  fixed: string;
  replacements: number;
  /** old handle -> number of hrefs rewritten */
  byHandle: Record<string, number>;
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite every href that targets /collections/<old> (relative or absolute,
 * with or without a trailing slash, with any query string or fragment) to
 * /collections/<new>, keeping the rest of the URL. Returns null when nothing
 * matched so callers can skip the write.
 */
export function buildHrefRewrite(html: string, map: Record<string, string>): HrefRewrite | null {
  const handles = Object.keys(map).filter((h) => h && map[h] && map[h] !== h);
  if (!html || handles.length === 0) return null;

  const alt = handles.map(escapeRe).join("|");
  // href="…/collections/<old>" followed by end of path: quote, slash, ?, #
  const re = new RegExp(
    `(href\\s*=\\s*(["']))((?:https?:\\/\\/(?:www\\.)?greenthumbdepot\\.com)?\\/collections\\/)(${alt})(?=\\/?(?:[?#][^"']*)?\\2)`,
    "gi"
  );

  const byHandle: Record<string, number> = {};
  let replacements = 0;
  const fixed = html.replace(re, (_m, pre: string, _q: string, base: string, old: string) => {
    const key = old.toLowerCase();
    const dest = map[key] ?? map[old];
    if (!dest) return _m;
    byHandle[key] = (byHandle[key] || 0) + 1;
    replacements++;
    return `${pre}${base}${dest}`;
  });

  return replacements > 0 ? { fixed, replacements, byHandle } : null;
}
