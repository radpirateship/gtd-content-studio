// lib/keyword-content.ts
// Content phase of the collection keyword audit: get the primary and the
// long-tail secondaries into the page copy naturally. Two moves, both
// conservative: weave a keyword into an existing sentence with a minimal
// edit, or add a short new H2 section (from the audit's h2_additions) built
// in the page's own wrapper. Output is a draft for the Improve preview; the
// operator publishes per page. Nothing here touches Shopify.
import { callAI } from "@/lib/ai";
import { WRITING_RULES, stripEmDashes } from "@/lib/brandRules";
import { blocksOf, findBlock, insertAfterBlock, type Block } from "@/lib/collection-improve-engine";
import type { Recommendation } from "@/lib/keyword-audit";
import { normWords } from "@/lib/keyword-audit-facts";
import type { Product } from "@/lib/product-store";

const stripTags = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const normText = (t: string) => " " + normWords(t).join(" ") + " ";
const normPhrase = (p: string) => " " + normWords(p).join(" ") + " ";

export type Coverage = { keyword: string; isPrimary: boolean; isTerm?: boolean; inBody: number; inHeadings: boolean; inOpening: boolean; ok: boolean };

/**
 * Where each keyword already appears: body count (plural tolerant), any H2/H3, the first paragraph.
 * Target (Ryan, 26 Oct 2026): primary in the opening and a heading; each secondary in a heading AND
 * at least twice in the body; each must-mention term at least once anywhere.
 */
export function keywordCoverage(bodyHtml: string, primary: string, secondaries: string[], mustTerms: string[] = []): Coverage[] {
  const bodyN = normText(stripTags(bodyHtml));
  const headings = normText((bodyHtml.match(/<h[23][^>]*>[\s\S]*?<\/h[23]>/gi) || []).map(stripTags).join(" | "));
  const openingP = bodyHtml.match(/<p[^>]*>[\s\S]*?<\/p>/i)?.[0] || "";
  const opening = normText(stripTags(openingP));
  const kws = [primary, ...secondaries].map((k) => (k || "").trim()).filter(Boolean);
  const terms = mustTerms.map((k) => (k || "").trim()).filter(Boolean);
  const row = (kw: string, isPrimary: boolean, isTerm: boolean): Coverage => {
    const p = normPhrase(kw);
    const count = p.trim() ? bodyN.split(p).length - 1 : 0;
    const inH = headings.includes(p), inO = opening.includes(p);
    const ok = isTerm ? count >= 1 : isPrimary ? count >= 2 && (inH || inO) : count >= 2 && inH;
    return { keyword: kw, isPrimary, isTerm, inBody: count, inHeadings: inH, inOpening: inO, ok };
  };
  return [...kws.map((kw, i) => row(kw, i === 0, false)), ...terms.map((t) => row(t, false, true))];
}

type Weave = { find: string; replace: string; keyword: string };
type Section = { h2: string; html: string; keywords: string[] };
export type ContentDraft = {
  bodyHtml: string;
  before: Coverage[];
  after: Coverage[];
  weaves: Array<{ keyword: string; sentence: string; status: "applied" | "skipped"; why?: string }>;
  sections: Array<{ h2: string; keywords: string[]; status: "added" | "skipped"; why?: string }>;
  unplaced: string[];
};

/** Candidate sentences: plain <p> text, 60 to 320 chars, no list items or links inside. */
function candidateSentences(bodyHtml: string): string[] {
  const out: string[] = [];
  for (const m of bodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    if (/<(a|ul|ol|li|strong|h\d)\b/i.test(m[1])) continue;
    const text = stripTags(m[1]);
    for (const s of text.split(/(?<=[.!?])\s+/)) if (s.length >= 60 && s.length <= 320) out.push(s.trim());
  }
  return out.slice(0, 40);
}

export async function draftKeywordContent(opts: {
  handle: string;
  bodyHtml: string;
  rec: Recommendation;
  products: Product[];
  category?: string | null;
  maxSections?: number;
  mustTerms?: string[];
}): Promise<ContentDraft> {
  const { handle, rec } = opts;
  const maxSections = opts.maxSections ?? 3;
  const mustTerms = opts.mustTerms || [];
  const before = keywordCoverage(opts.bodyHtml, rec.primary, rec.secondaries || [], mustTerms);
  const uncovered = before.filter((c) => !c.isTerm && c.inBody === 0).map((c) => c.keyword);
  // secondaries present but short of the target (not in a heading, or fewer than two mentions)
  const thin = before.filter((c) => !c.isTerm && !c.isPrimary && c.inBody > 0 && !c.ok).map((c) => c.keyword);
  const termsMissing = before.filter((c) => c.isTerm && c.inBody === 0).map((c) => c.keyword);
  const result: ContentDraft = { bodyHtml: opts.bodyHtml, before, after: before, weaves: [], sections: [], unplaced: [] };
  if (!uncovered.length && !thin.length && !termsMissing.length) return result;

  const blocks = blocksOf(opts.bodyHtml);
  const wrapperClass = blocks[0]?.html.match(/<section\b[^>]*class="([^"]*)"/i)?.[1] || "";
  const existingH2s = blocks.map((b) => b.heading).filter(Boolean);
  const sentences = candidateSentences(opts.bodyHtml);
  const prods = opts.products.slice(0, 12).map((p) => `${p.title}${p.vendor ? ` (${p.vendor})` : ""}`);
  const vendors = Array.from(new Set(opts.products.map((p) => p.vendor).filter(Boolean))) as string[];

  const system = `You are the senior SEO copywriter at Green Thumb Depot, a premium wellness equipment retailer. You work long-tail keywords into collection page copy so that it reads as if a knowledgeable salesperson wrote it. The keyword must sit in the sentence naturally; if a keyword cannot be used without sounding forced, leave it out and say so.
${WRITING_RULES}
HARD RULES:
- No em dashes, no en dashes. Colons (not dashes) as bullet label separators. "to" for ranges. Never start a sentence with "Discover".
- Only name brands from this list: ${vendors.join(", ") || "none"}. Only reference products from the PRODUCTS list. Never invent specs, certifications or awards; if you do not have a fact, write around it.
- NO PRICES: never write a dollar figure, a price range or "from $X". Prices change and compare-at pricing comes and goes, so copy with figures goes stale. Talk about value qualitatively (entry-level, mid-range, premium, what the extra money buys) and let the product grid show the numbers.
- Write for someone buying their first one: say what the thing does for them before how it is built.
- Return ONLY JSON.`;

  const user = `Collection: /collections/${handle}${opts.category ? ` (hub: ${opts.category})` : ""}.
Primary keyword: "${rec.primary}".
TARGET: every secondary keyword appears in an H2 heading AND at least twice in the body; the primary appears in the opening paragraph and a heading.
Keywords NOT yet in the copy (highest priority, in order): ${uncovered.map((k) => `"${k}"`).join(", ") || "none"}.
Keywords present but short of the target (need a heading and/or a second natural mention): ${thin.map((k) => `"${k}"`).join(", ") || "none"}.
Vocabulary an expert page on this topic uses, each needs ONE natural mention (weave only, no new section for these): ${termsMissing.map((k) => `"${k}"`).join(", ") || "none"}.
Existing H2 headings on the page: ${existingH2s.map((h) => `"${h}"`).join(", ") || "none"}.
Section ideas from the keyword audit (use as the basis for new sections, only where they carry an uncovered keyword): ${(rec.h2_additions || []).map((h) => `"${h}"`).join(", ") || "none"}.
PRODUCTS (live, for facts): ${prods.join("; ") || "none"}.

EXISTING SENTENCES you may edit (copy the "find" text EXACTLY as given, character for character):
${sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Return JSON: {
  "weaves": [ { "keyword": "...", "find": "<one of the sentences above, verbatim>", "replace": "<the same sentence rewritten with the keyword, same meaning, at most 25% longer>" } ],
  "sections": [ { "h2": "<heading that contains the keyword naturally, Title Case, no dash>", "keywords": ["..."], "html": "<section${wrapperClass ? ` class=\\"${wrapperClass}\\"` : ""}><h2>...</h2><p>...</p><p>...</p></section>" } ],
  "unplaced": [ "<keyword you could not use naturally>" ]
}
Rules for weaves: at most 8; one keyword or term per sentence; prefer uncovered keywords, then thin ones, then vocabulary terms; a weave must read as if the sentence was always written that way; never put the same keyword into two adjacent sentences.
Rules for sections: at most ${maxSections}; 110 to 170 words each; two or three short paragraphs; no bullet lists; each section's H2 carries one uncovered or thin secondary keyword and the body uses it once more; it answers a real buyer question (sizing, placement, what to look for, who it suits); do not repeat an existing H2 topic. Use the exact wrapper shown.`;

  let gen: { weaves?: Weave[]; sections?: Section[]; unplaced?: string[] } = {};
  try {
    const raw = await callAI(system, user, { maxTokens: 3500, timeoutMs: 150000, retryOnTimeout: false });
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) gen = JSON.parse(m[0]);
  } catch (e) {
    result.unplaced = uncovered;
    result.weaves.push({ keyword: "", sentence: "", status: "skipped", why: `generation failed: ${e instanceof Error ? e.message : String(e)}` });
    return result;
  }

  let body = opts.bodyHtml;
  const has = (text: string, kw: string) => normText(text).includes(normPhrase(kw));

  for (const w of gen.weaves || []) {
    if (!w?.find || !w?.replace || !w?.keyword) continue;
    const rep = stripEmDashes(w.replace).replace(/[—–]/g, "-");
    const occurrences = body.split(w.find).length - 1;
    if (occurrences !== 1) { result.weaves.push({ keyword: w.keyword, sentence: rep, status: "skipped", why: occurrences === 0 ? "sentence not found verbatim" : "sentence appears more than once" }); continue; }
    if (!has(rep, w.keyword)) { result.weaves.push({ keyword: w.keyword, sentence: rep, status: "skipped", why: "rewrite does not contain the keyword" }); continue; }
    if (/\$\s?\d/.test(rep) && !/\$\s?\d/.test(w.find)) { result.weaves.push({ keyword: w.keyword, sentence: rep, status: "skipped", why: "rewrite added a price" }); continue; }
    if (rep.length > w.find.length * 1.4) { result.weaves.push({ keyword: w.keyword, sentence: rep, status: "skipped", why: "rewrite too long" }); continue; }
    body = body.replace(w.find, () => rep);
    result.weaves.push({ keyword: w.keyword, sentence: rep, status: "applied" });
  }

  const blocksNow = blocksOf(body);
  const anchor: Block | null = findBlock(blocksNow, /faq|frequently asked|learning center|related (guides|articles)/i);
  let added = 0;
  for (const s of gen.sections || []) {
    if (added >= maxSections) break;
    if (!s?.html || !s?.h2) continue;
    let html = stripEmDashes(s.html).replace(/[—–]/g, "-").trim();
    if (!/^<section/i.test(html) || !/<h2[^>]*>/i.test(html)) { result.sections.push({ h2: s.h2, keywords: s.keywords || [], status: "skipped", why: "not a section with an H2" }); continue; }
    if (/<(ul|ol|a|script|img)\b/i.test(html)) { result.sections.push({ h2: s.h2, keywords: s.keywords || [], status: "skipped", why: "contains lists, links or media" }); continue; }
    if (/\$\s?\d/.test(html)) { result.sections.push({ h2: s.h2, keywords: s.keywords || [], status: "skipped", why: "contains a price" }); continue; }
    const words = stripTags(html).split(/\s+/).length;
    if (words < 80 || words > 230) { result.sections.push({ h2: s.h2, keywords: s.keywords || [], status: "skipped", why: `${words} words` }); continue; }
    const kws = (s.keywords || []).filter((k) => has(html, k));
    if (!kws.length) { result.sections.push({ h2: s.h2, keywords: s.keywords || [], status: "skipped", why: "keyword not in section text" }); continue; }
    if (existingH2s.some((h) => normText(h) === normText(s.h2))) { result.sections.push({ h2: s.h2, keywords: kws, status: "skipped", why: "duplicate heading" }); continue; }
    if (anchor) {
      // insert before the FAQ / learning-center block so the page keeps its tail
      const a = blocksOf(body).find((b) => b.heading === anchor.heading);
      body = a ? body.slice(0, a.start) + html + "\n" + body.slice(a.start) : insertAfterBlock(body, blocksOf(body).slice(-1)[0], html);
    } else {
      const last = blocksOf(body).slice(-1)[0];
      body = last ? insertAfterBlock(body, last, html) : body + "\n" + html;
    }
    added++;
    result.sections.push({ h2: s.h2, keywords: kws, status: "added" });
  }

  result.bodyHtml = body;
  result.after = keywordCoverage(body, rec.primary, rec.secondaries || [], mustTerms);
  result.unplaced = Array.from(new Set([...(gen.unplaced || []), ...result.after.filter((c) => c.inBody === 0).map((c) => c.keyword)]));
  return result;
}
