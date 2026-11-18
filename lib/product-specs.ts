// lib/product-specs.ts
// Pull card bullets from the product's OWN description before falling back to
// keyword matching.
//
// Roughly half of GTD products carry a <ul> in the Shopify description, and
// those bullets are frequently better than anything a regex can synthesise:
// "Thermowood + fiberglass build", "3C to 38C control range", "Canadian cedar
// exterior housing". Nothing here is invented: every bullet returned is text
// the vendor wrote, trimmed and length-capped.
//
// The catch is that not every <ul> is a spec list. Some are exercise menus
// ("Belt Squats", "Low Rows", "Lat Pull Downs") and some are marketing
// sentences. Items are therefore scored, and only ones that read as specs
// are used.

export type SpecSource = "description" | "keyword-map" | "fallback";

const decode = (s: string) =>
  s
    .replace(/&nbsp;| /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// A number with a unit is the strongest signal that a line states a spec.
const UNIT = /\b\d[\d,.]*\s*(?:lb|lbs|pound|kg|in|inch|"|ft|foot|feet|mm|cm|m|gal|gallon|w|kw|hp|mph|nm|ata|amp|a|v|volt|hz|psi|micron|person|people|year|yr|degree|°|c\b|f\b)/i;
const MATERIAL = /\b(?:stainless|steel|aluminium|aluminum|cedar|hemlock|spruce|thermowood|fiberglass|fibreglass|acrylic|hardwood|beech|oak|birch|glass|carbon|titanium|copper|brass|leather|vinyl|rubber|urethane|powder[\s-]?coat)\b/i;
const FEATURE =
  /\b(?:filtration|filter|ozone|uv|chiller|cooling|heater|heating|insulat|warranty|capacity|control|app|bluetooth|wifi|wi-fi|touchscreen|panel|monitor|console|resistance|adjustable|foldable|portable|assembly|certified|rated|emf|wavelength|irradiance|pressure|flow|pump|drain|sanit)\b/i;
// Exercise menus are the commonest false positive: a list of movements, not specs.
// Plurals matter here: "pull-ups" slipped past a pattern anchored on
// "pull-up" because the trailing \b failed against the "s".
const EXERCISE =
  /\b(?:squat|row|rowing|curl|press|pull[\s-]?up|chin[\s-]?up|dip|fly|flie|deadlift|lunge|crunch|extension|raise|thrust|shrug|pushdown|pulldown|plank)(?:e?s)?\b/i;
const MARKETING_ONLY = /^(?:free shipping|fast shipping|best seller|new|sale|limited|award[\s-]?winning|customer favou?rite)\b/i;

function score(text: string): number {
  if (!text) return -99;
  const words = text.split(/\s+/).length;
  if (words < 2 || words > 14) return -99;
  if (MARKETING_ONLY.test(text)) return -99;
  // Exercise menus ("Supports pull-ups, stretching and resistance training")
  // are not specs. Only a hard number rescues one, e.g. "Leg curl station with
  // a 200 lb stack".
  if (EXERCISE.test(text) && !UNIT.test(text)) return -99;
  let s = 0;
  if (UNIT.test(text)) s += 3;
  if (MATERIAL.test(text)) s += 2;
  if (FEATURE.test(text)) s += 2;
  if (words >= 3) s += 1;
  if (text.length <= 46) s += 1;
  return s;
}

/**
 * A vendor bullet often reads "Label:  a full sentence of detail". The label
 * alone is the card-sized version, provided the label is not generic filler
 * like "High-Quality Construction", in which case the detail carries the fact.
 */
// Spec-sheet field names. "Irradiance" alone says nothing; "Irradiance: 140
// mW/cm2" is the fact, so for these the value is kept with the label.
const SPEC_FIELD = /^(?:irradiance|wavelength|wavelengths?\s*coverage|voltage|input\s*voltage|power|led\s*power|dimensions?|device\s*dimensions|weight|capacity|warranty|material|size|output|frequency|coverage|resistance|speed|temperature|range)\b/i;

function trimTrailingJoiner(text: string): string {
  // Truncation leaves dangling joiners: "...construction for durability and".
  return text.replace(/[\s,;:-]+(?:and|or|with|for|to|the|a|an|in|of|from|&|plus)\s*$/i, "").replace(/[\s,;:-]+$/, "");
}

function toCardLabel(raw: string): string {
  let text = raw.replace(/\s*[.;]+\s*$/, "").trim();
  const m = text.match(/^([^:]{3,44}):\s*(.+)$/);
  if (m) {
    const label = m[1].trim();
    const detail = m[2].trim();
    const genericLabel = /^(?:high[\s-]?quality|premium|superior|excellent|great|durable|versatile|inclusive|comprehensive|enhanced|customi[sz]able|secure|advanced)\b/i.test(label);
    if (SPEC_FIELD.test(label)) {
      // Keep the pair when it fits; the number is the point.
      const pair = `${label}: ${detail}`;
      text = pair.length <= 52 ? pair : detail;
    } else {
      text = genericLabel ? detail : label;
    }
  }
  if (text.length > 52) {
    const cut = text.slice(0, 52);
    const lastSpace = cut.lastIndexOf(" ");
    text = lastSpace > 24 ? cut.slice(0, lastSpace) : cut;
  }
  text = trimTrailingJoiner(text);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Card bullets taken from the product's own description list.
 * Returns at most `max`, best first, deduped. Empty when the description has
 * no list, or nothing in it reads as a spec.
 */
export function specsFromDescription(description: string | undefined, max = 3): string[] {
  const html = description || "";
  if (!html) return [];

  const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => stripTags(m[1])).filter(Boolean);

  // No list markup: some vendors write "Capacity: 3 person" lines as plain
  // text separated by breaks. Treat those the same way.
  const lines = items.length
    ? items
    : stripTags(html.replace(/<br\s*\/?>|<\/p>/gi, "\n")).split("\n").map((l) => l.trim()).filter((l) => /^[A-Z][A-Za-z /()-]{2,28}:\s*\S/.test(l));

  const scored = lines
    .map((text) => ({ text, s: score(text) }))
    .filter((x) => x.s > 2)
    .sort((a, b) => b.s - a.s);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const { text } of scored) {
    const label = toCardLabel(text);
    // A field name on its own ("Irradiance", "Device Dimensions") carries no
    // information once its value has been dropped.
    if (SPEC_FIELD.test(label) && !/\d/.test(label)) continue;
    if (label.split(/\s+/).length < 2 && !/\d/.test(label)) continue;
    const key = label.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= max) break;
  }
  return out;
}
