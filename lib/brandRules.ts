// ============================================================================
// PPW BRAND RULES — Single source of truth for writing voice across ALL
// generation routes (articles, bulk, workshop regenerate, ultimate guides,
// section editor, Content Brain chat).
//
// HISTORY: These rules originally lived inline in app/api/generate/route.ts
// (commit eb7a008) and were silently dropped in a route rebuild (commit
// 8f14ee2, Feb 18 2026). Restored here as a shared module so a future route
// rewrite can never disconnect them again. Any "view the rules" UI should
// import from this file — never duplicate the text.
//
// DO NOT edit generation-route prompts to add voice rules inline.
// Add them here instead.
// ============================================================================

/**
 * Core writing voice rules. Append to the system prompt of every
 * content-generating route via getWritingRulesBlock().
 */
export const WRITING_RULES = `WRITING STYLE - CRITICAL:
Write like a knowledgeable specialist at an equipment store explaining products to a customer who is about to spend real money: clear, specific, direct, and willing to recommend.

SAY THE THING
- Name things before you refer to them, then keep the same name. Do not rotate synonyms ("the unit", "the machine", "the system", "your investment") for variety.
- Finish every comparison. "Better", "faster", "quieter", "cheaper" need a "than what". If you cannot finish it, cut it.
- State the point. Never announce it: no "Here's the thing", "Let me explain", "The honest answer is", "What most people don't realize".
- Follow one concrete example all the way through: the situation, what the buyer does, what happens. One worked example beats a list of capabilities.
- Every paragraph must be specific to THIS article. If a paragraph could be pasted unchanged into an article about a different product category, cut it or make it specific.

SELL WITH FACTS
- Make recommendations. Say which product or type fits which buyer and why, using the spec that decides it. A clear verdict helps the reader; hedging every recommendation into "it depends" does not.
- Every selling sentence carries a fact. Replace praise ("built to last", "a smart choice", "earns its place") with the detail that makes it true.
- Never invent urgency, scarcity, guarantees, testimonials, customer stories, return or financing terms, or results.
- Never invent experience: no "customers often tell us", "we see this all the time", "this surprises most people", "nobody thinks about". State the fact and why it matters.

CONNECT THE SENTENCES
- No staged reversals: "This isn't about X. It's about Y", "It's not just X", "X is not a compromise, it is Y", "The best X are not..., they are...". Just state Y.
- No uncounted majority claims. Do not open with "Most people", "Most buyers", "Most owners" unless the supplied material contains the number.
- No runs of dramatic fragments ("Faster pulls. Better crema. Less mess."). Join ideas that belong together with and, but, because, so.
- Do not force lists, examples or adjectives into groups of three. Use the number the information has.
- Vary sentence length. Contractions are fine.
- End a section, and the article, on its most specific recommendation or fact. No symmetrical flourish, no restatement.

PLAIN WORDS
- Prefer plain verbs: is, has, uses, holds, fits, costs.
- Never use: delve, unlock, unleash, elevate, empower, foster, showcase, underscore, testament, tapestry, pivotal, crucial, groundbreaking, revolutionary, world-class, game-changing, cutting-edge, myriad, plethora, "serves as", "stands as", "plays a key role", "in today's landscape", genuinely, honestly, truly.
- Do not swap a banned word for an equally vague synonym. Say what the thing does.
- Never end a sentence with commentary on itself (", highlighting its importance", ", which is the point", ", a detail that matters more than it sounds"). If the clause carries new information, make it its own sentence.
- Keep precise technical terms. A literal word (the seams of a cushion) is not decoration.
- Keep accurate qualifiers (roughly, typically, tends to). Do not inflate certainty or importance.

EVIDENCE
- Never attribute to an unnamed body of work: no "research shows", "studies show", "studies have documented", "experts say", "science confirms", "supported by research". State the specific finding or mechanism plainly at its real level of certainty, or leave it out.
- For health effects keep cautious wording (may, is associated with). Never upgrade a finding into a promise.

FORMAT
- Do NOT use em dashes (—) anywhere, and do not use spaced hyphens or spaced en dashes as punctuation. Use commas, periods, colons or parentheses. Ranges such as 160–190 are fine.
- Headings are short, in sentence case, and name the subject or the action. Never a stock heading such as "Final thoughts", "Conclusion", "The bottom line", "Wrapping up" or "Putting it all together".
- Use a list only when the items are parallel or sequential. Explanations stay in paragraphs.
- Never repeat a point already made. No recap paragraphs.
- NEVER use these AI patterns: "In today's world...", "Let's dive into...", "It's important to note...", "When it comes to...", "Whether you're a...or a...".

CLAIMS - NEVER STATE (factual accuracy, not style):
- Never promise "white-glove delivery", "white-glove assembly", or that assembly is included. PPW does not offer this.
- Never discuss shipping cost at all. Not "free shipping", not "shipping is not free", not "factor shipping into your budget". Shipping is handled at checkout and is not a topic for an article.
- Never invent warranty length, delivery timeframes, return policies, financing terms, or certifications that are not in the product data.
- Product feature bullets must describe the PRODUCT (materials, resistance type, capacity, power, certifications), not PPW's service.
- Never claim years of experience, decades in the industry, certifications, or licences for PPW or its staff. None are evidenced.
- Never write "medically reviewed", "reviewed by our...", "clinically proven", "doctor recommended", or "our experts". No such review process or credentialed staff exists.
- PPW's real authority is verifiable: authorized dealer for the brands covered, equipment sold, shipped and installed by us, specifications taken from manufacturer documentation. Say that instead.

NAMING RULES (NEVER violate):
- Always "Sensory Deprivation Tanks" (never "Float Tanks")
- "Massage Chairs" is fine, it is its own sub-collection alongside Massage Equipment
- Always plural: "Cold Plunges", "Sensory Deprivation Tanks"

SEO REQUIREMENTS:
- Use the primary keyword where a person would naturally say it: the title, the opening section, and one or two headings. Elsewhere use the plain name of the thing. Never repeat a phrase to hit a count.
- Headings say what the section answers.
- Prioritize the buyer's question and depth over length. Explain it better than competing articles would.

TONE: Specific, evidence-based, conversational, and confident when recommending.

Before finalizing any section, read each sentence once as the buyer would. If its meaning is not clear on one read, or it would fit any article in any category, rewrite it.`;

/**
 * Phrases that should never appear in published PPW content.
 * Used by validateBrandRules() for post-generation checking.
 * Lowercase; matched case-insensitively against text content (HTML stripped).
 */
export const BANNED_PHRASES: string[] = [
  // Filler openers / AI tells
  "in today's world",
  "in today's fast-paced",
  "in the modern era",
  "let's dive into",
  "let's dive in",
  "let's explore",
  "it's important to note",
  "it's worth mentioning",
  "it's worth noting",
  "when it comes to",
  "in conclusion",
  "at the end of the day",
  "look no further",
  // Hype language
  "game-changer",
  "game changer",
  "revolutionize",
  "cutting-edge",
  "state-of-the-art",
  "unlock the secret",
  "the secret to",
  "take it to the next level",
  "elevate your",
  // Vague wellness language
  "wellness journey",
  "holistic lifestyle",
  "total well-being",
];

/**
 * Service and shipping claims PPW cannot support. Added Aug 3 2026 after an
 * audit found "White-Glove Delivery Included" hardcoded as the first bullet of
 * every product card sitewide, plus "Free Shipping Included" used as filler.
 * PPW does not offer white-glove delivery or assembly, and free shipping is
 * conditional on product class (not offered on freight items such as saunas).
 *
 * These are checked separately from BANNED_PHRASES because they are accuracy
 * problems, not voice problems: a hit here is a factual claim to correct, not a
 * stylistic tic. Bulk cleanup of published posts lives in lib/product-bullets.ts
 * and /api/maintenance/bullet-audit.
 */
export const UNSUPPORTED_CLAIMS: Array<{ pattern: RegExp; note: string }> = [
  // Catalogue-scope claims. A brands roundup with four featured products
  // from two vendors wrote "PPW currently carries Prism Fitness and PRx
  // Performance" and "the brands available through Peak Primal Wellness".
  // The featured products are a selection from hundreds of vendors; the
  // article may never describe them as the whole range.
  { pattern: /\b(?:PPW|Peak Primal Wellness|we)\s+(?:currently\s+)?(?:carr(?:y|ies)|stocks?|offers?|sells?)\s+(?:only\s+)?(?:two|three|four|2|3|4)?\s*(?:brands?|vendors?|manufacturers?)?\s*(?::|,)?\s*[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*\s+and\s+[A-Z][\w&.'-]*/g, note: "names featured vendors as the brands PPW carries; the catalogue is far larger" },
  { pattern: /\b(?:the|all|every|only)\s+(?:[\w-]+\s+){0,4}(?:brands?|vendors?|models?|options?|manufacturers?)\s+(?:available|offered|sold|stocked|carried)\s+(?:through|by|at|from)\s+(?:PPW|Peak Primal Wellness|us)\b/gi, note: "implies the featured products are the whole range" },
  { pattern: /\b(?:PPW|Peak Primal Wellness)\s+(?:currently\s+)?(?:carries|stocks|offers)\s+(?:two|three|four|2|3|4)\s+(?:brands?|vendors?|manufacturers?)\b/gi, note: "counts featured vendors as the whole range" },
  { pattern: /\b(?:only|the two|both)\s+(?:brands?|vendors?)\s+(?:PPW|Peak Primal Wellness|we)\s+(?:carr(?:y|ies)|stocks?|sells?)\b/gi, note: "implies the featured products are the whole range" },
  { pattern: /white[\s-]?glove/gi, note: "PPW does not offer white-glove delivery or assembly" },
  { pattern: /free\s+shipping/gi, note: "free shipping is conditional on product class, never a blanket claim" },
  { pattern: /shipping\s+is\s+free/gi, note: "free shipping is conditional on product class" },
  // Any mention of shipping cost, either polarity. "Shipping on freight items
  // like saunas is not free" shipped in an FAQ after the model paraphrased the
  // old rule text back at the reader.
  { pattern: /\bshipping\b[^.]{0,40}\b(?:free|cost|costs|fee|fees|charge|charges|price|budget)\b/gi, note: "shipping cost is never discussed in an article, either way" },
  { pattern: /\b(?:cost|costs|fee|fees|charge|charges|price)\b[^.]{0,20}\bshipping\b/gi, note: "shipping cost is never discussed in an article, either way" },
  { pattern: /assembly\s+included/gi, note: "assembly is not included" },
  { pattern: /includes?\s+(?:free\s+)?assembly/gi, note: "assembly is not included" },
  { pattern: /lifetime\s+warranty/gi, note: "warranty terms are set per manufacturer, verify before claiming" },

  // ── AUTHORSHIP AND CREDENTIALS (added Aug 2026) ────────────────────────────
  // Content is generated from manufacturer and product data. PPW's real
  // authority is being an authorized dealer that sells, ships and installs this
  // equipment. That is verifiable; invented tenure, certifications and review
  // processes are not. Patterns are written to leave the approved service
  // bullets ("Ongoing Expert Phone Support", "Expert US-Based Support") and
  // genuine product certifications (ETL, UL, CSA) alone.
  { pattern: /\b\d+\+?\s*years?\s+(?:of\s+)?(?:experience|expertise|in\s+the\s+(?:industry|business|field))\b/gi, note: "years-of-experience figures are not evidenced, do not claim them" },
  { pattern: /\b(?:decades?|generations?)\s+of\s+(?:experience|expertise)\b/gi, note: "vague long-tenure claims are not evidenced" },
  { pattern: /\bmedically\s+reviewed\b/gi, note: "PPW does not run a medical review process" },
  { pattern: /\breviewed\s+by\s+(?:our|a|an)\b/gi, note: "no named reviewer process exists, do not imply one" },
  { pattern: /\bclinically\s+(?:proven|validated|tested)\b/gi, note: "clinical efficacy claims require cited evidence, never assert them" },
  { pattern: /\b(?:doctor|physician|dentist)[\s-]?(?:recommended|approved|endorsed)\b/gi, note: "no practitioner endorsement exists" },
  { pattern: /\bboard[\s-]certified\b/gi, note: "no board certification exists" },
  { pattern: /\bour\s+(?:certified|licensed|accredited|board[\s-]certified)\b/gi, note: "PPW staff hold no certifications we can evidence" },
  { pattern: /\bour\s+(?:team\s+of\s+)?experts?\b/gi, note: "do not assert in-house expert staff, say what is true: authorized dealer, we sell and install it" },
  { pattern: /\bcertified\s+(?:sauna|wellness|fitness|recovery|health)\s+(?:expert|specialist|professional|coach)\b/gi, note: "invented practitioner credential" },
  { pattern: /\b(?:industry[\s-]leading\s+expertise|unrivalled\s+expertise|unmatched\s+expertise)\b/gi, note: "unevidenced expertise superlative" },

  // ── HEALTH EFFICACY (added Aug 21 2026) ────────────────────────────────────
  // PPW sells equipment. It is not a supplement company and not a clinic, and a
  // bald health claim on a page with a buy button is the kind an FTC action is
  // built on. Two decks shipped before this existed: "builds mental toughness,
  // boosts immunity, and transforms your body from the inside out" and "your
  // body's fat-burning furnace".
  //
  // Deliberately narrow. These target MARKETING VERBS attached to a health
  // outcome, not physiological discussion. "Research on cold water immersion
  // documents norepinephrine increases" is fine and must stay fine; "boosts
  // immunity" is not. Note that "anti-aging" is absent on purpose — PPW has a
  // published article using it in the title, so it is house vocabulary.
  { pattern: /\b(?:boosts?|boosting|strengthens?|supercharges?|supercharging)\s+(?:your\s+)?immun(?:ity|e\s+system|e\s+function)\b/gi, note: "immunity claims are not evidenced and are FTC-sensitive on a sales page" },
  { pattern: /\bimmune[\s-]boosting\b/gi, note: "immunity claim, not evidenced" },
  { pattern: /\b(?:cures?|curing)\s+(?:your\s+)?(?:disease|illness|depression|anxiety|arthritis|insomnia)\b/gi, note: "disease-cure claim, never make one" },
  { pattern: /\bprevents?\s+(?:disease|illness|cancer|infection)\b/gi, note: "disease-prevention claim, never make one" },
  { pattern: /\bdetox(?:es|ify|ifies|ifying|ification)?\b/gi, note: "detox has no defined physiological meaning, do not use it" },
  { pattern: /\b(?:flush(?:es|ing)?|remov(?:e|es|ing)|eliminat(?:e|es|ing))\s+toxins\b/gi, note: "toxin-removal claim, not evidenced" },
  { pattern: /\b(?:burns?|burning|melts?|melting|torches?|torching|blasts?)\s+(?:body\s+)?fat\b/gi, note: "fat-loss claim in marketing voice, describe the mechanism instead" },
  // "fat-burning" as a compound adjective, which the verb pattern above misses
  // because the noun precedes the verb: "your body's fat-burning brown adipose
  // tissue" slipped through a deck. Thermogenesis is a real mechanism and the
  // article should describe it; "fat-burning" is how a supplement label says it.
  { pattern: /\bfat[\s-]burning\b/gi, note: "compound-adjective fat-loss claim, describe thermogenesis plainly" },
  { pattern: /\bcalorie[\s-]burning\s+furnace\b/gi, note: "hype, describe thermogenesis plainly" },
  { pattern: /\btorch(?:es|ing)?\s+calories\b/gi, note: "fat-loss claim in marketing voice" },
  { pattern: /\btransforms?\s+your\s+(?:body|life|health|metabolism|physiology)\b/gi, note: "unfalsifiable transformation claim" },
  { pattern: /\bscientifically\s+proven\b/gi, note: "say what the research shows, never assert proof" },
  { pattern: /\bguaranteed\s+(?:results|weight\s+loss|recovery)\b/gi, note: "outcome guarantee, never make one" },
];

/** Forbidden names mapped to their canonical replacements. */
export const NAMING_VIOLATIONS: Array<{ pattern: RegExp; correct: string }> = [
  { pattern: /float\s+tanks?/gi, correct: "Sensory Deprivation Tanks" },
  // "massage chairs" rule removed July 6 2026 — massage sub-collections
  // (massage-chairs, massage-guns, etc.) now exist; the term is correct usage.
];

export interface BrandCheckResult {
  passed: boolean;
  emDashCount: number;
  bannedPhrasesFound: string[];
  namingViolations: string[];
  unsupportedClaims: string[];
  uncarriedBrands: string[];
  seoJargon: string[];
  /** AI writing tells. Informational: never affects `passed` or `warnings`. */
  aiTells: string[];
  faqCount: number | null;
  warnings: string[];
}

/** Strip HTML tags for text-level checks. */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

/**
 * Post-generation validation. Run on every generated article body before
 * saving. Returns structured results; caller decides whether to block,
 * auto-fix, or surface warnings in the UI.
 *
 * @param html        Generated article body HTML
 * @param expectFaq   When true, validates the FAQ has exactly 8 questions
 */
/**
 * Brands PPW does NOT carry, across every category it writes about. Added Aug 20
 * 2026 after a generated FAQ told readers to buy "a brand like Plunge, Ice Barrel,
 * or Edge Theory Labs" on PPW's own article. The model reaches for the names it
 * has seen most often online, which are the DTC brands with the biggest ad spend,
 * so a prompt rule alone does not hold.
 *
 * This list is a SEED, not the guard. A hand-typed list can only ever cover the
 * categories someone was testing on the day it was written (the first version was
 * fifteen cold plunge and sauna brands and caught nothing on a treadmill article).
 * The structural check in findUnknownBrands() is what generalises: it looks for
 * the "brands like X, Y or Z" construction and flags any proper noun in it that is
 * not a vendor in the product data for the article. Keep this list short and
 * distinctive; it exists for bare mentions outside that construction.
 *
 * Bare "Plunge" is a common noun on this site, so it is matched only in an
 * explicit brand-list context.
 */
export const UNCARRIED_BRANDS: Array<{ pattern: RegExp; note: string }> = [
  // Cold plunge
  { pattern: /\bIce\s?Barrel\b/gi,            note: "competitor, PPW does not carry it" },
  { pattern: /\bEdge\s+Theory(\s+Labs)?\b/gi,  note: "competitor, PPW does not carry it" },
  { pattern: /\bRenu\s+Therapy\b/gi,          note: "competitor, PPW does not carry it" },
  { pattern: /\bBlue\s?Cube\b/gi,             note: "competitor, PPW does not carry it" },
  { pattern: /\bMorozko(\s+Forge)?\b/gi,       note: "competitor, PPW does not carry it" },
  { pattern: /\bPolar\s+Monkeys\b/gi,         note: "competitor, PPW does not carry it" },
  { pattern: /\bPenguin\s+Chillers?\b/gi,      note: "competitor, PPW does not carry it" },
  { pattern: /\bCold\s+Stoic\b/gi,            note: "competitor, PPW does not carry it" },
  { pattern: /\bPlungeAll\b/gi,               note: "competitor, PPW does not carry it" },
  // Sauna and light
  { pattern: /\bSun\s?Home\s+Saunas?\b/gi,    note: "competitor, PPW does not carry it" },
  { pattern: /\bClearlight\b/gi,              note: "competitor, PPW does not carry it" },
  { pattern: /\bSunlighten\b/gi,              note: "competitor, PPW does not carry it" },
  { pattern: /\bHigherDOSE\b/gi,              note: "competitor, PPW does not carry it" },
  { pattern: /\bTherasage\b/gi,               note: "competitor, PPW does not carry it" },
  { pattern: /\bJoovv\b/gi,                   note: "competitor, PPW does not carry it" },
  { pattern: /\bMito\s?Red\b/gi,             note: "competitor, PPW does not carry it" },
  // Recovery and massage
  { pattern: /\bTheragun\b/gi,                note: "competitor, PPW does not carry it" },
  { pattern: /\bTherabody\b/gi,               note: "competitor, PPW does not carry it" },
  { pattern: /\bHyperice\b/gi,                note: "competitor, PPW does not carry it" },
  { pattern: /\bHypervolt\b/gi,               note: "competitor, PPW does not carry it" },
  { pattern: /\bNormatec\b/gi,                note: "competitor, PPW does not carry it" },
  // Fitness
  { pattern: /\bPeloton\b/gi,                 note: "competitor, PPW does not carry it" },
  { pattern: /\bNordicTrack\b/gi,             note: "competitor, PPW does not carry it" },
  { pattern: /\bBowflex\b/gi,                 note: "competitor, PPW does not carry it" },
  { pattern: /\bRogue\s+Fitness\b/gi,        note: "competitor, PPW does not carry it" },
  { pattern: /\bConcept\s?2\b/gi,            note: "competitor, PPW does not carry it" },
  { pattern: /\bTonal\b/gi,                   note: "competitor, PPW does not carry it" },
  { pattern: /\bHydrow\b/gi,                  note: "competitor, PPW does not carry it" },
  // Bare "Plunge" as a brand, only inside an explicit list of brands.
  { pattern: /brands?\s+(?:like|such\s+as)[^.]{0,80}\bPlunge\b/gi, note: "\u201cPlunge\u201d here reads as the competitor brand, not the product category" },
];

/**
 * The construction a competitor plug almost always arrives in: "brands like X",
 * "such as those from X or Y", "options from X, Y and Z". Capturing the clause
 * and reading the proper nouns out of it is topic-agnostic, which a name list
 * can never be.
 */
const BRAND_LIST_CONSTRUCTION =
  /\b(?:brands?|makers?|manufacturers?|companies|names?|models?|units?|options?|those|others?|some|many|ones?|products?|chambers?|saunas?|machines?)\s+(?:like|such\s+as|including|from|by)\s+(?:those\s+(?:from|by)\s+)?([^.;:!?\n]{0,140})/gi;

/**
 * Capitalised words that are not brands. Sentence-initial words are not a
 * concern because the construction never starts a sentence, but units, bodies,
 * product categories and PPW's own names all show up capitalised mid-sentence.
 */
const NOT_A_BRAND = new Set([
  "ppw", "peak", "primal", "wellness", "us", "usa", "uk", "eu", "hsa", "fsa", "led", "emf",
  "uv", "ata", "ir", "fir", "kw", "btu", "etl", "ul", "csa", "fda", "nih", "cdc", "the", "a", "an",
  "and", "or", "of", "for", "with", "in", "on", "at", "to", "from", "by", "i", "your", "our",
  "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday",
  "saturday", "sunday", "american", "european", "canadian", "finnish", "japanese", "chinese",
  "german", "italian", "cedar", "hemlock", "thermowood", "spruce", "aspen", "nordic",
]);

/** Lowercased, trimmed, punctuation stripped. */
function normBrand(s: string): string {
  return s.toLowerCase()
    .replace(/\b(?:inc|llc|ltd|co|corp|corporation|company|gmbh|oy|usa)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Proper-noun runs inside a brand-list construction that do not match any known
 * vendor. `known` should be the vendors from the article's product data plus
 * any brand named in the brief or title; a run matches if it equals a known
 * vendor, is a prefix of one, or is one word of a multi-word vendor ("Dynamic"
 * for "Dynamic Cold Plunge Therapy").
 *
 * Returns the unknown names, deduplicated. Empty means clean.
 */
export function findUnknownBrands(text: string, known: Iterable<string>): string[] {
  const knownNorm = Array.from(known).map(normBrand).filter(Boolean);
  const knownWords = new Set(knownNorm.flatMap((k) => k.split(" ")));
  const isKnown = (cand: string) => {
    const c = normBrand(cand);
    if (!c) return true;
    if (knownNorm.some((k) => k === c || k.startsWith(c + " ") || c.startsWith(k + " "))) return true;
    // Every word of the candidate appears in some known vendor name.
    return c.split(" ").every((w) => knownWords.has(w));
  };

  const out = new Set<string>();
  BRAND_LIST_CONSTRUCTION.lastIndex = 0;
  for (const m of text.matchAll(BRAND_LIST_CONSTRUCTION)) {
    const clause = m[1];
    // Runs of Capitalised words, allowing internal caps (HigherDOSE), digits
    // (Concept2) and an ampersand between words.
    for (const run of clause.matchAll(/\b([A-Z][A-Za-z0-9]*(?:\s+(?:&\s+)?[A-Z][A-Za-z0-9]*){0,3})\b/g)) {
      const name = run[1].trim();
      const words = name.split(/\s+/);
      if (words.every((w) => NOT_A_BRAND.has(w.toLowerCase()))) continue;
      // Strip leading/trailing stopwords that got swept into the run.
      const core = words.filter((w) => !NOT_A_BRAND.has(w.toLowerCase())).join(" ");
      if (!core) continue;
      if (isKnown(core)) continue;
      out.add(core);
    }
  }
  return Array.from(out);
}

/**
 * Remove a competitor brand mention when, and only when, it sits in a clause the
 * sentence can lose cleanly: ", such as those from Blue Cube or Renu Therapy,".
 *
 * Deliberately narrow. A first version also swapped bare mentions for a neutral
 * phrase and produced "from a purpose-built units, purpose-built units, or
 * purpose-built units" — rewriting arbitrary prose by regex does not work. When
 * this cannot fix the text cleanly it says so, and the caller regenerates the
 * answer or drops it rather than publishing a mangled sentence.
 */
/**
 * Our own trade vocabulary, which must never reach a reader. Added Aug 20 2026
 * after a published draft contained "The short answer to the PAA question is no".
 * The model was not fed the term; it recognised the piece as SEO work and reached
 * for the shorthand on its own, which means a prompt rule alone will not hold.
 */
export const SEO_JARGON: Array<{ pattern: RegExp; note: string }> = [
  { pattern: /\bPAAs?\b/g,                         note: "internal shorthand for People Also Ask" },
  { pattern: /\bPeople Also Ask\b/gi,              note: "name the question, do not name the SERP feature" },
  { pattern: /\bSERPs?\b/g,                        note: "internal shorthand" },
  { pattern: /\bE-?E-?A-?T\b/g,                    note: "internal shorthand" },
  { pattern: /\bLSI keywords?\b/gi,                note: "internal shorthand" },
  { pattern: /\bfeatured snippets?\b/gi,           note: "internal shorthand" },
  { pattern: /\bsearch intent\b/gi,                note: "internal shorthand" },
  { pattern: /\b(?:primary|target|long-tail) keywords?\b/gi, note: "internal shorthand" },
  { pattern: /\bmeta descriptions?\b/gi,           note: "internal shorthand" },
  { pattern: /\banchor text\b/gi,                  note: "internal shorthand" },
  { pattern: /\bkeyword density\b/gi,              note: "internal shorthand" },
  // The writer's sources, named to the reader. "The product listing does not
  // specify exact power requirements" shipped in an FAQ.
  { pattern: /\b(?:the\s+)?product\s+(?:listing|data)\b/gi, note: "names the writer's source; attribute the gap to the manufacturer instead" },
  { pattern: /\bthe\s+(?:listing|catalogue|catalog)\s+(?:does|doesn't|did|says|states|lists|specifies)\b/gi, note: "names the writer's source; attribute to the manufacturer instead" },
  { pattern: /\b(?:specifications|specs|data)\s+(?:provided|supplied|given)\b/gi, note: "names the writer's source" },
  { pattern: /\blink inventory\b|\bcatalogue research\b/gi, note: "internal prompt vocabulary" },
];

/**
 * Remove trade jargon from reader-facing copy.
 *
 * The common shape is the term used as a modifier: "the PAA question", "the SERP
 * result". Dropping the token leaves a clean sentence — "The short answer to the
 * question is no" — so that case is repaired. A bare noun use ("we optimise for
 * SERPs") cannot be fixed by deletion, so it is reported instead of mangled.
 */
export function scrubSeoJargon(text: string): { text: string; removed: string[]; clean: boolean } {
  const removed: string[] = [];
  let out = text;

  const MODIFIED = /\b(PAAs?|SERPs?|E-?E-?A-?T|LSI)\s+(question|questions|result|results|listing|listings|ranking|rankings|score|signal|signals)\b/gi;
  out = out.replace(MODIFIED, (whole, _tok, noun) => {
    removed.push(whole);
    return noun;
  });

  const stillThere = SEO_JARGON.some(({ pattern }) => { pattern.lastIndex = 0; return pattern.test(out); });
  return { text: out, removed, clean: !stillThere };
}

export function scrubUncarriedBrands(
  text: string,
  knownVendors: Iterable<string> = [],
): { text: string; removed: string[]; clean: boolean } {
  const removed: string[] = [];
  const known = Array.from(knownVendors);

  const knownNorm = known.map(normBrand).filter(Boolean);
  const carried = (name: string) => {
    const n = normBrand(name);
    return knownNorm.some((k) => k === n || k.startsWith(n + " ") || n.startsWith(k + " "));
  };
  const hasUncarried = (chunk: string) =>
    UNCARRIED_BRANDS.some(({ pattern }) => {
      pattern.lastIndex = 0;
      const m = chunk.match(pattern);
      return !!m && !carried(m[0]);
    }) || findUnknownBrands(chunk, known).length > 0;

  // The clause plus its trailing comma, so no orphan punctuation is left behind.
  let out = text.replace(
    /,\s*(?:such as|like|including|from brands like|from makers like|from companies like)\b[^,.;]{0,90}?,/gi,
    (clause) => {
      if (!hasUncarried(clause)) return clause;
      removed.push(clause.trim());
      return "";   // appositive removal: the sentence closes over the gap
    },
  );

  out = out.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").replace(/,\s*,/g, ",").trim();

  return { text: out, removed, clean: !hasUncarried(out) };
}

/**
 * AI writing tells. Structural and vocabulary patterns that make copy read as
 * machine-written, from the Oct 2026 humanize review and the bench and home
 * gym batches (staged reversals, "most buyers", "research shows", self-praising
 * sentence endings, invented customer experience). Kept OUT of `passed` and
 * `warnings`: the FAQ chain drops pairs that fail `passed`, and a style tic is
 * not a reason to lose an answer. The body repair chain reads `aiTells`
 * directly and rewrites the offending block.
 */
export const AI_TELLS: Array<{ pattern: RegExp; note: string }> = [
  // Staged reversals
  { pattern: /\b(?:is|are|was|were)(?:n['’]t| not) (?:just |only |simply |really )?(?:about|a compromise|the point)\b/gi, note: "staged reversal, state the point directly" },
  { pattern: /\b(?:it|this|that)['’]?s not (?:just|only|simply|really) (?:about|a|an|the)\b/gi, note: "staged reversal, state the point directly" },
  { pattern: /\bnot because\b[^.]{1,80}\bbut because\b/gi, note: "staged reversal, state the reason directly" },
  { pattern: /\bThe (?:best|right|smartest) [^.]{1,60}\b(?:are|is) not\b[^.]{1,80}\. (?:They|It) (?:are|is)\b/g, note: "staged reversal, state the point directly" },
  // Uncounted majorities and invented experience
  { pattern: /(?:^|[.!?]\s+)Most (?:people|buyers|shoppers|owners|users|customers|lifters|athletes|home gym owners|homeowners|beginners)\b/g, note: "uncounted majority claim" },
  { pattern: /\b(?:surprises|catches out|trips up) (?:people|buyers|most|many)\b/gi, note: "invented customer experience" },
  { pattern: /\bnobody (?:thinks|talks|plans|tells you)\b/gi, note: "invented customer experience" },
  { pattern: /\b(?:in our experience|we see this|we(?:'ve| have) seen (?:this|it|many|plenty)|customers (?:often |always )?tell us|we hear from)\b/gi, note: "invented experience" },
  // Vague attribution
  { pattern: /\b(?:research|studies|science|experts?|the literature|exercise science)\s+(?:on [^.,;]{1,60}?\s+)?(?:consistently |generally |clearly |repeatedly )?(?:shows?|finds?|suggests?|says?|agrees?|confirms?|indicates?)\b/gi, note: "vague attribution, state the finding or cut it" },
  { pattern: /\bstudies (?:have )?(?:shown|documented|found|demonstrated)\b/gi, note: "vague attribution, state the finding or cut it" },
  { pattern: /\b(?:supported|backed|confirmed) (?:consistently |widely )?(?:by|in) [^.;]{0,40}?(?:research|science|studies)\b/gi, note: "vague attribution, state the finding or cut it" },
  // Self-commentary and announcements
  { pattern: /,\s*(?:highlighting|underscoring|showcasing|emphasizing|emphasising|reinforcing) (?:its|their|the|how|why)\b/gi, note: "sentence comments on itself" },
  { pattern: /\b(?:which|and that) is (?:exactly )?the point\b/gi, note: "sentence comments on itself" },
  { pattern: /\bmatters? more\b[^.;]{0,25}?\bthan (?:it sounds|you(?:'d| would)? (?:think|expect)|most (?:people|buyers) (?:realize|realise|expect))\b/gi, note: "sentence comments on itself" },
  { pattern: /\b(?:here['’]s the thing|let me explain|the honest answer is|what most people don['’]t realize)\b/gi, note: "announces the point instead of making it" },
  // Decorative vocabulary
  { pattern: /\b(?:delve|delves|delving|unleash(?:es|ed)?|empower(?:s|ed|ing)?|foster(?:s|ed|ing)?|showcas(?:e|es|ed|ing)|underscor(?:e|es|ed|ing)|testament|tapestry|pivotal|groundbreaking|game-changing|world-class|myriad|plethora)\b/gi, note: "decorative AI vocabulary" },
  { pattern: /\b(?:serves|stands) as an? \b|\bplays an? (?:key|crucial|pivotal|vital) role\b|\bin today['’]s (?:landscape|market)\b|\bearns (?:its|their) (?:place|keep)\b/gi, note: "stock phrase, say what it does" },
];

/** Text-only list of AI tells in a block, for the review panel and the repair chain. */
export function findAiTells(html: string): string[] {
  const text = toText(html);
  const hits: string[] = [];
  for (const { pattern, note } of AI_TELLS) {
    pattern.lastIndex = 0;
    const m = text.match(pattern);
    if (m) hits.push(`"${m[0].trim()}": ${note}`);
  }
  return hits;
}

/**
 * Deterministic AI-tell cleanup, safe on HTML, plain text and the JSON the FAQ
 * and takeaways arrive as. Runs on text outside tags only, so hrefs and
 * attributes are never touched. Every edit is a deletion or a punctuation
 * swap that cannot change meaning:
 *   - "genuinely", "truly" as intensifiers are deleted
 *   - "Honestly, " and "The honest answer is (that) " are deleted
 *   - spaced hyphens and spaced en dashes used as punctuation become commas,
 *     unless they sit between numbers (a range)
 * Curly double quotes are left alone on purpose: inside a JSON string a
 * straight double quote would break the parse.
 */
export function scrubAiTells(input: string): string {
  if (!input) return input;
  const capNext = (_m: string, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`;
  const BLOCK_TAG = /^<\/?(?:p|li|h[1-6]|td|th|div|summary|section|ul|ol|aside|blockquote|br)\b/i;
  // Whether the next text segment begins a sentence: true at the start of the
  // input, after a block-level tag, or after text ending in . ! ? . An inline
  // tag (<a>, <strong>) leaves it unchanged, so "is <a>genuinely good</a>" is
  // never capitalised mid-sentence.
  let atSentenceStart = true;
  return input
    .split(/(<[^>]*>)/)
    .map((seg) => {
      if (seg.startsWith("<")) {
        if (BLOCK_TAG.test(seg)) atSentenceStart = true;
        return seg;
      }
      if (!seg) return seg;
      const lead = atSentenceStart ? "^|" : "";
      const startRe = (body: string) => new RegExp(`(${lead}[.!?]\\s+|"\\s*)${body}\\s+([a-z])`, "gi");
      let out = seg
        .replace(startRe("(?:the honest answer is(?: that)?|honestly,)"), capNext)
        .replace(/\b(?:the honest answer is(?: that)?)\s+/gi, "")
        .replace(/,\s*honestly,/gi, ",")
        .replace(startRe("(?:genuinely|truly)"), capNext)
        .replace(/\b(?:genuinely|truly)\s+/gi, "")
        .replace(/(\D) [-–] (?=\D)/g, "$1, ");
      const trimmed = out.trimEnd();
      if (trimmed) atSentenceStart = /[.!?]["')]?$/.test(trimmed);
      return out;
    })
    .join("");
}

export function validateBrandRules(
  html: string,
  expectFaq = false,
  opts: { knownVendors?: Iterable<string> } = {},
): BrandCheckResult {
  const text = toText(html);
  const lower = text.toLowerCase();
  const warnings: string[] = [];

  const emDashCount = (text.match(/—/g) || []).length;
  if (emDashCount > 0) warnings.push(`${emDashCount} em-dash(es) found`);

  const bannedPhrasesFound = BANNED_PHRASES.filter((p) => lower.includes(p));
  if (bannedPhrasesFound.length > 0) {
    warnings.push(`Banned phrases: ${bannedPhrasesFound.join("; ")}`);
  }

  const namingViolations: string[] = [];
  for (const { pattern, correct } of NAMING_VIOLATIONS) {
    pattern.lastIndex = 0;
    const m = text.match(pattern);
    if (m) namingViolations.push(`"${m[0]}" should be "${correct}"`);
  }
  if (namingViolations.length > 0) {
    warnings.push(`Naming violations: ${namingViolations.join("; ")}`);
  }

  const unsupportedClaims: string[] = [];
  for (const { pattern, note } of UNSUPPORTED_CLAIMS) {
    pattern.lastIndex = 0;
    const hits = text.match(pattern);
    if (hits) unsupportedClaims.push(`"${hits[0]}" x${hits.length}: ${note}`);
  }
  if (unsupportedClaims.length > 0) {
    warnings.push(`Unsupported claims: ${unsupportedClaims.join("; ")}`);
  }

  const seoJargon: string[] = [];
  for (const { pattern, note } of SEO_JARGON) {
    pattern.lastIndex = 0;
    const hits = text.match(pattern);
    if (hits) seoJargon.push(`"${hits[0]}": ${note}`);
  }
  if (seoJargon.length > 0) {
    warnings.push(`Trade jargon in reader-facing copy: ${seoJargon.join("; ")}`);
  }

  // A name on the static seed list that IS a vendor in this article's product
  // data is not a violation. The catalogue outranks the list: if PPW starts
  // carrying a brand, the product data says so and nobody has to edit code.
  const knownNorm = Array.from(opts.knownVendors ?? []).map(normBrand).filter(Boolean);
  const vendorCarried = (name: string) => {
    const n = normBrand(name);
    return knownNorm.some((k) => k === n || k.startsWith(n + " ") || n.startsWith(k + " "));
  };
  const uncarriedBrands: string[] = [];
  for (const { pattern, note } of UNCARRIED_BRANDS) {
    pattern.lastIndex = 0;
    const hits = text.match(pattern);
    if (hits && !vendorCarried(hits[0])) uncarriedBrands.push(`"${hits[0]}": ${note}`);
  }
  // Structural check, topic-agnostic: any proper noun in a "brands like X"
  // construction that is not a vendor in the product data.
  if (opts.knownVendors) {
    for (const name of findUnknownBrands(text, opts.knownVendors)) {
      const alreadyListed = UNCARRIED_BRANDS.some(({ pattern }) => { pattern.lastIndex = 0; return pattern.test(name); });
      if (alreadyListed) continue;
      uncarriedBrands.push(`"${name}": named in a brand list but not a vendor in the product data`);
    }
  }
  if (uncarriedBrands.length > 0) {
    warnings.push(`Brands PPW does not carry: ${uncarriedBrands.join("; ")}`);
  }

  let faqCount: number | null = null;
  if (expectFaq) {
    faqCount = (html.match(/<summary[^>]*class="ppw-faq-question"/gi) || []).length;
    if (faqCount !== 8) warnings.push(`FAQ has ${faqCount} questions, expected 8`);
  }

  return {
    passed: warnings.length === 0,
    emDashCount,
    bannedPhrasesFound,
    namingViolations,
    unsupportedClaims,
    uncarriedBrands,
    seoJargon,
    aiTells: findAiTells(html),
    faqCount,
    warnings,
  };
}

/**
 * Deterministic cleanup of em-dashes in generated HTML. Safe to run on every
 * generation result as a belt-and-braces pass after the prompt-level ban.
 * Converts " — " (spaced) to ", " and bare "—" to ", ".
 * Leaves en-dashes (–, used in ranges like 160–190°F) untouched.
 */
export function stripEmDashes(html: string): string {
  // Also runs the deterministic AI-tell scrub: every generation path already
  // passes its output through here, so this is the one place the cleanup
  // reaches all of them (articles, FAQ, collections, guides, video scripts).
  return scrubAiTells(html.replace(/\s*—\s*/g, ", "));
}
