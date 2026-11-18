// ============================================================================
// GTD BRAND RULES. Single source of truth for writing voice across ALL
// generation routes (articles, bulk, workshop regenerate, ultimate guides,
// section editor, Content Brain chat).
//
// Source: the Green Thumb Depot brand voice doc (18 Nov 2026), built from the
// live site's policy pages and confirmed by Ryan. Any "view the rules" UI
// should import from this file, never duplicate the text.
//
// DO NOT edit generation-route prompts to add voice rules inline.
// Add them here instead.
// ============================================================================

/**
 * Core writing voice rules. Append to the system prompt of every
 * content-generating route via getWritingRulesBlock().
 */
export const WRITING_RULES = `WRITING STYLE - CRITICAL:
Write like an experienced grow-store specialist talking to a cultivator who is about to spend real money on equipment: a commercial facility manager, a craft grower scaling up, or a serious home grower. Clear, specific, direct, grower-literate, and willing to recommend.

SAY THE THING
- Name things before you refer to them, then keep the same name. Do not rotate synonyms ("the unit", "the machine", "the system", "your investment") for variety.
- Finish every comparison. "Better", "faster", "quieter", "cheaper" need a "than what". If you cannot finish it, cut it.
- State the point. Never announce it: no "Here's the thing", "Let me explain", "The honest answer is", "What most people don't realize".
- Follow one concrete example all the way through: the grow (size, room count, harvest weight or stage), what the grower does, what happens. One worked example beats a list of capabilities.
- Every paragraph must be specific to THIS article. If a paragraph could be pasted unchanged into an article about a different product category, cut it or make it specific.

SELL WITH FACTS
- Make recommendations by scale. Say which product or type fits which grow (home tent, craft room, commercial facility) and why, using the spec that decides it: throughput, capacity, coverage, force, power draw, footprint, labor.
- Every selling sentence carries a fact. Replace praise ("commercial-grade", "built to last", "a serious upgrade") with the number or detail that makes it true.
- When labor or payback is the argument, show the working with stated assumptions (hours per pound, wage, harvest size) and label them as assumptions.
- Never invent urgency, scarcity, guarantees, testimonials, customer stories, return or financing terms, or results.
- Never invent experience: no "customers often tell us", "we see this all the time", "in our grow room", "we tested", "this surprises most growers". State the fact and why it matters.

GROWER LANGUAGE
- Use the trade's precise terms and use them correctly: wet trim vs dry trim, bucking, drying vs curing, PPFD and DLI, VPD, EC and pH, run-to-waste vs recirculating, solventless vs solvent extraction, rosin vs resin, live rosin vs live resin, bubble hash (ice water hash) vs dry sift vs kief.
- Do not explain basics to a commercial reader unless the article is a beginner guide. Define a term once, the first time, only when the article's reader may not know it.
- Give specs in the units growers buy on: watts, PPFD (µmol/m²/s) and coverage in feet for lights; pints per day for dehumidifiers; pounds per hour (wet or dry stated) for trimmers and buckers; tons of force and plate size for rosin presses; gallons per hour and PSI for pumps; horsepower or BTU for chillers; gallons or microns for wash bags and hash washers.
- Freeze drying is preservation. Do not blur it with drying and curing harvested flower unless the article is specifically about freeze drying cannabis.

CONNECT THE SENTENCES
- No staged reversals: "This isn't about X. It's about Y", "It's not just X", "X is not a compromise, it is Y". Just state Y.
- No uncounted majority claims. Do not open with "Most growers", "Most cultivators", "Most facilities" unless the supplied material contains the number.
- No runs of dramatic fragments ("Faster trims. Better bag appeal. Less labor."). Join ideas that belong together with and, but, because, so.
- Do not force lists, examples or adjectives into groups of three. Use the number the information has.
- Vary sentence length. Contractions are fine.
- End a section, and the article, on its most specific recommendation or fact. No symmetrical flourish, no restatement.

PLAIN WORDS
- Prefer plain verbs: is, has, uses, holds, fits, costs, runs, pulls, presses.
- Never use: delve, unlock, unleash, elevate, empower, foster, showcase, underscore, testament, tapestry, pivotal, crucial, groundbreaking, revolutionary, world-class, game-changing, cutting-edge, myriad, plethora, "serves as", "stands as", "plays a key role", "in today's landscape", genuinely, honestly, truly.
- Do not swap a banned word for an equally vague synonym. Say what the thing does.
- Never end a sentence with commentary on itself. If the clause carries new information, make it its own sentence.
- Keep precise technical terms. Keep accurate qualifiers (roughly, typically, depending on strain and moisture). Do not inflate certainty or importance.

EVIDENCE
- Never attribute to an unnamed body of work: no "research shows", "studies show", "experts say", "growers agree", "science confirms". State the specific finding or mechanism plainly at its real level of certainty, or leave it out.
- Throughput, capacity, yield and efficiency figures come from the manufacturer's published spec and are attributed to the manufacturer, with the conditions that apply (wet or dry, material type, settings).

CANNABIS AND COMPLIANCE
- Write for adults (21+) in legal markets. Never write content aimed at, or likely to appeal to, minors.
- Cannabis law differs between federal and state level and between states. Never state or imply that growing, processing or selling cannabis is legal everywhere, and never give legal advice. When legality matters to the article, tell the reader to check their state's rules and licensing requirements.
- Never describe how to avoid detection, evade licensing, or move product across state lines.
- No medical or therapeutic claims about cannabis or cannabis products (treats, cures, relieves, helps with a condition). If a health point is unavoidable, use cautious wording, name the source, and send health questions to a clinician.
- Never promise yields, potency, THC or terpene levels, or quality outcomes ("bigger yields", "more potent", "preserves 100% of terpenes", "grams per watt"). Describe what the equipment does and what affects the result.
- Solvent extraction (hydrocarbon, ethanol, CO2) is licensed-lab work. Describe equipment and process at overview level only, note that it belongs in a licensed, code-compliant facility, and never give home or DIY solvent extraction instructions. Solventless methods (rosin, ice water hash, dry sift) can be explained step by step.
- Pest and disease control: only recommend products for use according to their label, and note that rules on what can be applied to cannabis vary by state.
- Freeze-dried food: no food-safety guarantees. Say what freeze drying does to moisture and shelf life at its real level of certainty.

FORMAT
- Do NOT use em dashes anywhere, and do not use spaced hyphens or spaced en dashes as punctuation. Use commas, periods, colons or parentheses. Ranges such as 4–6 tons are fine.
- Headings are short, in sentence case, and name the subject or the action. Never a stock heading such as "Final thoughts", "Conclusion", "The bottom line", "Wrapping up" or "Putting it all together".
- Use a list only when the items are parallel or sequential. Explanations stay in paragraphs. Spec comparisons go in a table.
- Never repeat a point already made. No recap paragraphs.
- NEVER use these AI patterns: "In today's world...", "Let's dive into...", "It's important to note...", "When it comes to...", "Whether you're a...or a...".

CLAIMS - NEVER STATE (factual accuracy, not style):
- Never discuss shipping cost, free shipping thresholds, sales tax, delivery times or freight terms in an article. These are handled at checkout and by the site's policy pages, and they have brand and size exclusions.
- Never promise installation, setup, inside delivery, lift-gate service or moving help. GTD does not offer these.
- Never invent warranty length, return windows, restocking terms, financing terms or approval odds. Warranty is set by each manufacturer; state it only when it is in the product data.
- Never write "lowest price guaranteed", "unbeatable prices", "best prices" or "#1". If price matching is relevant, say a price match is available before purchase and link to the policy.
- Years in business: the only allowed wording is the site's own, "over 10 years of experience". Never inflate it ("decades", "generations", "since the beginning of the industry"). Never claim certifications, licences or in-house testing for GTD or its staff.
- Never write "lab tested by us", "we tested", "our grow team", "our experts", "reviewed by", or "grower approved". No such process is documented.
- GTD may be described as an authorized dealer for brands listed on its Brands page (https://greenthumbdepot.com/pages/brands). Never claim it for a brand that is not on that page.
- GTD is a US company. Never state a city or state for it. When a reader needs to reach GTD, link to the contact page (https://greenthumbdepot.com/pages/contact-us).
- Never state GTD's review rating, rebate percentages or commercial financing amounts.
- Product feature bullets describe the PRODUCT (capacity, throughput, power, materials, certifications such as UL or ETL when in the product data), not GTD's service.
- GTD's real authority is verifiable: it is an authorized dealer for the brands on its Brands page and stocks the major brands in each category side by side, specifications come from manufacturer documentation, and professional growers can book a free 30-minute consult with Elliott Gorfain, GTD's CEA specialist. Say that instead.
- Support hours, when a CTA needs them: Monday to Friday, 9am to 6pm CST.

NAMING RULES (NEVER violate):
- Use "cannabis" in body copy. Use "flower" for harvested, dried product and "buds" in trimming and harvest steps. Use "weed" only where it is the searched phrase (title, URL, one heading) and never in product or collection copy. Use "marijuana" only inside the official name of a law, program or agency. Never "pot", "ganja", "dank", "loud", "trees".
- Brand and model names exactly as the manufacturer writes them: Harvest Right, NugSmasher, PurePressure, Lowtemp, Triminator, Twister, Mobius, Centurion Pro, GreenBroz, FOHSE, Fluence, Gavita, TrolMaster, AC Infinity, Spider Farmer, VIVOSUN, Current Culture H2O, Dosatron, HANNA Instruments, Bubble Magic, The Original Resinator.
- Collection names exactly as they appear on the store.
- "Pre-roll" is hyphenated. "Rosin press" is never "rosin machine" in copy.

SEO REQUIREMENTS:
- The primary keyword for a collection belongs to the collection page. Articles target adjacent and more specific queries and link to the collection.
- Use the primary keyword where a person would naturally say it: the title, the opening section, and one or two headings. Elsewhere use the plain name of the thing. Never repeat a phrase to hit a count.
- Headings say what the section answers.
- Prioritize the grower's question and depth over length. Explain it better than competing articles and forum threads do.

TONE: Specific, practical and grower-literate; confident when recommending a machine for a given scale, plain about what equipment can and cannot promise.

Before finalizing any section, read each sentence once as a commercial grower would. If its meaning is not clear on one read, it oversells, or it would fit any article in any category, rewrite it.`;

/**
 * Phrases that should never appear in published GTD content.
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
  // Grow-store cliches
  "grow like a pro",
  "take your grow to the next level",
  "next-level harvest",
  "massive yields",
  "monster yields",
  "bigger yields",
  "explosive growth",
  "bigger, better buds",
  "fire buds",
  "sticky icky",
  "top-shelf results",
  "bag appeal that sells itself",
  "green rush",
  "set it and forget it",
  "cultivation superstore",
  "sustainable living superstore",
  "unbeatable prices",
  "lowest price guaranteed",
];

/**
 * Claims GTD cannot support. These are checked separately from BANNED_PHRASES
 * because they are accuracy problems, not voice problems: a hit here is a
 * factual claim to correct, not a stylistic tic. Each one traces to a line in
 * the CLAIMS or CANNABIS AND COMPLIANCE blocks of WRITING_RULES.
 */
export const UNSUPPORTED_CLAIMS: Array<{ pattern: RegExp; note: string }> = [
  // Catalogue scope. The featured products in an article are a selection from
  // a far larger range; the article may never describe them as the whole range.
  { pattern: /\b(?:GTD|Green Thumb Depot|we)\s+(?:currently\s+)?(?:carr(?:y|ies)|stocks?|offers?|sells?)\s+(?:only\s+)?(?:two|three|four|2|3|4)?\s*(?:brands?|vendors?|manufacturers?)?\s*(?::|,)?\s*[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*\s+and\s+[A-Z][\w&.'-]*/g, note: "names featured vendors as the brands GTD carries; the catalogue is far larger" },
  { pattern: /\b(?:the|all|every|only)\s+(?:[\w-]+\s+){0,4}(?:brands?|vendors?|models?|options?|manufacturers?)\s+(?:available|offered|sold|stocked|carried)\s+(?:through|by|at|from)\s+(?:GTD|Green Thumb Depot|us)\b/gi, note: "implies the featured products are the whole range" },
  { pattern: /\b(?:GTD|Green Thumb Depot)\s+(?:currently\s+)?(?:carries|stocks|offers)\s+(?:two|three|four|2|3|4)\s+(?:brands?|vendors?|manufacturers?)\b/gi, note: "counts featured vendors as the whole range" },
  { pattern: /\b(?:only|the two|both)\s+(?:brands?|vendors?)\s+(?:GTD|Green Thumb Depot|we)\s+(?:carr(?:y|ies)|stocks?|sells?)\b/gi, note: "implies the featured products are the whole range" },

  // Shipping, tax and delivery. Handled at checkout, with brand and size exclusions.
  { pattern: /free\s+shipping/gi, note: "shipping cost and free shipping are never discussed in an article" },
  { pattern: /shipping\s+is\s+free/gi, note: "shipping cost and free shipping are never discussed in an article" },
  { pattern: /\bshipping\b[^.]{0,40}\b(?:free|cost|costs|fee|fees|charge|charges|price|budget)\b/gi, note: "shipping cost is never discussed in an article, either way" },
  { pattern: /\b(?:cost|costs|fee|fees|charge|charges|price)\b[^.]{0,20}\bshipping\b/gi, note: "shipping cost is never discussed in an article, either way" },
  { pattern: /\bsales\s+tax\b/gi, note: "sales tax is handled at checkout, not in an article" },
  { pattern: /\b(?:ships?|shipped|delivered|arrives?|delivery)\s+(?:in|within)\s+\d+/gi, note: "delivery timeframes vary by brand and freight, do not state one" },

  // Services GTD does not offer.
  { pattern: /white[\s-]?glove/gi, note: "GTD does not offer white-glove delivery or installation" },
  { pattern: /\b(?:inside\s+delivery|lift[\s-]?gate)\b/gi, note: "GTD does not promise inside delivery or lift-gate service" },
  { pattern: /\b(?:free|includes?|included|complimentary)\s+(?:professional\s+)?(?:installation|set[\s-]?up|assembly)\b/gi, note: "installation, setup and assembly are not offered" },
  { pattern: /\b(?:installation|assembly|set[\s-]?up)\s+(?:is\s+)?included\b/gi, note: "installation, setup and assembly are not offered" },

  // Warranty, returns, financing, rebates.
  { pattern: /lifetime\s+warranty/gi, note: "warranty terms are set per manufacturer, verify before claiming" },
  { pattern: /\b\d+[\s-]day\s+(?:returns?|return\s+policy|money[\s-]back)\b/gi, note: "return windows are not stated in articles, link to the policy" },
  { pattern: /\brestocking\s+fees?\b/gi, note: "restocking terms are not stated in articles, link to the policy" },
  { pattern: /\b0%\s+(?:apr|interest|financing)\b/gi, note: "financing terms are not confirmed for articles" },
  { pattern: /\b(?:guaranteed|instant|easy)\s+approval\b/gi, note: "financing approval is never promised" },
  { pattern: /\bup\s+to\s+\$?500,?000\b/gi, note: "commercial financing amounts are not confirmed, do not state them" },
  { pattern: /\brebates?\s+(?:of\s+)?up\s+to\b|\b\d+%\s+rebates?\b/gi, note: "rebate percentages and eligibility are not confirmed, do not state them" },

  // Price claims. Only a pre-purchase price match exists.
  { pattern: /\b(?:lowest|best|unbeatable|cheapest)\s+prices?\b/gi, note: "price superlative; only a pre-purchase price match exists" },
  { pattern: /\bprice\s+guarantee\b|\bguaranteed\s+lowest\b/gi, note: "price guarantee; only a pre-purchase price match exists" },
  { pattern: /#1\s+(?:source|store|supplier|retailer|choice|rated|destination)\b/gi, note: "unevidenced #1 claim" },
  { pattern: /\brated\s+\d(?:\.\d)?\s*(?:\/|out\s+of)\s*5\b/gi, note: "GTD's review rating is never stated" },

  // Authorship, tenure and credentials. The only allowed tenure wording is the
  // site's own, "over 10 years of experience".
  { pattern: /\b(?!10\s+years\s+of\s+experience)\d+\+?\s*years?\s+(?:of\s+)?(?:experience|expertise|in\s+the\s+(?:industry|business|field))\b/gi, note: "the only allowed tenure wording is \"over 10 years of experience\"" },
  { pattern: /\b(?:decades?|generations?)\s+of\s+(?:experience|expertise)\b/gi, note: "inflated tenure claim" },
  { pattern: /\b(?:lab[\s-]tested\s+by\s+us|we(?:'ve|\s+have)?\s+tested|tested\s+in\s+our|our\s+grow\s+(?:team|room)|grower[\s-]approved)\b/gi, note: "no in-house testing or grow team is documented" },
  { pattern: /\breviewed\s+by\s+(?:our|a|an)\b/gi, note: "no named reviewer process exists, do not imply one" },
  { pattern: /\bour\s+(?:certified|licensed|accredited)\b/gi, note: "GTD staff hold no certifications we can evidence" },
  { pattern: /\bour\s+(?:team\s+of\s+)?experts?\b/gi, note: "do not assert in-house expert staff; say what is true: authorized dealer, free consult for professional growers" },
  { pattern: /\b(?:industry[\s-]leading\s+expertise|unrivalled\s+expertise|unmatched\s+expertise)\b/gi, note: "unevidenced expertise superlative" },
  { pattern: /\b(?:GTD|Green Thumb Depot|we)\s+(?:is|are)\s+(?:based|located|headquartered)\s+in\b/gi, note: "never state a city or state for GTD; say US company and link to the contact page" },

  // Yield, potency and quality outcomes.
  { pattern: /\b(?:guaranteed?|bigger|massive|monster|explosive|doubles?|triples?)\s+(?:your\s+)?yields?\b/gi, note: "yield promise; describe what the equipment does and what affects the result" },
  { pattern: /\b(?:boosts?|increases?|maximi[sz]es?|improves?)\s+(?:your\s+)?(?:yields?|potency|thc|terpenes?|terpene\s+levels?)\b/gi, note: "yield, potency or terpene outcome promised" },
  { pattern: /\bmore\s+potent\b/gi, note: "potency outcome promised" },
  { pattern: /\b(?:preserves?|retains?|keeps?)\s+100%\b/gi, note: "absolute preservation claim" },
  { pattern: /\bgrams?\s+per\s+watt\b/gi, note: "grams-per-watt is a yield promise, do not use it" },
  { pattern: /\bguaranteed\s+(?:results|harvest|quality)\b/gi, note: "outcome guarantee, never make one" },
  { pattern: /\bscientifically\s+proven\b/gi, note: "say what the research shows, never assert proof" },

  // Cannabis, medical and legal.
  { pattern: /\b(?:treats?|cures?|relieves?|heals?|fights?)\s+(?:anxiety|pain|chronic\s+pain|insomnia|depression|cancer|epilepsy|seizures|nausea|inflammation|arthritis|ptsd)\b/gi, note: "medical or therapeutic claim about cannabis, never make one" },
  { pattern: /\b(?:medical|medicinal|therapeutic|health)\s+benefits\s+of\s+(?:cannabis|marijuana|weed|thc|cbd|rosin|hash)\b/gi, note: "medical or therapeutic claim about cannabis" },
  { pattern: /\bclinically\s+(?:proven|validated|tested)\b/gi, note: "clinical efficacy claims require cited evidence, never assert them" },
  { pattern: /\b(?:doctor|physician)[\s-]?(?:recommended|approved|endorsed)\b/gi, note: "no practitioner endorsement exists" },
  { pattern: /\blegal\s+(?:everywhere|nationwide|in\s+all\s+(?:50\s+)?states|in\s+every\s+state)\b/gi, note: "cannabis legality varies by state; never imply it is universal" },
  { pattern: /\b(?:100%|completely|fully|perfectly)\s+legal\b/gi, note: "never give a blanket legality statement; tell the reader to check state rules" },
  { pattern: /\b(?:diy|home|homemade|at[\s-]home)\s+(?:bho|butane|propane|hydrocarbon|solvent|ethanol|co2)\s+(?:extraction|extracts?|hash\s+oil)\b/gi, note: "home or DIY solvent extraction instructions are never given" },
  { pattern: /\bopen[\s-]blast(?:ing)?\b/gi, note: "open blasting is unsafe and unlicensed; never describe it as a method" },
  { pattern: /\b(?:guaranteed|completely|100%)\s+(?:food[\s-])?safe\b/gi, note: "no food-safety guarantee for freeze-dried food" },
];

/** Forbidden names mapped to their canonical replacements. */
export const NAMING_VIOLATIONS: Array<{ pattern: RegExp; correct: string }> = [
  { pattern: /\brosin\s+machines?\b/gi, correct: "rosin press" },
  { pattern: /\bpre\s+rolls?\b|\bprerolls?\b/gi, correct: "pre-roll" },
  { pattern: /\bganja\b/gi, correct: "cannabis" },
  { pattern: /\bdank\b/gi, correct: "cannabis (or cut the word)" },
  { pattern: /\bnug\s+smasher\b/gi, correct: "NugSmasher" },
  { pattern: /\bharvestright\b/gi, correct: "Harvest Right" },
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
 * Brands GTD does NOT carry. The model reaches for the names it has seen most
 * often online, so a prompt rule alone does not hold.
 *
 * This list is a SEED, not the guard, and it starts EMPTY on purpose. The
 * structural check in findUnknownBrands() is what generalises: it looks for
 * the "brands like X, Y or Z" construction and flags any proper noun in it
 * that is not a vendor in the product data for the article.
 *
 * Do not add a brand here until it has been checked against the Shopify vendor
 * list AND the Brands page (https://greenthumbdepot.com/pages/brands). GTD
 * carries about 190 brands, including several that competitors are known for
 * (Mars Hydro, Vipar Spectra, Gavita, Fluence), so a well-known name is not
 * evidence that GTD does not stock it. Unverified candidates from the voice
 * doc: Gorilla Grow Tent, HLG, Athena, Lumatek, Rosin Tech.
 */
export const UNCARRIED_BRANDS: Array<{ pattern: RegExp; note: string }> = [
];

/**
 * The construction a competitor plug almost always arrives in: "brands like X",
 * "such as those from X or Y", "options from X, Y and Z". Capturing the clause
 * and reading the proper nouns out of it is topic-agnostic, which a name list
 * can never be.
 */
const BRAND_LIST_CONSTRUCTION =
  /\b(?:brands?|makers?|manufacturers?|companies|names?|models?|units?|options?|those|others?|some|many|ones?|products?|trimmers?|presses|lights?|machines?)\s+(?:like|such\s+as|including|from|by)\s+(?:those\s+(?:from|by)\s+)?([^.;:!?\n]{0,140})/gi;

/**
 * Capitalised words that are not brands. Sentence-initial words are not a
 * concern because the construction never starts a sentence, but units, bodies,
 * product categories and GTD's own names all show up capitalised mid-sentence.
 */
const NOT_A_BRAND = new Set([
  "gtd", "green", "thumb", "depot", "us", "usa", "uk", "eu", "led", "hps", "cmh", "uv", "ir",
  "ppfd", "ppf", "par", "dli", "vpd", "ec", "ph", "tds", "co2", "thc", "cbd", "hvac", "cea",
  "dwc", "rdwc", "nft", "psi", "gph", "cfm", "kw", "btu", "etl", "ul", "csa", "dlc", "fda",
  "usda", "epa", "osha", "the", "a", "an",
  "and", "or", "of", "for", "with", "in", "on", "at", "to", "from", "by", "i", "your", "our",
  "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday",
  "saturday", "sunday", "american", "european", "canadian", "dutch", "japanese", "chinese",
  "german", "italian", "indica", "sativa", "cannabis", "hemp",
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
 * vendor, is a prefix of one, or is one word of a multi-word vendor ("Current"
 * for "Current Culture H2O").
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
  { pattern: /(?:^|[.!?]\s+)Most (?:people|buyers|shoppers|owners|users|customers|growers|cultivators|facilities|operators|home growers|beginners)\b/g, note: "uncounted majority claim" },
  { pattern: /\b(?:surprises|catches out|trips up) (?:people|buyers|most|many)\b/gi, note: "invented customer experience" },
  { pattern: /\bnobody (?:thinks|talks|plans|tells you)\b/gi, note: "invented customer experience" },
  { pattern: /\b(?:in our experience|we see this|we(?:'ve| have) seen (?:this|it|many|plenty)|customers (?:often |always )?tell us|we hear from|in our grow room|we(?:'ve| have) run this)\b/gi, note: "invented experience" },
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
  // data is not a violation. The catalogue outranks the list: if GTD starts
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
    warnings.push(`Brands GTD does not carry: ${uncarriedBrands.join("; ")}`);
  }

  let faqCount: number | null = null;
  if (expectFaq) {
    faqCount = (html.match(/<summary[^>]*class="gtd-faq-question"/gi) || []).length;
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
