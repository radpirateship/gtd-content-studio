// Validator for generated video scripts (spec v2, section 3 + structure rules).
// failures = hard rules (the generator retries once to fix them);
// warnings = soft rules shown to the reviewer.
import { allowedNumbers } from "./specs";
import { countWords, spokenLines, wordBudget, type GenerateInput, type ScriptOutput, type Spec } from "./types";

const BANNED_HEALTH = [
  /\btreat(s|ed|ing|ment)?\b/i, /\bcures?\b/i, /\bheal(s|ing)?\b/i, /\bdetox/i, /\bboosts? (your )?immun/i,
  /\breduces? inflammation/i, /\binflammation\b/i, /\brecovery benefits?/i, /\blongevity\b/i, /\bmortality\b/i,
  /\bburns? fat\b/i, /\bfat[- ]burning\b/i, /\bbetter sleep\b/i, /\bsleep better\b/i, /\bpain relief\b/i,
  /\btherapy benefits?\b/i, /\bHSA\b/, /\bFSA\b/, /\bboosts? recovery\b/i, /\bfaster recovery\b/i,
];
const BANNED_TESTS = [/\bwe tested\b/i, /\btested it\b/i, /\bresults\b/i, /\bon camera\b/i];
const BANNED_TESTIMONIAL = [/\bcustomers? (say|said|love|tell)/i, /\breviews? (say|said)/i, /\btestimonial/i, /\bfive[- ]star\b/i];
const BANNED_RANK = [/\bbest[- ]?sell(er|ing)\b/i, /#\s?1\b/, /\bnumber one\b/i, /\bmost popular\b/i, /\btop[- ]selling\b/i];
const BANNED_HYPE = [
  /\binsane\b/i, /\bcrazy\b/i, /\bgame[- ]?changer/i, /\blife[- ]?changing\b/i, /\bmust[- ]have\b/i, /\bultimate\b/i,
  /\brevolutionary\b/i, /\bmind[- ]?blowing\b/i, /\byou won'?t believe\b/i, /\bscam\b/i, /\blies\b/i,
  /\bthey don'?t want you to know\b/i,
];
const BANNED_PRICE = [/\$\s?\d[\d,]*\s?\/\s?mo/i, /\bper month\b/i, /\$\s?[\d,]+\s+a month\b/i, /\bcheap(er|est)?\b/i, /\bdeal of the year\b/i, /\bsteal\b/i, /\bdeal\b/i];
// Brand wall: the founders' other businesses never appear in GTD content.
const BRAND_WALL = [/green\s*thumb\s*depot/i, /greenthumbdepot/i, /naked\s*nutrition/i];

function hits(text: string, patterns: RegExp[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) out.push(m[0]);
  }
  return out;
}

// Small counting words used for point labels ("one", "number two") and the
// headline count; always allowed.
const SMALL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ""))).filter((n) => !Number.isNaN(n));
}

function numberAllowed(n: number, allowed: Set<number>): boolean {
  if (SMALL.has(n) || allowed.has(n)) return true;
  // Rounded forms of a listed value ("about 1,000" for 1,010 is NOT allowed;
  // but "$4.39k"/"4,390" style and trailing .00 are).
  for (const a of allowed) if (Math.abs(a - n) < 0.005) return true;
  return false;
}

const HEADLINE_NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

function headlineNumber(h: string): number | null {
  const d = h.match(/\b(\d{1,2})\b/);
  if (d) return Number(d[1]);
  const w = h.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight)\b/);
  return w ? HEADLINE_NUMBER_WORDS[w[1]] : null;
}

export function validateScript(o: ScriptOutput, input: GenerateInput, specs: Spec[]): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];
  const allowed = allowedNumbers(specs);
  const specIds = new Set(specs.map((s) => s.id));
  const isLong = input.type === "LONG_FORM";

  // ── Text-level bans ─────────────────────────────────────────────────────
  const spoken = spokenLines(o).join(" ");
  const onScreen = [
    o.headline,
    ...(o.beats || []).map((b) => b.onScreenText),
    ...(o.chapters || []).flatMap((c) => [c.summaryGraphic, c.shortCut?.onScreenText || "", ...c.beats.map((b) => b.onScreenText)]),
    o.endCard || "",
  ].join(" \n ");
  const caption = [o.caption?.firstLine, ...(o.caption?.numbered || []), o.caption?.saveShareCta, o.title].join(" \n ");
  const everything = `${spoken}\n${onScreen}\n${caption}\n${(o.chapters || []).map((c) => c.shortCut?.spoken || "").join(" ")}`;

  const hasStudy = Boolean(input.citedStudy?.url && input.citedStudy?.finding);
  const health = hits(everything, BANNED_HEALTH);
  if (health.length) {
    if (hasStudy) warnings.push(`Health wording present (${health.join(", ")}). Allowed only as the cited study's finding, quoted. Check it.`);
    else failures.push(`Banned health/medical wording: ${health.join(", ")}.`);
  }
  for (const [label, list] of [
    ["test/result claims", BANNED_TESTS],
    ["testimonial language", BANNED_TESTIMONIAL],
    ["hype words", BANNED_HYPE],
    ["price/financing wording", BANNED_PRICE],
    ["another founder business (brand wall)", BRAND_WALL],
  ] as const) {
    const h = hits(everything, list as RegExp[]);
    if (h.length) failures.push(`Banned ${label}: ${h.join(", ")}.`);
  }
  if (!input.isBestSellerVerified) {
    const r = hits(everything, BANNED_RANK);
    if (r.length) failures.push(`Rank claim without verified best-seller status: ${r.join(", ")}.`);
  }
  if (/—/.test(everything)) failures.push("Em dash found. Use commas or periods.");
  if (o.hookType === "health_stat" && !hasStudy) failures.push("health_stat hook used without a cited study.");

  // ── Number provenance ───────────────────────────────────────────────────
  const strayNumbers = [...new Set([...numbersIn(spoken), ...numbersIn(onScreen), ...numbersIn(caption)])].filter((n) => !numberAllowed(n, allowed));
  if (strayNumbers.length) failures.push(`Numbers not found in the listed specs: ${strayNumbers.join(", ")}.`);
  for (const ns of o.numbersSpoken || []) {
    if (!specIds.has(ns.specRef)) {
      failures.push(`Spoken number "${ns.spoken}" points to unknown spec id "${ns.specRef}".`);
      continue;
    }
    const v = Number(String(ns.value).replace(/[$,]/g, ""));
    if (!Number.isNaN(v) && !numberAllowed(v, allowedNumbers(specs.filter((s) => s.id === ns.specRef)))) {
      failures.push(`Spoken number "${ns.spoken}" (${ns.value}) does not match spec ${ns.specRef}.`);
    }
    const spec = specs.find((s) => s.id === ns.specRef);
    if (spec?.derived) {
      const beat = (o.beats || []).find((b) => b.spoken.toLowerCase().includes(ns.spoken.toLowerCase()));
      if (beat && !/\babout\b|\baround\b|\broughly\b/i.test(beat.spoken)) warnings.push(`Derived number "${ns.spoken}" should be said with "about".`);
      if (beat && /\d/.test(beat.onScreenText) && !/approx/i.test(beat.onScreenText)) warnings.push(`On-screen derived number in beat ${beat.index} should be marked "approx."`);
    }
  }
  if (!isLong && (o.numbersSpoken || []).length > 5) failures.push(`${o.numbersSpoken.length} numbers spoken; the limit is 5 (prices count).`);
  for (const b of o.beats || []) {
    for (const ref of b.specRefs || []) if (!specIds.has(ref)) failures.push(`Beat ${b.index} references unknown spec "${ref}".`);
  }

  // ── Structure ───────────────────────────────────────────────────────────
  const words = countWords(spoken);
  const budget = wordBudget(input.lengthSec);
  const hookWords = countWords(o.hookLine);
  if (hookWords > 12) failures.push(`Hook is ${hookWords} words; max 12.`);
  if (countWords(o.headline) > 8) failures.push(`Headline is ${countWords(o.headline)} words; max 8.`);
  if (o.headline && o.headline !== o.headline.toUpperCase()) warnings.push("Headline should be ALL CAPS.");

  if (isLong) {
    const ch = o.chapters || [];
    if (ch.length < 4 || ch.length > 8) failures.push(`${ch.length} chapters; need 4 to 8.`);
    if (!ch.some((c) => c.downside)) failures.push('No "one to avoid" / "skip this if" chapter.');
    if (words < budget.min * 0.85 || words > budget.max * 1.15) warnings.push(`Spoken words ${words}; budget ${budget.min} to ${budget.max} for ${Math.round(input.lengthSec / 60)} min.`);
    ch.forEach((c, i) => {
      const w = countWords(c.shortCut?.spoken || "");
      if (w < 20 * 3.0 || w > 45 * 3.5) warnings.push(`Chapter ${i + 1} short cut is ${w} words; a 20 to 45s Short needs ${60} to ${158}.`);
      if (countWords(c.summaryGraphic) > 8) warnings.push(`Chapter ${i + 1} summary graphic is over 8 words.`);
      c.beats.forEach((b, j) => {
        if (!b.onScreenText) warnings.push(`Chapter ${i + 1} beat ${j + 1} has no on-screen text.`);
        else if (countWords(b.onScreenText) > 8) warnings.push(`Chapter ${i + 1} beat ${j + 1} on-screen text is over 8 words.`);
      });
    });
    if (countWords(o.endCard || "") > 12) warnings.push("End card is over 12 words.");
    return { failures, warnings };
  }

  if (words < budget.min || words > budget.max) {
    const msg = `Spoken words ${words}; budget ${budget.min} to ${budget.max} for ${input.lengthSec}s.`;
    if (words < budget.min * 0.85 || words > budget.max * 1.15) failures.push(msg);
    else warnings.push(msg);
  }
  const beats = o.beats || [];
  if (!beats.length) failures.push("No beats.");
  const first = beats[0];
  const last = beats[beats.length - 1];
  if (first && first.visualType !== "JAMES") failures.push("The hook beat must be JAMES.");
  if (last && last.visualType !== "JAMES") failures.push("The verdict/CTA beat must be JAMES.");
  beats.forEach((b) => {
    if (!b.onScreenText) failures.push(`Beat ${b.index} has no on-screen text.`);
    else if (countWords(b.onScreenText) > 8) failures.push(`Beat ${b.index} on-screen text is over 8 words.`);
    if (b.onScreenText && b.spoken && b.onScreenText.toLowerCase().replace(/[^a-z0-9 ]/g, "") === b.spoken.toLowerCase().replace(/[^a-z0-9 ]/g, "")) {
      warnings.push(`Beat ${b.index} on-screen text repeats the spoken line.`);
    }
    if (b.visualType === "SUPPLIER" && !input.assets.supplierVideo) failures.push(`Beat ${b.index} uses SUPPLIER footage but none is available.`);
    const dur = (b.endSec ?? 0) - (b.startSec ?? 0);
    const cap = b.visualType === "JAMES" && (b === first || b === last) ? 6 : 5;
    if (dur > cap) warnings.push(`Beat ${b.index} is ${dur}s on one shot (max ${cap}s); the editor should cut within it.`);
    if (b.visualType === "AI_CLIP" && !b.aiClip?.sourcePhoto) warnings.push(`Beat ${b.index} AI clip has no source photo.`);
  });
  const jamesSec = beats.filter((b) => b.visualType === "JAMES").reduce((s, b) => s + Math.max(0, b.endSec - b.startSec), 0);
  if (input.lengthSec && jamesSec / input.lengthSec < 0.15) warnings.push(`James is on screen ${Math.round((jamesSec / input.lengthSec) * 100)}% of the runtime; aim for 30% or more.`);
  if (last && Math.abs(last.endSec - input.lengthSec) > 5) warnings.push(`Beats end at ${last.endSec}s against a ${input.lengthSec}s target.`);

  const points = beats.filter((b) => b.beat === "point" || b.beat === "part");
  // Points can be split across several beats; count distinct labels like "1 ·", "2 ·".
  const labelled = new Set(beats.map((b) => (b.onScreenText.match(/^\s*(\d)\s*[·.:)-]/) || [])[1]).filter(Boolean));
  const pointCount = labelled.size || points.length;
  const n = headlineNumber(o.headline);
  if (input.type === "PRODUCT_REVIEW" && (pointCount < 2 || pointCount > 3)) failures.push(`${pointCount} points; a product review has 2 to 3.`);
  if (n && n <= 8 && pointCount && n !== pointCount && o.hookType !== "collection") {
    failures.push(`Headline says ${n} but the script makes ${pointCount} numbered points.`);
  }
  if ((o.caption?.numbered || []).length < 3 || (o.caption?.numbered || []).length > 5) warnings.push("Caption should have 3 to 5 numbered spec lines.");
  if ((o.hashtags || []).length < 3 || (o.hashtags || []).length > 5) warnings.push("Use 3 to 5 hashtags.");
  if (input.type === "HOOK_ANGLE" && input.productIds.length > 3) failures.push("Max 3 products.");
  return { failures, warnings };
}
