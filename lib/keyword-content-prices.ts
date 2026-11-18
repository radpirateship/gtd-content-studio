// lib/keyword-content-prices.ts
// Remove dollar figures from collection copy. House rule (Ryan, 25 Oct 2026):
// prices and compare-at pricing change too often for figures in copy to stay
// true, and the product grid already shows the real numbers.
//
// mode "new": only figures that are NOT already in the baseline (live) body,
//             i.e. ones a draft introduced. Used automatically before publish.
// mode "all": every figure in the body. Used by the "Strip prices" button.
import { callAI } from "@/lib/ai";

const MONEY = /\$\s?\d[\d,]*(?:\.\d{2})?/g;
const figuresIn = (html: string): Set<number> => {
  const out = new Set<number>();
  for (const m of html.matchAll(MONEY)) { const n = Math.round(parseFloat(m[0].replace(/[$,\s]/g, ""))); if (Number.isFinite(n)) out.add(n); }
  return out;
};
const stripTags = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Mechanical removal of price phrases from a plain-text sentence or heading. */
export function stripPricePhrases(text: string): string {
  let t = text;
  const money = String.raw`\$\s?\d[\d,]*(?:\.\d{2})?`;
  const patterns: RegExp[] = [
    new RegExp(String.raw`\s*\(\s*(?:from|starting at|under|about|around)?\s*${money}(?:\s*(?:to|-|–)\s*${money})?\s*\)`, "gi"),           // "(from $X to $Y)"
    new RegExp(String.raw`,?\s*(?:priced|starting|ranging)\s+(?:at|from)\s+${money}(?:\s*(?:to|-|–|and)\s*${money})?`, "gi"),           // "starting at $X to $Y"
    new RegExp(String.raw`,?\s*(?:from|under|below|above|over|around|about|at|for|near)\s+${money}(?:\s*(?:to|-|–|and)\s*${money})?(?:\s+(?:less|more))?`, "gi"), // "from $X to $Y", "for $X less"
    new RegExp(String.raw`\s*${money}\s*(?:to|-|–)\s*${money}`, "gi"),                                                                   // "$X to $Y"
    new RegExp(String.raw`\s*${money}\+?`, "gi"),                                                                                        // bare "$X"
  ];
  for (const re of patterns) t = t.replace(re, "");
  return t
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s*[-–]\s*$/g, "")
    .replace(/:\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

export type StripResult = { html: string; changed: number; rewritten: string[]; untouched: number[] };

/**
 * Rewrite the text of every element that carries a dollar figure so it reads
 * naturally without one. Element boundaries, tags and attributes are kept; only
 * the inner text of leaf-ish elements (p, li, h2, h3, h4, td, th, span, strong,
 * em, figcaption, summary) changes. ld+json is left alone.
 */
export async function stripPricesFromHtml(html: string, opts: { mode: "new" | "all"; baselineHtml?: string; handle?: string }): Promise<StripResult> {
  // "new" mode: an element is left alone only when its exact text was already on the live
  // page. A draft that re-quotes an old figure in a NEW sentence or heading still gets stripped.
  const baselineText = opts.mode === "new" && opts.baselineHtml ? " " + stripTags(opts.baselineHtml).toLowerCase() + " " : "";
  const result: StripResult = { html, changed: 0, rewritten: [], untouched: [] };

  // protect schema blocks
  const schema: string[] = [];
  let work = html.replace(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, (m) => { schema.push(m); return `__SCHEMA_${schema.length - 1}__`; });

  // collect candidate elements: innermost elements whose text has a figure we must remove
  const elRe = /<(p|li|h2|h3|h4|td|th|figcaption|summary|dd|dt)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const targets: Array<{ full: string; tag: string; attrs: string; inner: string; text: string }> = [];
  for (const m of work.matchAll(elRe)) {
    const inner = m[3];
    if (!/\$\s?\d/.test(inner)) continue;
    if (/<(p|li|h2|h3|h4|td|th)\b/i.test(inner)) continue; // not innermost, its children will be matched
    const figs = figuresIn(inner);
    const text = stripTags(inner).toLowerCase();
    if (baselineText && text && baselineText.includes(" " + text + " ")) { result.untouched.push(...figs); continue; }
    targets.push({ full: m[0], tag: m[1], attrs: m[2], inner, text: stripTags(inner) });
  }
  if (!targets.length) { result.html = html; return result; }

  // one AI call for the batch; fall back to the mechanical strip per element
  let rewrites: Record<string, string> = {};
  try {
    const user = `Rewrite each of these sentences or headings from a product collection page so it reads naturally WITHOUT any dollar figure, price range or "from $X". Keep the meaning and every keyword, brand and product name; where a figure carried meaning, say it qualitatively (entry-level, mid-range, premium, "a step up", "a fraction of the cost"). Keep headings as headings (short, Title Case where the original is). No em dashes or en dashes. Return ONLY JSON: an object mapping the number to the rewritten text.
${targets.map((t, i) => `${i + 1}. ${t.text}`).join("\n")}`;
    const raw = await callAI("You edit ecommerce copy. Return only JSON.", user, { maxTokens: 2500, timeoutMs: 120000, retryOnTimeout: false });
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) rewrites = JSON.parse(m[0]);
  } catch { rewrites = {}; }

  targets.forEach((t, i) => {
    let newText = String(rewrites[String(i + 1)] || "").replace(/[—–]/g, "-").trim();
    if (!newText || /\$\s?\d/.test(newText) || newText.length > t.text.length * 1.3) newText = stripPricePhrases(t.text);
    if (/\$\s?\d/.test(newText)) newText = newText.replace(MONEY, "").replace(/\s{2,}/g, " ").trim();
    if (!newText || newText === t.text) return;
    // Preserve simple inline markup when the element has none; otherwise replace inner text wholesale.
    const hasInline = /<[a-z]/i.test(t.inner);
    const newInner = hasInline ? t.inner.replace(stripTags(t.inner), newText).replace(MONEY, "") : newText;
    const finalInner = /\$\s?\d/.test(stripTags(newInner)) ? newText : newInner;
    work = work.replace(t.full, `<${t.tag}${t.attrs}>${finalInner}</${t.tag}>`);
    result.changed++;
    result.rewritten.push(`${t.tag}: ${newText.slice(0, 140)}`);
  });

  result.html = work.replace(/__SCHEMA_(\d+)__/g, (_m, i) => schema[Number(i)]);
  return result;
}
