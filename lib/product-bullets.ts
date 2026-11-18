// ============================================================================
// PRODUCT-CARD BULLET AUDIT — parse, inventory and repair the feature bullets
// inside .gtd-product-card blocks across published blog articles.
//
// WHY THIS EXISTS
// Product-card bullets were never product-specific. extractFeatures() in
// app/api/generate/route.ts (and its clones in workshop/regenerate and revamp)
// always unshifted "White-Glove Delivery Included" as the bolded first bullet
// and always appended "Ongoing Expert Phone Support" as the last, then padded
// the middle with generic filler ("Free Shipping Included", "Expert US-Based
// Support", ...) whenever the product matched fewer than two featureMap
// patterns. GTD does not offer white-glove delivery/assembly, and free
// shipping is conditional on product class (not offered on freight items such
// as saunas), so both claims had to come out of every published post.
//
// This module is deliberately deterministic and side-effect free so it can be
// unit-tested and dry-run safely. The Shopify I/O lives in
// app/api/maintenance/bullet-audit/route.ts.
// ============================================================================

/** Bullets removed outright from every card. Compared against the normalized label. */
export const REMOVE_BULLETS: string[] = [
  "white-glove delivery included",
  "white glove delivery included",
  "white-glove delivery",
  "white glove delivery",
  "white-glove assembly",
  "white glove assembly",
  "white-glove assembly included",
  "white glove assembly included",
  "white-glove delivery & assembly",
  "white glove delivery & assembly",
  "free shipping included",
  "free shipping",
  "free shipping on all orders",
  // Found in the Aug 3 2026 dry run: white-glove promises phrased differently,
  // which the literal "white glove" list above did not catch.
  "room-of-choice delivery",
  "room of choice delivery",
  "professional assembly available",
  "professional assembly included",
  "professional installation ensures optimal performance and safety",
  // Broken generator output: the /\b(\d+)[\s-]?kw\b/ pattern captured a zero, so
  // 54 cards shipped a bullet that literally reads "0kW Power Output".
  "0kw power output",
  "0-person capacity",
  "0-gallon water capacity",
];

/**
 * Reported, never auto-deleted. These are claims that may be true for a given
 * product but cannot be verified from the article HTML alone, so a human has to
 * confirm each one. Surfaced as the "review" column in the dry-run report.
 *
 * Warranty terms are set per manufacturer, financing examples go stale as rates
 * and prices change, and a hardcoded price in a bullet drifts the moment the
 * product is repriced in Shopify.
 */
export const REVIEW_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /warrant/i, reason: "warranty term, verify against the manufacturer" },
  { pattern: /\bAPR\b|financed|financing/i, reason: "financing figures go stale" },
  { pattern: /^price:\s*\$|\$[\d,]+\s*(?:-|–)/i, reason: "hardcoded price drifts from Shopify" },
  { pattern: /professional (?:installation|delivery|assembly)/i, reason: "service claim, confirm GTD offers it" },
  { pattern: /guarantee/i, reason: "guarantee claim, confirm it exists" },
  { pattern: /\blifetime\b/i, reason: "lifetime claim, rarely accurate" },
];

/** Which review reasons, if any, a bullet trips. */
export function reviewReasons(label: string): string[] {
  const out: string[] = [];
  for (const { pattern, reason } of REVIEW_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(label)) out.push(reason);
  }
  return out;
}

/**
 * The single service bullet GTD keeps on a product card. Ryan's call, Aug 3 2026:
 * two product-specific specs plus this one line. Everything else on a card must
 * describe the product.
 *
 * Defined once so changing the wording is a one-line edit rather than a
 * migration across every stored row.
 */
export const SERVICE_BULLET = "Ongoing US-Based Phone Support";

/**
 * 1:1 rewrites, applied before the removal pass.
 *
 * ONLY "Ongoing Expert Phone Support" is renamed here, and deliberately so.
 * "Expert US-Based Support" is left alone even though it is also filler: 955
 * cards carry BOTH, and mapping both to SERVICE_BULLET collapsed those cards to
 * a single bullet, which tripped the minBullets floor and caused the whole card
 * to be skipped. Skipping means white-glove and free-shipping claims survive on
 * exactly the cards that most needed cleaning. Removing a false claim always
 * takes priority over tidying an accurate but redundant one.
 *
 * "Expert US-Based Support" disappears anyway the moment a card is regenerated,
 * since regeneration replaces the whole list.
 */
export const REPLACE_BULLETS: Record<string, string> = {
  "ongoing expert phone support": SERVICE_BULLET,
};

/**
 * Known template prose carrying the same unsupported claims. These are exact
 * generator output strings, so replacing them is safe. Free-text prose mentions
 * are reported but never auto-edited (see scanProse).
 */
export const PROSE_REPLACEMENTS: Array<{ find: string; replace: string }> = [
  {
    find: "Premium quality with white-glove delivery included, pre-delivery inspection, and expert support.",
    replace: "Premium quality with pre-delivery inspection and expert support.",
  },
  {
    find: "Chosen by 1 million+ customers. Free shipping on orders over $100.",
    replace: "Chosen by 1 million+ customers.",
  },
];

/** Phrases worth flagging for manual review wherever they appear in body prose. */
export const PROSE_FLAGS: RegExp[] = [
  /white[\s-]?glove/gi,
  /free\s+shipping/gi,
  /shipping\s+is\s+free/gi,
  /includes?\s+(?:free\s+)?assembly/gi,
  /assembly\s+included/gi,
];

// ── Types ───────────────────────────────────────────────────────────────────

export type CardBullet = {
  /** Raw inner HTML of the <li>, check glyph included. */
  raw: string;
  /** Plain-text label, glyph and <strong> stripped, whitespace collapsed. */
  label: string;
  /** True when the original bullet was wrapped in <strong>. */
  bold: boolean;
};

export type ParsedCard = {
  /** Product handle read from the card CTA href, when present. */
  handle: string | null;
  /** Product title from the card <h3>. */
  title: string;
  bullets: CardBullet[];
  /** Check glyph used by this card: U+2705 for legacy cards, U+2713 for revamp cards. */
  glyph: string;
  /** Byte offsets of the card's <ul>...</ul> within the source HTML. */
  ulStart: number;
  ulEnd: number;
  /** Byte offsets of the whole card block, for swapping the product outright. */
  cardStart: number;
  cardEnd: number;
};

export type ProseHit = { phrase: string; context: string };

export type BulletFix = {
  fixed: string;
  /** Bullets deleted across all cards in this article. */
  removed: number;
  /** Bullets rewritten via REPLACE_BULLETS. */
  replaced: number;
  /** Template prose sentences rewritten. */
  proseFixed: number;
  /** Cards whose bullet list changed. */
  cardsTouched: number;
  /** Labels removed, for the dry-run report. */
  removedLabels: string[];
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const CHECK_GLYPHS = ["✅", "✓", "✔", "☑"];

/** Strip tags, decode the handful of entities the generators emit, collapse space. */
export function toLabel(inner: string): string {
  let s = inner.replace(/<[^>]+>/g, "");
  for (const g of CHECK_GLYPHS) s = s.split(g).join(" ");
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return s.replace(/\s+/g, " ").trim();
}

/** Normalized key for matching against REMOVE_BULLETS / REPLACE_BULLETS. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectGlyph(ulHtml: string): string {
  for (const g of CHECK_GLYPHS) if (ulHtml.includes(g)) return g;
  return "✅";
}

/**
 * Locate every .gtd-product-card and parse its bullet list.
 *
 * The card markup is generator-produced and stable: a card opens with
 * <div class="gtd-product-card" ...>, contains exactly one <ul> of <li> feature
 * bullets, and closes with <a class="gtd-cta" href="/products/<handle>">. We
 * slice from each card start to the next card start (or the end of the enclosing
 * section) rather than trying to balance <div> tags, which is both simpler and
 * resilient to the nested image/price divs.
 */
export function parseCards(html: string): ParsedCard[] {
  const cards: ParsedCard[] = [];
  const cardRe = /<div[^>]*class="[^"]*\bgtd-product-card\b[^"]*"[^>]*>/gi;

  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) starts.push(m.index);

  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : html.length;
    const chunk = html.slice(from, to);

    const ulMatch = /<ul[^>]*>([\s\S]*?)<\/ul>/i.exec(chunk);
    if (!ulMatch) continue;

    const ulInner = ulMatch[1];
    const bullets: CardBullet[] = [];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let li: RegExpExecArray | null;
    while ((li = liRe.exec(ulInner)) !== null) {
      const raw = li[1];
      bullets.push({
        raw,
        label: toLabel(raw),
        bold: /<strong[^>]*>/i.test(raw),
      });
    }
    if (bullets.length === 0) continue;

    const handle =
      /<a[^>]*class="[^"]*\bgtd-cta\b[^"]*"[^>]*href="[^"]*\/products\/([^"?#]+)/i.exec(chunk)?.[1] ??
      /href="[^"]*\/products\/([^"?#]+)/i.exec(chunk)?.[1] ??
      null;

    const title = toLabel(/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(chunk)?.[1] || "");

    cards.push({
      handle: handle ? decodeURIComponent(handle) : null,
      title,
      bullets,
      glyph: detectGlyph(ulMatch[0]),
      ulStart: from + ulMatch.index,
      ulEnd: from + ulMatch.index + ulMatch[0].length,
      cardStart: from,
      cardEnd: to,
    });
  }

  return cards;
}

/** Rebuild a card <ul> from labels: first bullet bolded, rest plain. */
function renderUl(labels: string[], glyph: string): string {
  const lis = labels
    .map((l, i) => (i === 0 ? `<li>${glyph} <strong>${l}</strong></li>` : `<li>${glyph} ${l}</li>`))
    .join("\n");
  return `<ul>\n${lis}\n</ul>`;
}

/** Flag unsupported-claim prose outside the product cards. Report only. */
export function scanProse(html: string): ProseHit[] {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const hits: ProseHit[] = [];
  for (const re of PROSE_FLAGS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = Math.max(0, m.index - 90);
      hits.push({
        phrase: m[0],
        context: text.slice(start, m.index + m[0].length + 90).trim(),
      });
      if (hits.length >= 40) return hits;
    }
  }
  return hits;
}

/**
 * Build the repaired article body. Returns null when nothing needs changing so
 * callers can skip the Shopify write entirely.
 *
 * @param html          Article body_html
 * @param removeLabels  Normalized labels to delete (defaults to REMOVE_BULLETS)
 * @param minBullets    Never shrink a card below this many bullets (default 2);
 *                      if removal would breach it, the card is left untouched
 *                      and reported so it can be handled by hand.
 */
export function buildBulletFix(
  html: string,
  removeLabels: string[] = REMOVE_BULLETS,
  minBullets = 2
): BulletFix | null {
  if (!html) return null;

  const removeSet = new Set(removeLabels.map(normalizeLabel));
  const cards = parseCards(html);

  let removed = 0;
  let replaced = 0;
  let cardsTouched = 0;
  const removedLabels: string[] = [];

  // Rewrite from the end so earlier offsets stay valid.
  let out = html;
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i];
    const kept: string[] = [];
    const dropped: string[] = [];
    let cardReplaced = 0;

    for (const b of card.bullets) {
      const key = normalizeLabel(b.label);
      const swap = REPLACE_BULLETS[key];
      if (swap) {
        kept.push(swap);
        cardReplaced++;
        continue;
      }
      if (removeSet.has(key)) {
        dropped.push(b.label);
        continue;
      }
      kept.push(b.label);
    }

    // Normalising two different service bullets to one wording can leave a card
    // saying the same thing twice. Collapse duplicates, keeping first position.
    const seenKept = new Set<string>();
    const deduped: string[] = [];
    for (const label of kept) {
      const key = normalizeLabel(label);
      if (seenKept.has(key)) {
        dropped.push(label);
        continue;
      }
      seenKept.add(key);
      deduped.push(label);
    }
    kept.length = 0;
    kept.push(...deduped);

    if (dropped.length === 0 && cardReplaced === 0) continue;
    // Guard: don't strip a card down to a stub. Report instead.
    if (kept.length < minBullets) continue;

    const wasBoldFirst = card.bullets[0]?.bold ?? true;
    const rebuilt = wasBoldFirst
      ? renderUl(kept, card.glyph)
      : `<ul>\n${kept.map((l) => `<li>${card.glyph} ${l}</li>`).join("\n")}\n</ul>`;

    out = out.slice(0, card.ulStart) + rebuilt + out.slice(card.ulEnd);

    removed += dropped.length;
    replaced += cardReplaced;
    removedLabels.push(...dropped);
    cardsTouched++;
  }

  let proseFixed = 0;
  for (const { find, replace } of PROSE_REPLACEMENTS) {
    if (!out.includes(find)) continue;
    proseFixed += out.split(find).length - 1;
    out = out.split(find).join(replace);
  }

  if (removed === 0 && replaced === 0 && proseFixed === 0) return null;

  return { fixed: out, removed, replaced, proseFixed, cardsTouched, removedLabels };
}

// ── Telling template bullets apart from bespoke ones ────────────────────────

/**
 * Every literal label the deterministic generators can emit. These are the
 * bullets that came out of a regex map, not out of anyone's judgement, so they
 * are the ones safe to regenerate.
 *
 * Sourced from the featureMap in app/api/generate/route.ts, its clones in
 * app/api/workshop/regenerate/route.ts and app/api/revamp/generate/route.ts,
 * lib/product-card.ts, and the shared service filler. Confirmed against the
 * Aug 3 2026 dry run: every bullet with 7 or more uses across the store appears
 * in this list, and nothing below that threshold does.
 *
 * Parameterized labels (capacity, power, micron) are handled by
 * TEMPLATE_PATTERNS below since their rendered text varies.
 */
export const TEMPLATE_BULLETS: string[] = [
  // Service filler, including the normalised SERVICE_BULLET wording
  "white-glove delivery included", "ongoing expert phone support", "free shipping included",
  "expert us-based support", "quality inspected before shipping", "easy assembly",
  "ongoing us-based phone support", "concierge customer service",
  // Sauna / heat
  "low emf certified", "ultra-low emf technology", "full spectrum heating", "carbon heating panels",
  "ceramic heaters", "canadian cedar construction", "hemlock wood construction",
  "premium dual-wall build", "classic barrel design", "space-saving corner design",
  "integrated steam generator", "aromatherapy compatible", "chromotherapy lighting",
  // Water / cold
  "active cooling system", "advanced filtration", "ozone sanitization", "multi-stage filtration",
  "hydrogen-rich water", "alkaline water system", "epsom salt / magnesium water",
  "large-capacity float pool", "open pool design", "fiberglass shell construction",
  // Float / hyperbaric
  "sensory deprivation tank", "soundproofed float environment", "enclosed pod design",
  "fully enclosed design", "hyperbaric pressure chamber", "multi-pressure ata settings",
  // Light
  "medical-grade leds", "targeted wavelength therapy", "uv sanitization system",
  // Build / controls
  "stainless steel construction", "enhanced insulation", "outdoor-rated design",
  "portable design", "foldable for easy storage", "commercial-grade build",
  "easy-access entry design", "touchscreen controls", "digital control panel",
  "wifi & app control", "built-in audio system", "bluetooth connectivity",
  // Cardio / strength
  "water resistance flywheel", "air resistance flywheel", "magnetic resistance",
  "performance monitor console", "solid hardwood frame", "stores upright",
  "adjustable incline", "cushioned running deck", "heart rate monitoring",
  "multiple resistance levels",
  // Supplements (revamp route)
  "whey protein base", "casein protein", "plant-based protein", "protein isolate",
  "hydrolyzed peptides", "bcaa formula", "creatine monohydrate", "creatine formula",
  "caffeine boost", "beta-alanine", "nitric oxide booster", "l-glutamine",
  "hydrolyzed collagen", "electrolyte blend", "omega-3 fish oil", "probiotic cultures",
  "digestive enzymes", "antioxidant blend", "third-party tested", "certified organic",
  "non-gmo", "dietary certified", "zero sugar", "keto-friendly", "grass-fed source",
  "unflavored", "no artificial additives", "made in the usa", "quality verified",
];

/** Parameterized template labels, whose rendered numbers vary per product. */
export const TEMPLATE_PATTERNS: RegExp[] = [
  /^\d+-person capacity$/i,
  /^[\d.]+kw power output$/i,
  /^\d+-gallon water capacity$/i,
  /^\d+-micron filtration$/i,
  /^[\d.]+ ata pressure$/i,
  /^\d+ lb user capacity$/i,
];

const TEMPLATE_SET = new Set(TEMPLATE_BULLETS.map(normalizeLabel));

/** True when this bullet came out of a regex map rather than someone's judgement. */
export function isTemplateBullet(label: string): boolean {
  const key = normalizeLabel(label);
  if (TEMPLATE_SET.has(key)) return true;
  return TEMPLATE_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(key);
  });
}

/**
 * A card counts as bespoke when, after setting aside the bullets queued for
 * deletion, it still has at least `minBespoke` bullets that no generator could
 * have produced. Those cards were written by a human or by the long-form AI
 * route, so regenerating them would overwrite good work with generic specs.
 *
 * Ryan's call (Aug 3 2026): leave the good bullets alone, remove only the
 * flagged phrases.
 */
export function isBespokeCard(
  card: ParsedCard,
  removeLabels: string[] = REMOVE_BULLETS,
  minBespoke = 2
): boolean {
  const removeSet = new Set(removeLabels.map(normalizeLabel));
  const surviving = card.bullets.filter((b) => !removeSet.has(normalizeLabel(b.label)));
  const bespoke = surviving.filter((b) => !isTemplateBullet(b.label));
  return bespoke.length >= minBespoke;
}

// ── Curated per-product bullets ─────────────────────────────────────────────

export type CardRewrite = {
  fixed: string;
  /** Cards whose bullets were replaced with curated per-product bullets. */
  cardsRewritten: number;
  /** Cards with no curated bullets, repaired by deletion instead. */
  cardsCleaned: number;
  /** Cards left alone because their bullets were already bespoke. */
  cardsProtected: number;
  /** Product handles seen on cards that had no curated bullets available. */
  missingHandles: string[];
  removed: number;
  proseFixed: number;
};

/**
 * One-pass article rewrite.
 *
 * For every product card: if curated bullets exist for that card's product
 * handle, the whole bullet list is replaced with them (which removes any
 * unsupported claim as a side effect). Cards with no curated bullets fall back
 * to the deletion pass, so an article is never left half-repaired.
 *
 * Cards whose bullets are already bespoke are never rewritten, only cleaned.
 * See isBespokeCard.
 *
 * Returns null when nothing changed, so callers can skip the Shopify write.
 *
 * @param bulletsByHandle  product handle -> curated bullets (2 to 4)
 */
export function buildCardRewrite(
  html: string,
  bulletsByHandle: Record<string, string[]>,
  opts: {
    removeLabels?: string[];
    /** Never write a card with fewer than this many bullets. */
    minBullets?: number;
    /** Skip cards whose bullets are already product-specific. */
    protectBespoke?: boolean;
    /**
     * Appended as the final bullet of every rewritten card. Stored bullets hold
     * only the product specs, so the service line stays a one-line change here
     * rather than a migration across every row. Pass null to omit it.
     */
    serviceBullet?: string | null;
  } = {}
): CardRewrite | null {
  if (!html) return null;

  const removeLabels = opts.removeLabels ?? REMOVE_BULLETS;
  const minBullets = opts.minBullets ?? 2;
  const protectBespoke = opts.protectBespoke ?? true;
  const serviceBullet = opts.serviceBullet === undefined ? SERVICE_BULLET : opts.serviceBullet;

  const cards = parseCards(html);
  const missingHandles = new Set<string>();
  let cardsRewritten = 0;
  let cardsProtected = 0;
  let out = html;

  // Rewrite from the end so earlier offsets stay valid.
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i];

    // Already-good bullets are left exactly as they are. The deletion pass
    // below still strips any flagged phrase from them.
    if (protectBespoke && isBespokeCard(card, removeLabels)) {
      cardsProtected++;
      continue;
    }

    const curated = card.handle ? bulletsByHandle[card.handle] : undefined;

    // A stored entry holds product specs only. One spec plus the service line
    // is the floor; below that the card is left for the deletion pass.
    const specFloor = serviceBullet ? Math.max(minBullets - 1, 1) : minBullets;
    if (!curated || curated.length < specFloor) {
      if (card.handle) missingHandles.add(card.handle);
      continue;
    }

    const specs = curated.slice(0, serviceBullet ? 3 : 4);
    const next = serviceBullet ? [...specs, serviceBullet] : specs;
    // Guard against a stored row that already contains the service line.
    const seenNext = new Set<string>();
    const nextUnique = next.filter((l) => {
      const k = normalizeLabel(l);
      if (seenNext.has(k)) return false;
      seenNext.add(k);
      return true;
    });

    const current = card.bullets.map((b) => b.label);
    // Skip the write when the card already carries exactly these bullets.
    if (current.length === nextUnique.length && current.every((l, j) => l === nextUnique[j])) continue;

    out = out.slice(0, card.ulStart) + renderUl(nextUnique, card.glyph) + out.slice(card.ulEnd);
    cardsRewritten++;
  }

  // Anything not covered by curated bullets still needs the claims stripped and
  // its service wording normalised. Protected cards go through here too.
  const cleanup = buildBulletFix(out, removeLabels, minBullets);
  if (cleanup) out = cleanup.fixed;

  if (cardsRewritten === 0 && !cleanup) return null;

  return {
    fixed: out,
    cardsRewritten,
    cardsCleaned: cleanup?.cardsTouched ?? 0,
    cardsProtected,
    missingHandles: [...missingHandles],
    removed: cleanup?.removed ?? 0,
    proseFixed: cleanup?.proseFixed ?? 0,
  };
}

export type HandleInfo = {
  title: string;
  cards: number;
  /** Cards for this product whose bullets came from a regex map. */
  templateCards: number;
  /** Cards for this product whose bullets are already bespoke. */
  bespokeCards: number;
};

/**
 * Every distinct product handle referenced by a card, with its card count split
 * by whether the bullets are template output or already bespoke. Only products
 * with at least one template card are worth spending an AI draft on.
 */
export function inventoryHandles(
  html: string,
  removeLabels: string[] = REMOVE_BULLETS
): Map<string, HandleInfo> {
  const out = new Map<string, HandleInfo>();
  for (const card of parseCards(html)) {
    if (!card.handle) continue;
    const prev =
      out.get(card.handle) || { title: card.title, cards: 0, templateCards: 0, bespokeCards: 0 };
    prev.cards++;
    if (isBespokeCard(card, removeLabels)) prev.bespokeCards++;
    else prev.templateCards++;
    if (!prev.title && card.title) prev.title = card.title;
    out.set(card.handle, prev);
  }
  return out;
}


// ── Swapping a card to a different product ──────────────────────────────────

export type SwapProduct = {
  handle: string;
  title: string;
  imageUrl?: string | null;
  price?: string | null;
  /** Curated specs. The service bullet is appended, same as a normal rewrite. */
  bullets?: string[];
};

export type CardSwap = { fixed: string; cardsSwapped: number };

/** Card CTA label: brand prefix and category suffix trimmed off the title. */
export function shortName(title: string): string {
  const cleaned = title
    .replace(
      /^(dynamic|maxxus|golden designs|sun home|medical breakthrough|therasage|echo|tyent|life|harvia|auroom)\s+/i,
      ""
    )
    .replace(/\s+(low emf|far ir|infrared|sauna|cold plunge|red light|therapy)\s*$/i, "")
    .trim();
  const words = cleaned.split(/\s+/).slice(0, 3);
  return words.join(" ") || title.split(/\s+/).slice(0, 2).join(" ");
}

function formatPrice(price: string): string | null {
  const n = parseFloat(price);
  if (isNaN(n) || n <= 0) return null;
  return n % 1 === 0
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Point every card for `fromHandle` at a different product.
 *
 * Edits the fields inside the existing card block rather than rebuilding it, so
 * the badge, border colour, grid position and surrounding markup are untouched.
 * That matters because the badge encodes price rank within the article and
 * regenerating it would reshuffle the whole section.
 *
 * Handles both fault types the audit turned up: a genuinely discontinued
 * product, and a card whose href was never a valid handle because bullet text
 * or description prose got written into it.
 *
 * Returns null when no card matched, so callers can skip the write.
 */
export function swapCardProduct(
  html: string,
  fromHandle: string,
  product: SwapProduct,
  serviceBullet: string | null = SERVICE_BULLET
): CardSwap | null {
  if (!html || !fromHandle || !product?.handle) return null;

  const cards = parseCards(html);
  let cardsSwapped = 0;
  let out = html;

  // Back to front so earlier offsets stay valid.
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i];
    if (card.handle !== fromHandle) continue;

    let chunk = out.slice(card.cardStart, card.cardEnd);

    // Product URL. Match any /products/<anything> inside this card, which is
    // what makes the malformed-href case work.
    chunk = chunk.replace(
      /(href=")([^"]*?)\/products\/[^"]*(")/gi,
      (_m, pre, prefix, post) => `${pre}${prefix}/products/${product.handle}${post}`
    );

    // Title. Function replacers throughout: a product title or price can
    // contain "$", and in a string replacement "$1,899" is parsed as capture
    // group 1 followed by ",899", which duplicated the price element and ate
    // the digit. Never build a replacement string from untrusted content.
    chunk = chunk.replace(
      /<h3([^>]*)>[\s\S]*?<\/h3>/i,
      (_m, attrs: string) => `<h3${attrs}>${product.title}</h3>`
    );

    // Image
    if (product.imageUrl) {
      const img = product.imageUrl;
      chunk = chunk
        .replace(/(<img[^>]*\bsrc=")[^"]*(")/i, (_m, pre: string, post: string) => `${pre}${img}${post}`)
        .replace(
          /(<img[^>]*\balt=")[^"]*(")/i,
          (_m, pre: string, post: string) => `${pre}${product.title}${post}`
        );
    }

    // Price. Remove the element entirely when the new product has none, rather
    // than leaving the old product's price sitting under a new title.
    const formatted = product.price ? formatPrice(product.price) : null;
    const priceRe = /<p style="font-weight:800;[^"]*">\$[^<]*<\/p>\s*/i;
    if (formatted) {
      chunk = chunk.replace(
        /(<p style="font-weight:800;[^"]*">)\$[^<]*(<\/p>)/i,
        (_m, pre: string, post: string) => `${pre}$${formatted}${post}`
      );
    } else {
      chunk = chunk.replace(priceRe, "");
    }

    // Bullets
    if (product.bullets && product.bullets.length) {
      const glyph = card.glyph;
      const specs = product.bullets.slice(0, serviceBullet ? 3 : 4);
      const next = serviceBullet ? [...specs, serviceBullet] : specs;
      const seen = new Set<string>();
      const unique = next.filter((l) => {
        const k = normalizeLabel(l);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const lis = unique
        .map((l, j) =>
          j === 0 ? `<li>${glyph} <strong>${l}</strong></li>` : `<li>${glyph} ${l}</li>`
        )
        .join("\n");
      chunk = chunk.replace(/<ul[^>]*>[\s\S]*?<\/ul>/i, `<ul>\n${lis}\n</ul>`);
    }

    // CTA label
    chunk = chunk.replace(
      /(<a[^>]*class="[^"]*\bgtd-cta\b[^"]*"[^>]*>)[\s\S]*?(<\/a>)/i,
      (_m, pre: string, post: string) => `${pre}View ${shortName(product.title)}${post}`
    );

    out = out.slice(0, card.cardStart) + chunk + out.slice(card.cardEnd);
    cardsSwapped++;
  }

  if (cardsSwapped === 0) return null;
  return { fixed: out, cardsSwapped };
}
