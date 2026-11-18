/**
 * Legacy H2 anchor fixer.
 *
 * Old articles carry descriptive H2 anchors — listicle style
 * (id="1-reathlete-necka-best-overall") AND guide style
 * (id="why-the-stair-climber-deserves-a-spot-in-your-routine",
 * id="key-takeaways") — which Google AI Mode indexes as separate zero-CTR
 * SERP entries.
 *
 * This mirrors what the fixed generator now does for new articles: every H2
 * id becomes a sequential section-N, and the TOC href="#..." links are
 * rewritten in the SAME single pass so headings and TOC can never desync.
 * Non-H2 anchors (e.g. the theme's <section id="overview">) are untouched,
 * matching the generator, so TOC links pointing at them keep working.
 */

const H2_ID = /<h2\b[^>]*?\bid="([^"]+)"/gi;
const SECTION_FORMAT = /^section-\d+$/;
const EXISTING_SECTION = /\bid="section-(\d+)"/g;
const ANY_ID = /\bid="([^"]+)"/g;
const TOKEN = /(id="|href="#)([^"]+)"/g;

export type FixResult = {
  fixed: string;
  replacements: number;
  /** TOC links that point at an id that exists nowhere in the doc (pre-existing breakage, left as-is). */
  brokenLinks: number;
  mapping: Record<string, string>;
};

export function buildFix(html: string): FixResult | null {
  // Section numbers already used anywhere in the doc (avoid collisions on
  // re-runs or partially migrated articles).
  const used = new Set<number>();
  for (const m of html.matchAll(EXISTING_SECTION)) used.add(Number(m[1]));

  // Descriptive H2 ids in document order -> sequential section-N.
  const map = new Map<string, string>();
  let n = 0;
  for (const m of html.matchAll(H2_ID)) {
    const id = m[1];
    if (SECTION_FORMAT.test(id) || map.has(id)) continue;
    do {
      n++;
    } while (used.has(n));
    map.set(id, `section-${n}`);
  }
  if (map.size === 0) return null;

  // Every id in the doc, for detecting already-broken TOC links.
  const allIds = new Set<string>();
  for (const m of html.matchAll(ANY_ID)) allIds.add(m[1]);

  let replacements = 0;
  let brokenLinks = 0;
  const fixed = html.replace(TOKEN, (full, prefix: string, slug: string) => {
    const to = map.get(slug);
    if (!to) {
      // Not a mapped H2 anchor. Leave it, but surface TOC links that point
      // at nothing (pre-existing breakage worth knowing about).
      if (prefix === 'href="#' && !allIds.has(slug)) brokenLinks++;
      return full;
    }
    replacements++;
    return `${prefix}${to}"`;
  });

  return { fixed, replacements, brokenLinks, mapping: Object.fromEntries(map) };
}
