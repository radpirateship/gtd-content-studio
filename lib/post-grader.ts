/**
 * PPW Post Grader — deterministic core-element checks for existing articles.
 *
 * Grades WITHOUT rewriting: every check is a code inspection of body_html, so
 * ranking articles are never touched. Failures map to targeted fixes (anchor
 * fixer, link injector, FAQ repair) — full rewrite is an escalation for posts
 * that fail on substance, not a default.
 *
 * IMPORTANT: article body_html embeds a <style> block that defines the ppw-*
 * classes (.ppw-faq-question, .ppw-topnav, ...). ALL structural checks must
 * run on markup with <style>/<script> stripped, or the CSS definitions false-
 * positive as content (v1 flagged 965/980 posts as "FAQ swallowed table").
 * Schema checks are the exception — JSON-LD lives inside <script> tags.
 */

import { buildFix } from "@/lib/fix-anchors";
import { auditCollectionLinks } from "@/lib/collection-links";
import { validateBrandRules } from "@/lib/brandRules";

export type CheckResult = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

export type PostGrade = {
  checks: CheckResult[];
  score: number;
  failures: string[];
  wordCount: number;
  collectionLinkCount: number;
  /** 0-100 brand-voice compliance (banned phrases, naming, em dashes). */
  voiceScore: number;
};

function stripStylesScripts(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
}

export function gradePost(html: string): PostGrade {
  const checks: CheckResult[] = [];
  const add = (id: string, label: string, pass: boolean, detail = "") =>
    checks.push({ id, label, pass, detail });

  const body = html || "";
  // Markup with CSS/JS stripped — the coordinate system for ALL structure checks.
  const clean = stripStylesScripts(body);
  const text = clean.replace(/<[^>]+>/g, " ");
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // ── Brand rules ────────────────────────────────────────────────────────────
  const emDashes = (text.match(/—|&#8212;|&mdash;/g) || []).length;
  add("em-dashes", "No em dashes", emDashes === 0, emDashes ? `${emDashes} found` : "");

  // Brand voice compliance: banned phrases and naming violations carry more
  // weight than em dashes (which have their own check + fixer).
  const voice = validateBrandRules(body);
  const voicePenalty =
    emDashes * 2 + voice.bannedPhrasesFound.length * 8 + voice.namingViolations.length * 8;
  const voiceScore = Math.max(0, 100 - Math.min(100, voicePenalty));
  const voiceOffenders = [
    ...voice.bannedPhrasesFound.map((ph) => `"${ph}"`),
    ...voice.namingViolations,
  ];
  add(
    "brand-voice",
    "Brand voice compliant",
    voiceScore >= 85,
    voiceScore < 100
      ? `voice score ${voiceScore}/100${voiceOffenders.length ? ` — ${voiceOffenders.slice(0, 4).join(", ")}` : ""}`
      : ""
  );

  // ── Anchors ────────────────────────────────────────────────────────────────
  const anchorFix = buildFix(clean);
  add(
    "anchors",
    "H2 anchors in section-N format",
    anchorFix === null,
    anchorFix ? `${Object.keys(anchorFix.mapping).length} legacy IDs` : ""
  );

  // ── Collection links ───────────────────────────────────────────────────────
  const links = auditCollectionLinks(clean);
  add(
    "collection-links",
    "1-2 in-content collection links",
    links.inContent.length >= 1,
    `${links.inContent.length} in-content${links.inContent.length === 1 ? " (ideal is 2)" : ""}`
  );
  add("bottom-cta", "Shop The Collection button", links.ctaButtons > 0);
  // NOTE: Finnmark links are deliberately NOT flagged — the brand is out of
  // stock but returning (Ryan, July 6). Existing mentions/links stay untouched.

  // ── FAQ presence + structural integrity (on clean markup only) ────────────
  const faqIdx = clean.search(/class="[^"]*ppw-faq|<h2[^>]*>\s*(Frequently Asked Questions|FAQs?)\s*</i);
  const relatedIdx = clean.search(/Continue Your Wellness Journey/i);
  add("faq-present", "FAQ section exists", faqIdx !== -1);

  if (faqIdx !== -1) {
    // Two legitimate FAQ formats exist across article generations:
    //   A) <details> + .ppw-faq-question / .ppw-faq-answer
    //   B) .ppw-accordion + .ppw-acc-btn / .ppw-acc-panel
    const qA = (clean.match(/class="[^"]*ppw-faq-question/g) || []).length;
    const aA = (clean.match(/class="[^"]*ppw-faq-answer/g) || []).length;
    const qB = (clean.match(/class="[^"]*ppw-acc-btn/g) || []).length;
    const aB = (clean.match(/class="[^"]*ppw-acc-panel/g) || []).length;
    const detailsCount = (clean.match(/<details\b/g) || []).length;

    // FAQ region ends at the last answer of whichever format is present;
    // fallback: the FAQ's own section (up to the next <h2), not a fixed window.
    let regionEnd = -1;
    const lastAnswerA = clean.lastIndexOf('class="ppw-faq-answer"');
    if (lastAnswerA !== -1) {
      const e = clean.indexOf("</details>", lastAnswerA);
      regionEnd = Math.max(regionEnd, e !== -1 ? e : lastAnswerA);
    }
    const lastPanelB = clean.lastIndexOf('class="ppw-acc-panel"');
    if (lastPanelB !== -1) {
      const e = clean.indexOf("</div>", lastPanelB);
      regionEnd = Math.max(regionEnd, e !== -1 ? e : lastPanelB);
    }
    if (regionEnd === -1) {
      const nextH2 = clean.indexOf("<h2", faqIdx + 10);
      regionEnd = nextH2 !== -1 ? nextH2 : Math.min(clean.length, faqIdx + 20000);
    }
    const faqRegion = clean.slice(faqIdx, regionEnd);

    const gridInFaq = /class="[^"]*ppw-grid|class="[^"]*ppw-card|<table\b/i.test(faqRegion);
    add(
      "faq-clean",
      "FAQ not swallowing tables/grids",
      !gridInFaq,
      gridInFaq ? "comparison grid or table inside FAQ region" : ""
    );

    const faqAfterRelated = relatedIdx !== -1 && faqIdx > relatedIdx;
    add(
      "faq-position",
      "FAQ not inside related articles",
      !faqAfterRelated,
      faqAfterRelated ? "FAQ markup appears after related-articles footer" : ""
    );

    const okA = qA > 0 && qA === aA && detailsCount >= qA;
    const okB = qB > 0 && qB === aB;
    const wellFormed = (qA + qB > 0) && (qA === 0 || okA) && (qB === 0 || okB);
    const fmt = qB > 0 && qA === 0 ? "accordion" : qA > 0 && qB === 0 ? "details" : "mixed";
    add(
      "faq-structure",
      "FAQ items well-formed",
      wellFormed,
      `${fmt}: ${qA + qB} questions / ${aA + aB} answers${qA ? ` / ${detailsCount} details` : ""}`
    );
  }

  // ── Tag balance (root cause of historic FAQ swallowing) ───────────────────
  const opens = (t: string, tag: string) => (t.match(new RegExp(`<${tag}\\b`, "gi")) || []).length;
  const closes = (t: string, tag: string) => (t.match(new RegExp(`</${tag}>`, "gi")) || []).length;
  const deltas: [string, number][] = ["div", "section", "details", "table"].map((t) => [
    t,
    opens(clean, t) - closes(clean, t),
  ]);
  const unbalanced = deltas.filter(([, d]) => d !== 0);
  add(
    "tag-balance",
    "Balanced div/section/details/table tags",
    unbalanced.length === 0,
    unbalanced.map(([t, d]) => `${t} ${d > 0 ? "+" : ""}${d}`).join(", ")
  );

  // ── Template elements ─────────────────────────────────────────────────────
  add("key-takeaways", "Key Takeaways section", /<h2[^>]*>[^<]*key takeaways/i.test(clean));
  add("toc-nav", "Table of contents nav", /<nav\b[^>]*ppw-topnav/i.test(clean));
  add("overview", "Overview hero section", /id="overview"/i.test(clean));
  add(
    "featured-products",
    "Featured products block",
    /id="featured-products"|<a\b[^>]*href="[^"]*\/products\//i.test(clean)
  );

  // FAQ schema: verified July 5 on live pages — Smart SEO adds Article +
  // BreadcrumbList in <head> but NO FAQPage, so the embedded FAQPage JSON-LD
  // is the only FAQ schema and must be present. Checked on RAW body because
  // schema lives in <script>.
  add(
    "faq-schema",
    "FAQ schema (JSON-LD) present",
    /FAQPage/i.test(body),
    ""
  );

  const imgs = (clean.match(/<img\b/gi) || []).length;
  add("images", "Has images/infographics", imgs > 0, `${imgs} images`);
  add("word-count", "Substantial content (800+ words)", wordCount >= 800, `${wordCount} words`);

  // ── Canonical structure order (all indexes on clean) ──────────────────────
  const firstIdx = (re: RegExp) => {
    const m = clean.match(re);
    return m && m.index !== undefined ? m.index : -1;
  };
  const lastCtaIdx = (() => {
    let idx = -1;
    for (const m of clean.matchAll(/<a\b[^>]*(?:class="[^"]*ppw-cta[^"]*"[^>]*href="[^"]*\/collections\/|href="[^"]*\/collections\/[^"]*"[^>]*class="[^"]*ppw-cta)/gi)) {
      if (m.index !== undefined) idx = m.index;
    }
    return idx;
  })();
  const blocks: [string, number][] = [
    ["overview", firstIdx(/id="overview"/i)],
    ["key takeaways", firstIdx(/<h2[^>]*>[^<]*key takeaways/i)],
    ["featured products", firstIdx(/<a\b[^>]*href="[^"]*\/products\/[^"]*"/i)],
    ["FAQ", faqIdx],
    ["related articles", relatedIdx],
    ["shop CTA", lastCtaIdx],
  ];
  const present = blocks.filter(([, i]) => i !== -1);
  const misordered: string[] = [];
  for (let i = 1; i < present.length; i++) {
    if (present[i][1] < present[i - 1][1]) misordered.push(`${present[i][0]} before ${present[i - 1][0]}`);
  }
  add("structure-order", "Sections in canonical order", misordered.length === 0, misordered.join("; "));

  // ── Duplicated structural blocks ──────────────────────────────────────────
  const countOf = (re: RegExp) => (clean.match(re) || []).length;
  const dupes: string[] = [];
  if (countOf(/id="overview"/gi) > 1) dupes.push("overview x" + countOf(/id="overview"/gi));
  if (countOf(/<h2[^>]*>[^<]*key takeaways[^<]*<\/h2>/gi) > 1) dupes.push("key takeaways");
  if (countOf(/<h2[^>]*>\s*(Frequently Asked Questions|FAQs?)\s*</gi) > 1) dupes.push("FAQ heading");
  if (countOf(/Continue Your Wellness Journey/gi) > 1) dupes.push("related articles");
  if (countOf(/<nav\b[^>]*ppw-topnav/gi) > 1) dupes.push("TOC nav");
  add("no-duplicates", "No duplicated sections", dupes.length === 0, dupes.join(", "));

  // ── Single H1 ─────────────────────────────────────────────────────────────
  const h1Count = countOf(/<h1\b/gi);
  add("single-h1", "Exactly one H1", h1Count === 1, `${h1Count} found`);

  // ── Duplicate element ids ─────────────────────────────────────────────────
  const idCounts = new Map<string, number>();
  for (const m of clean.matchAll(/\bid="([^"]+)"/g)) idCounts.set(m[1], (idCounts.get(m[1]) || 0) + 1);
  const dupIds = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
  add("unique-ids", "No duplicate element IDs", dupIds.length === 0, dupIds.slice(0, 5).join(", "));

  // ── TOC links resolve ─────────────────────────────────────────────────────
  const navMatch = clean.match(/<nav\b[^>]*ppw-topnav[\s\S]*?<\/nav>/i);
  if (navMatch) {
    const targets = [...navMatch[0].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    const missing = targets.filter((t) => !clean.includes(`id="${t}"`));
    add(
      "toc-resolves",
      "All TOC links resolve",
      missing.length === 0,
      missing.length ? `dead: #${missing.join(", #")}` : ""
    );
  }

  // ── Leftover generation artifacts ─────────────────────────────────────────
  const artifacts: string[] = [];
  if (/```/.test(clean)) artifacts.push("markdown code fence");
  if (/(^|\n)#{2,}\s/.test(text)) artifacts.push("markdown heading");
  if (/\*\*[^*\n]{2,80}\*\*/.test(text)) artifacts.push("markdown bold");
  if (/HERO_IMAGE|\{kw\}|\{keyword\}|TODO:/i.test(clean)) artifacts.push("template placeholder");
  if (/<section[^>]*>\s*<\/section>/i.test(clean)) artifacts.push("empty section");
  add("no-artifacts", "No leftover generation artifacts", artifacts.length === 0, artifacts.join(", "));

  const passed = checks.filter((c) => c.pass).length;
  return {
    checks,
    score: Math.round((passed / checks.length) * 100),
    failures: checks.filter((c) => !c.pass).map((c) => c.id),
    wordCount,
    collectionLinkCount: links.inContent.length,
    voiceScore,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// v2 GRADER
// ═════════════════════════════════════════════════════════════════════════════
//
// gradePost() above grades the v1 corpus and stays untouched: the revamp
// backlog's historical scores depend on its checklist. gradePostV2 grades a
// body against what the v2 assembler is supposed to have produced, so it is
// the acceptance gate for regenerated posts before publish-in-place.
//
// Run it AFTER images are in the body (the carry step for revamps, the image
// studio for new posts): the images check is part of the gate.

const V2_AI_TELL_PATTERNS: [string, RegExp][] = [
  ["delve", /\bdelv(?:e|ing|es)\b/gi],
  ["fast-paced-world", /\bfast-paced\s+(?:world|lives|lifestyle)\b|\bin\s+today'?s\s+\w+\s+(?:world|landscape|age)\b/gi],
  ["look-no-further", /\blook\s+no\s+further\b/gi],
  ["game-changer", /\bgame.?chang(?:er|ing)\b/gi],
  ["next-level", /\btake\s+(?:your|it|this)\s+[\w\s]{0,20}to\s+the\s+next\s+level\b/gi],
  ["conclusion-heading", /<h2\b[^>]*>\s*(?:conclusion|final\s+thoughts|wrapping\s+up|in\s+summary)\b/gi],
];

export function gradePostV2(html: string): PostGrade {
  const checks: CheckResult[] = [];
  const add = (id: string, label: string, pass: boolean, detail = "") =>
    checks.push({ id, label, pass, detail });

  const body = html || "";
  const clean = stripStylesScripts(body);
  const text = clean.replace(/<[^>]+>/g, " ");
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // ── Brand rules ────────────────────────────────────────────────────────────
  const emDashes = (text.match(/—|&#8212;|&mdash;/g) || []).length;
  add("em-dashes", "No em dashes", emDashes === 0, emDashes ? `${emDashes} found` : "");

  const voice = validateBrandRules(body);
  const voicePenalty =
    emDashes * 2 + voice.bannedPhrasesFound.length * 8 + voice.namingViolations.length * 8;
  const voiceScore = Math.max(0, 100 - Math.min(100, voicePenalty));
  const voiceOffenders = [
    ...voice.bannedPhrasesFound.map((ph) => `"${ph}"`),
    ...voice.namingViolations,
  ];
  add(
    "brand-voice",
    "Brand voice compliant",
    voiceScore >= 85,
    voiceScore < 100
      ? `voice score ${voiceScore}/100${voiceOffenders.length ? ` : ${voiceOffenders.slice(0, 4).join(", ")}` : ""}`
      : ""
  );

  const tellHits: string[] = [];
  for (const [id, re] of V2_AI_TELL_PATTERNS) {
    const n = (id === "conclusion-heading" ? body.match(re) : text.match(re))?.length || 0;
    if (n > 0) tellHits.push(`${id} x${n}`);
  }
  add("ai-tells", "No recognisable AI patterns", tellHits.length === 0, tellHits.join(", "));

  // ── v2 markup, no v1 residue ───────────────────────────────────────────────
  const ppwbCount = (clean.match(/class="[^"]*\bppwb-/g) || []).length;
  const ppwLegacy = (clean.match(/class="[^"]*\bppw-(?!blog)[a-z]/g) || []).length;
  add("v2-markup", "ppwb- markup present", ppwbCount >= 5, `${ppwbCount} ppwb- classes`);
  add("no-v1-residue", "No v1 classes or inline styles", ppwLegacy === 0 && !/<style\b/i.test(body),
    [ppwLegacy ? `${ppwLegacy} ppw- classes` : "", /<style\b/i.test(body) ? "inline <style>" : ""].filter(Boolean).join(", "));

  // ── Template blocks ────────────────────────────────────────────────────────
  add("answer-box", "Answer box present", /class="[^"]*ppwb-answer/.test(clean));
  add("key-takeaways", "Key takeaways glance", /class="[^"]*ppwb-glance/.test(clean));
  add("toc-nav", "TOC accordion", /class="[^"]*ppwb-toc/.test(clean));
  add("faq-present", "FAQ section", /class="[^"]*ppwb-faq/.test(clean));
  add("faq-schema", "FAQ schema (JSON-LD) present", /FAQPage/i.test(body));
  add("shop-cta", "Shop CTA block", /class="[^"]*ppwb-shop/.test(clean));
  add("author-block", "Author block", /class="[^"]*ppwb-author/.test(clean));
  add("keep-reading", "Keep reading tiles", /class="[^"]*ppwb-related/.test(clean));
  add(
    "featured-products",
    "Product pick cards",
    /class="[^"]*ppwb-pick/.test(clean) || /<a\b[^>]*href="[^"]*\/products\//i.test(clean)
  );

  // ── Collection links: exactly 2 in prose, shop CTA excluded ────────────────
  const withoutShop = clean.replace(/<section class="ppwb-shop">[\s\S]*?<\/section>/i, "");
  const collectionHrefs = new Set<string>();
  for (const m of withoutShop.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = (m[1].match(/href="([^"]*)"/i) || [])[1] || "";
    const slug = (href.match(/\/collections\/([a-z0-9-]+)/i) || [])[1];
    if (!slug) continue;
    if (/class="[^"]*cta/i.test(m[1])) continue;
    collectionHrefs.add(slug.toLowerCase());
  }
  add(
    "collection-links",
    "Exactly 2 in-content collection links",
    collectionHrefs.size === 2,
    `${collectionHrefs.size} found${collectionHrefs.size ? `: ${[...collectionHrefs].join(", ")}` : ""}`
  );

  // ── Images (run this gate AFTER carry/image step) ──────────────────────────
  const imgs = (clean.match(/<img\b/gi) || []).length;
  add("images", "Has content images", imgs > 0, `${imgs} images`);

  // ── Structure hygiene ──────────────────────────────────────────────────────
  const h1Count = (clean.match(/<h1\b/gi) || []).length;
  add("single-h1", "Exactly one H1", h1Count === 1, `${h1Count} found`);
  add("word-count", "Substantial content (800+ words)", wordCount >= 800, `${wordCount} words`);

  const opens = (t: string, tag: string) => (t.match(new RegExp(`<${tag}\\b`, "gi")) || []).length;
  const closes = (t: string, tag: string) => (t.match(new RegExp(`</${tag}>`, "gi")) || []).length;
  const unbalanced = ["div", "section", "figure"]
    .map((t) => [t, opens(clean, t) - closes(clean, t)] as [string, number])
    .filter(([, d]) => d !== 0);
  add(
    "tag-balance",
    "Balanced div/section/figure tags",
    unbalanced.length === 0,
    unbalanced.map(([t, d]) => `${t} ${d > 0 ? "+" : ""}${d}`).join(", ")
  );

  const artifacts: string[] = [];
  if (/```/.test(clean)) artifacts.push("markdown code fence");
  if (/\*\*[^*\n]{2,80}\*\*/.test(text)) artifacts.push("markdown bold");
  if (/HERO_IMAGE|\{kw\}|\{keyword\}|TODO:|IMAGE_PLACEHOLDER/i.test(clean)) artifacts.push("template placeholder");
  add("no-artifacts", "No leftover generation artifacts", artifacts.length === 0, artifacts.join(", "));

  const passed = checks.filter((c) => c.pass).length;
  return {
    checks,
    score: Math.round((passed / checks.length) * 100),
    failures: checks.filter((c) => !c.pass).map((c) => c.id),
    wordCount,
    collectionLinkCount: collectionHrefs.size,
    voiceScore,
  };
}
