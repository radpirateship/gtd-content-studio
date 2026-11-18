// ============================================================================
// lib/article-v2.ts — template_version 2 article emitter.
//
// Everything here emits the ppwb- namespace defined in the ppw-blog.css theme
// asset. Version 1 (lib/ppw-template.ts + the old ppw- markup) is frozen and
// still serves every existing article; the two coexist and never share a class
// name. See docs: PPW-Blog-Phase0-Implementation-Spec.
//
// The only deliberate reuse is .faq-modern, which comes from
// ppw-collections.css and is not redefined in ppw-blog.css.
//
// House rules baked in here rather than left to the model:
//   - no citations block at the foot; citations go inline
//   - no reviewer or credential claims; provenance line instead
//   - no "free shipping" / "white-glove"; see UNSUPPORTED_CLAIMS
//   - no emoji in the article body
// ============================================================================

import { AUTHORS, authorForArticle, type Author } from "./authors";

export const V2_MARKER = "ppwb-article";

/** True when the HTML is version 2 markup. Content-sniffed, so no DB column. */
export function isV2ArticleHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  return /class=["'][^"']*ppwb-/i.test(html);
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const fmtDate = (d: Date) =>
  `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getFullYear()}`;

// ── HEADER ──────────────────────────────────────────────────────────────────

export function buildV2Header(o: {
  title: string;
  deck: string;
  kicker: string;
  hubLabel?: string;
  hubUrl?: string;
  readTime: number;
  author: Author;
  publishedAt?: Date;
}): string {
  const d = o.publishedAt ?? new Date();
  const crumb = o.hubLabel
    ? `<a href="/">Home</a><span>›</span><a href="/blogs/wellness">Wellness</a><span>›</span><a href="${esc(o.hubUrl || "/blogs/wellness")}">${esc(o.hubLabel)}</a>`
    : `<a href="/">Home</a><span>›</span><a href="/blogs/wellness">Wellness</a>`;

  return `<header class="ppwb-head">
<nav class="ppwb-crumb" aria-label="Breadcrumb">${crumb}</nav>
<div class="ppwb-kicker">${esc(o.kicker)}</div>
<h1 class="ppwb-h1">${esc(o.title)}</h1>
<p class="ppwb-deck">${esc(o.deck)}</p>
<div class="ppwb-meta">
<span>By <strong>${esc(o.author.name)}</strong></span>
<i class="ppwb-meta-dot"></i>
<span>${o.readTime} min read</span>
<i class="ppwb-meta-dot"></i>
<span>Published ${fmtDate(d)}</span>
</div>
</header>`;
}

// ── ANSWER BOX, the signature block ─────────────────────────────────────────

export function buildV2Answer(text: string, source?: string): string {
  if (!text?.trim()) return "";
  return `<section class="ppwb-answer">
<span class="ppwb-answer-label">The short answer</span>
<p class="ppwb-answer-text">${text.trim()}</p>${
    source?.trim() ? `\n<p class="ppwb-answer-src">${source.trim()}</p>` : ""
  }
</section>`;
}

// ── KEY TAKEAWAYS ───────────────────────────────────────────────────────────

/**
 * Words that describe the SLOT rather than the subject. A label built only from
 * these is a placeholder that leaked through, e.g. "Short bold lead" or
 * "Credibility signal". A blocklist of exact phrases does not hold, because the
 * model invents new ones, so match on the vocabulary instead.
 */
const META_LABEL_WORDS = new Set([
  "key", "keyword", "main", "point", "takeaway", "takeaways", "lead", "bold", "short",
  "mechanism", "context", "framing", "frame", "hook", "credibility", "signal",
  "research", "snapshot", "caveat", "summary", "overview", "anchor", "intro",
  "explained", "practical", "honest", "important", "note", "insight", "detail",
  "background", "the", "a", "an", "and", "of", "for", "to", "on", "in",
]);

function isMetaLabel(label: string): boolean {
  const words = label.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  // Any digit means it is naming something concrete.
  if (/\d/.test(label)) return false;
  return words.every((w) => META_LABEL_WORDS.has(w));
}

/** Fall back to the opening clause of the sentence, which is always on-topic. */
/**
 * Is every word of the label actually present in its own sentence?
 *
 * The spec used to list good labels as examples, and the model copied one
 * verbatim onto unrelated content: a bullet about heart conditions and
 * Raynaud's disease was labelled "Blackout risk", a phrase lifted from a
 * breathwork article where it belonged. The label sounded concrete, which is
 * exactly why the meta-label check let it through.
 *
 * Generic connectives are ignored, and a trailing s is stripped so "risks" in
 * the text supports "risk" in the label.
 */
const LABEL_FILLER = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "at", "by",
  "your", "you", "is", "are", "be", "with", "from", "per", "vs", "versus",
]);

function labelSupported(label: string, text: string): boolean {
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
  const hay = new Set(text.split(/\s+/).map(norm).filter(Boolean));
  const lowerText = text.toLowerCase();
  const words = label.split(/\s+/).map(norm).filter((w) => w && !LABEL_FILLER.has(w));
  if (!words.length) return false;
  const supported = words.filter((w) => hay.has(w) || lowerText.includes(w));
  // A label is allowed to restate. "Pressure ceiling" beside "1.3 ATA is the
  // ceiling" is a good label with one word the sentence never uses. Requiring
  // every word to appear rejected most real labels and sent them to the
  // fallback, which produced "The Space60 operates at a:". Half the content
  // words, or any figure, is the bar; what this still catches is a label lifted
  // from somewhere else entirely, where nothing matches.
  if (/\d/.test(label) && supported.some((w) => /\d/.test(w))) return true;
  return supported.length * 2 >= words.length;
}

/**
 * Last resort when the model's label cannot be trusted. Prefer a figure from
 * the sentence ("1.3 ATA", "60 to 90 minutes", "210 cm"), since a number is
 * always a concrete label. Otherwise return an empty string and the bullet
 * renders without a bold lead, which reads better than a chopped clause.
 */
function labelFromText(text: string): string {
  const figure = text.match(
    /\b\d[\d,.]*(?:\s*(?:to|-|–)\s*\d[\d,.]*)?\s*(?:%|°[FC]?|ATA|PSI|kg|lb|lbs|cm|mm|in|inches|ft|feet|minutes?|min|hours?|seconds?|watts?|W|kW|nm|gallons?|liters?|litres?|L|person|people|sessions?|bands?|years?|months?|weeks?|days?)\b/i,
  );
  if (figure) return figure[0].replace(/\s+/g, " ").trim();
  return "";
}

export function buildV2Takeaways(items: { label: string; text: string }[]): string {
  if (!items?.length) return "";
  const li = items.slice(0, 6).map(
    (t) => {
      // Two ways a label goes wrong: it describes the bullet's ROLE rather than
      // its content, or it names something the sentence never says. Both are
      // repaired from the sentence itself.
      const raw = t.label || "";
      const body = t.text || "";
      const label = !raw || isMetaLabel(raw) || !labelSupported(raw, body)
        ? labelFromText(body)
        : raw;
      return label
        ? `<li class="ppwb-glance-item"><strong>${esc(label)}:</strong> ${esc(t.text)}</li>`
        : `<li class="ppwb-glance-item">${esc(t.text)}</li>`;
    },
  ).join("\n");
  return `<section class="ppwb-glance">
<div class="ppwb-glance-label">Key takeaways</div>
<ul class="ppwb-glance-list">
${li}
</ul>
</section>`;
}

// ── TABLE OF CONTENTS ───────────────────────────────────────────────────────

/**
 * Jump links. Two columns on desktop, a collapsed accordion on mobile.
 *
 * The old version was a row of pills capped at 6, which meant an 11-section
 * article advertised five of them and a reader scanning the nav thought the
 * piece ended at section five. Each pill was ~40px tall, so the cap existed to
 * stop the nav swallowing the top of the page. Plain text links in two columns
 * hold all 11 in less height than six pills took, so the cap is gone.
 *
 * The ceiling that remains is a runaway guard, not an editorial limit.
 */
export const TOC_MAX = 14;

/**
 * Longest nav label that stays on one line, measured in headless Chromium at the
 * real 720px article measure with Poppins 500 14px: each column item is 321px and
 * fits 40 characters. Wrapping breaks at word boundaries and capitals run wider
 * than the lowercase test string, so labels are written to 34 and the CSS clamps
 * anything longer to two lines.
 */
export const TOC_LABEL_TARGET = 34;
/** Measured one-line ceiling for lowercase text at 321px. */
const TOC_LABEL_ONE_LINE = 38;

/**
 * Shorten a full heading into a nav label, for when the model did not supply a
 * data-nav attribute.
 *
 * It cuts at a colon and nowhere else. Most PPW headings carry a natural short
 * form there: "Temperature Reliability: The Biggest Gap Between the Two" gives
 * "Temperature Reliability". Word-count truncation was tried and rejected, since
 * it produced "Where Cold Showers Actually Hold" and "Which One Is Actually
 * Worth Your" — chopping mid-phrase to save a line reads worse than the second
 * line, and the second line is allowed by design. Anything with no colon is
 * passed through whole and the CSS clamp holds it to two lines.
 */
export function navLabelFrom(heading: string): string {
  const clean = heading.replace(/\s+/g, " ").trim();
  if (clean.length <= TOC_LABEL_ONE_LINE) return clean;

  const beforeColon = clean.split(/[:\u2013]/)[0].trim();
  // Guard against a colon so early the label says nothing ("Q&A: ...").
  if (beforeColon && beforeColon !== clean && beforeColon.length >= 12) return beforeColon;

  return clean;
}

export function buildV2Toc(items: { id: string; text: string; navLabel?: string }[]): string {
  if (!items.length) return "";
  // Below three entries it is noise rather than navigation.
  if (items.length < 3) return "";
  const trimmed = items.slice(0, TOC_MAX);
  const li = trimmed
    .map((i) => {
      const label = (i.navLabel?.trim() || navLabelFrom(i.text));
      return `<li><a class="ppwb-toc-link" href="#${esc(i.id)}">${esc(label)}</a></li>`;
    })
    .join("\n");
  // The toggle is a checkbox rather than <details> because a closed <details>
  // cannot be forced open by CSS at a breakpoint: Chromium hides the content via
  // the UA stylesheet and display:block !important does not override it, so the
  // nav would stay collapsed on desktop. Verified in headless Chromium at 360
  // and 1200px. The input is visually hidden but focusable, so the control stays
  // keyboard operable, and no script travels inside body_html.
  return `<nav class="ppwb-toc" aria-label="In this article">
<input class="ppwb-toc-tgl" type="checkbox" id="ppwb-toc-tgl">
<label class="ppwb-toc-label" for="ppwb-toc-tgl">In this article<span class="ppwb-toc-chev" aria-hidden="true">&#9662;</span></label>
<ol class="ppwb-toc-list">
${li}
</ol>
</nav>`;
}

// ── PRODUCT PICKS ───────────────────────────────────────────────────────────

type V2Product = {
  title: string;
  price?: string;
  imageUrl?: string;
  url?: string;
  handle?: string;
  vendor?: string;
  tags?: string;
  description?: string;
};

function money(p?: string): string {
  if (!p) return "";
  const n = parseFloat(p);
  if (isNaN(n) || n <= 0) return "";
  return "$" + (n % 1 === 0 ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

// Product badges were removed Aug 2026. They were a Naked Nutrition carryover
// (the flavour-badge slot, repurposed) and the labels tracked nothing real: a
// $3,597 tub read "Top pick" while a $11,649 one read "Commercial grade" and a
// $4,999 one read "Great starting point". The vendor line below carries the
// actual brand instead, which is true by construction.

/**
 * Shopify product titles carry merchandising suffixes that read as noise in an
 * editorial card: "Dynamic Cold Plunge Therapy \"CUBOID\" 316 Plastic Cold Plunge
 * | Chiller Not Included - Sold Separate | DCT-S-050-PL-34".
 *
 * The SKU segment is dropped. The buying caveat ("Chiller Not Included") is kept,
 * because a reader clicking through to a tub that needs a separate chiller should
 * learn that on the card rather than at checkout.
 */
const SKU_SEGMENT = /^[A-Z0-9]{2,}(?:-[A-Z0-9]{1,6}){2,}$/;

export function cleanProductTitle(title: string): string {
  return (title || "")
    .split("|")
    .map((seg) => seg.replace(/\s+/g, " ").trim())
    .filter((seg) => seg && !SKU_SEGMENT.test(seg))
    .join(" | ")
    .replace(/\s*[-–|,]\s*$/, "")
    .trim();
}

export function buildV2Picks(
  products: V2Product[],
  specsFor: (p: V2Product) => string[],
  heading: string,
  opts?: { anchor?: string },
): string {
  if (!products?.length) return "";
  const cards = products.map((p) => {
    const url = p.handle ? `/products/${p.handle}` : p.url || "#";
    const img = p.imageUrl
      ? `<div class="ppwb-pick-img"><img src="${esc(p.imageUrl)}" alt="${esc(cleanProductTitle(p.title))}" /></div>`
      : `<div class="ppwb-pick-img" data-ppwb-state="empty" data-ppwb-fallback="${esc([p.vendor, p.title].filter(Boolean).join(" · "))}"></div>`;
    const specs = specsFor(p).slice(0, 3).map((s) => `<span>${esc(s)}</span>`).join("");
    const price = money(p.price);
    return `<a class="ppwb-pick" href="${esc(url)}">
${img}
<div class="ppwb-pick-body">${p.vendor ? `\n<div class="ppwb-pick-vendor">${esc(p.vendor)}</div>` : ""}
<h3 class="ppwb-pick-title">${esc(cleanProductTitle(p.title))}</h3>
<div class="ppwb-pick-specs">${specs}</div>${price ? `\n<div class="ppwb-pick-price">${price}</div>` : ""}
<div class="ppwb-pick-cta">View model ›</div>
</div>
</a>`;
  }).join("\n");

  return `<h2 class="ppwb-h2" id="${esc(opts?.anchor ?? "picks")}">${esc(heading)}</h2>
<div class="ppwb-picks">
${cards}
</div>`;
}

// ── GUIDE LINK ──────────────────────────────────────────────────────────────

export function buildV2GuideLink(guide?: { title: string; url: string } | null): string {
  if (!guide?.url) return "";
  return `<a class="ppwb-guide" href="${esc(guide.url)}">
<div>
<div class="ppwb-guide-label">Go deeper</div>
<div class="ppwb-guide-title">${esc(guide.title)}</div>
</div>
<div class="ppwb-guide-go">Read the guide ›</div>
</a>`;
}

// ── FAQ, .faq-modern reused from ppw-collections.css ────────────────────────

export function buildV2Faq(items: { q: string; a: string }[]): string {
  if (!items?.length) return "";
  const rows = items.map((f, i) =>
    `<div class="item"><details${i === 0 ? " open" : ""}><summary>${esc(f.q)}<span class="chev">▾</span></summary><div class="body"><p>${f.a}</p></div></details></div>`
  ).join("\n");
  return `<h2 class="ppwb-h2" id="faq">Frequently asked questions</h2>
<div class="faq-modern ppwb-faq">
${rows}
</div>`;
}

// ── SHOP CTA ────────────────────────────────────────────────────────────────

/**
 * Trust strip. Approved claims only. "Free shipping" is banned outright
 * (conditional on product class); "white-glove delivery" is not offered.
 * HSA/FSA is real but eligibility varies, so it is opt-in per collection.
 */
const HSA_ELIGIBLE_HUBS = new Set(["clinical", "recovery"]);

export function buildV2ShopCta(o: {
  kicker: string;
  collectionSlug: string;
  collectionLabel: string;
  hub?: string;
}): string {
  const trust = [
    "Authorized dealer",
    HSA_ELIGIBLE_HUBS.has((o.hub || "").toLowerCase()) ? "HSA/FSA accepted" : null,
    "Expert US-based support",
  ].filter(Boolean).join(" · ");

  return `<section class="ppwb-shop">
<div class="ppwb-shop-label">${esc(o.kicker)}</div>
<h2 class="ppwb-shop-title">Shop ${esc(o.collectionLabel.toLowerCase())}</h2>
<p class="ppwb-shop-sub">Quality inspected before shipping, with expert US-based phone support before and after purchase.</p>
<div class="ppwb-shop-row">
<a class="ppwb-btn" href="/collections/${esc(o.collectionSlug)}">Shop ${esc(o.collectionLabel.toLowerCase())} ›</a>
<a class="ppwb-btn ppwb-btn-ghost" href="/pages/contact">Talk to an expert ›</a>
</div>
<div class="ppwb-shop-trust">${trust}</div>
</section>`;
}

// ── AUTHOR + PROVENANCE ─────────────────────────────────────────────────────

export function buildV2Author(author: Author, verifiedAt?: Date): string {
  const d = verifiedAt ?? new Date();
  const role = author.role?.trim()
    ? `\n<p class="ppwb-author-cred">${esc(author.role)}</p>`
    : "";
  return `<section class="ppwb-author">
<div class="ppwb-author-photo" data-ppwb-state="empty" aria-hidden="true">${esc(author.initials)}</div>
<div>
<p class="ppwb-author-name">${esc(author.name)}</p>${role}
<p class="ppwb-author-bio">${esc(author.bio)}</p>
<p class="ppwb-review">Specifications drawn from manufacturer documentation. Prices and availability checked ${fmtDate(d)}.</p>
</div>
</section>`;
}

// ── RELATED ─────────────────────────────────────────────────────────────────

export function buildV2Related(
  articles: { title: string; url: string; description?: string; hub?: string; readTime?: number }[],
): string {
  if (!articles?.length) return "";
  const tiles = articles.slice(0, 3).map((a) =>
    `<a class="ppwb-tile" href="${esc(a.url)}">${a.hub ? `\n<div class="ppwb-tile-hub">${esc(a.hub)}</div>` : ""}
<div class="ppwb-tile-title">${esc(a.title)}</div>${a.readTime ? `\n<div class="ppwb-tile-meta">${a.readTime} min read</div>` : ""}
</a>`
  ).join("\n");
  return `<section class="ppwb-related">
<h2 class="ppwb-h2" style="margin-top:0">Keep reading</h2>
<div class="ppwb-related-grid">
${tiles}
</div>
</section>`;
}

// ── DOCUMENT SHELL ──────────────────────────────────────────────────────────

/**
 * The whole article. No <style> block: ppw-blog.css is a theme asset. No
 * ppw-wrap div either, .ppwb-article is the single wrapper and its grid places
 * children on the 720px column.
 */
export function buildV2Document(parts: string[]): string {
  // No itemscope/itemtype here. Verified on a live published article: the theme
  // already emits two Article blocks in <head> as JSON-LD (one 27KB with the full
  // articleBody, one inside a BreadcrumbList graph). Our microdata added a third
  // Article declaration carrying zero itemprops, which is noise at best.
  // The FAQPage JSON-LD is a different matter and stays: the theme emits none,
  // so ours is the only one on the page.
  return `<article class="ppwb-article">

${parts.filter((p) => p && p.trim()).join("\n\n")}

</article>`;
}

export function pickAuthor(hub: string | null | undefined, slug: string, articleType?: string | null): Author {
  return authorForArticle(hub, slug, [], articleType);
}

export { AUTHORS };

// ── PROMPT SPECS ────────────────────────────────────────────────────────────
// The model writes body sections only. Header, TOC, picks, guide link, FAQ,
// CTA, author and related are all built deterministically above.

export const V2_BODY_SPEC = `
OUTPUT FORMAT — use the PPW blog classes below. They are defined in the theme.
Do NOT use inline styles. Do NOT use markdown (**, __, ##). HTML tags only.

STRUCTURE:
1. Start directly with body sections. Do NOT output <style>, <article>, <h1>,
   a table of contents, a key-takeaways box, an FAQ, a shop CTA, an author box
   or a related-articles list. All of those are assembled separately.
2. Every section is:
   <h2 class="ppwb-h2" id="kebab-case-id" data-nav="Short nav label">Section Title</h2>
   <p class="ppwb-p">...</p>

   data-nav is the label that appears in the jump nav at the top of the article.
   Write the full, specific heading as the heading text, then a SHORT form in
   data-nav: 34 characters or fewer, sentence case, no trailing punctuation.
   It must still name the section, not describe it. The usual move is to keep
   the part of the heading before the colon, or to compress the question.
     Section Title: "Heat-Up Time: What Actually Determines It"
     data-nav:      "Heat-up time"
     Section Title: "The Core Question: Does a Home Unit Match a Commercial One?"
     data-nav:      "Home versus commercial units"
   The nav is two narrow columns. Over 40 characters a label wraps to a second
   line, and past two lines it is cut off, so keep them tight.
3. Sub-headings: <h3 class="ppwb-h3">Title</h3>
4. Lists: <ul class="ppwb-ul"><li class="ppwb-li">...</li></ul>
5. Lead paragraph directly under an h2 may use <p class="ppwb-lead">.

OPTIONAL BLOCKS — use only where they genuinely help, at most one of each:
  Callout (tip, or a warning with the -warn variant):
    <aside class="ppwb-call"><span class="ppwb-call-label">Pro tip</span><p>...</p></aside>
    <aside class="ppwb-call ppwb-call-warn"><span class="ppwb-call-label">Before you start</span><p>...</p></aside>
  Numbered steps, for how-to content:
    <ol class="ppwb-steps">
    <li class="ppwb-step"><div><h3 class="ppwb-step-title">Step title</h3><p class="ppwb-step-body">...</p></div></li>
    </ol>
  Spec strip, three short data facts:
    <div class="ppwb-specs">
    <div class="ppwb-spec"><div class="ppwb-spec-num">1.3–1.5</div><div class="ppwb-spec-label">ATA</div><p class="ppwb-spec-note">...</p></div>
    </div>
  Comparison table. SIX product rows maximum, four to six is the target. A
  longer table is trimmed to six automatically, so writing more only means
  losing the ones you put last. Name each model exactly as the product data
  spells it, no abbreviations, so the row can be linked to the product.
  EVERY cell except the first in a row needs data-ppwb-col, which drives the
  mobile card layout:
    <div class="ppwb-cmp-wrap"><table class="ppwb-cmp">
    <thead><tr><th>Model</th><th>Heat-up</th><th>Price</th></tr></thead>
    <tbody>
    <tr><td class="ppwb-cmp-model">Name</td><td data-ppwb-col="Heat-up">35 min</td><td data-ppwb-col="Price">$5,990</td></tr>
    </tbody>
    </table></div>
  Pull quote. ONLY for a real quotation from a named, identifiable source you
  are confident exists. If you do not have one, omit this block entirely. Never
  invent an attribution, and never attribute to a body of literature, a field,
  or "synthesized from" anything. A restatement of your own prose in a box is
  not a quote:
    <blockquote class="ppwb-quote"><p class="ppwb-quote-text">...</p><cite class="ppwb-quote-by">Name, role or publication</cite></blockquote>

LINKING — a budget, not a suggestion. Count them before you finish.

  Every link in body prose uses class="ppwb-a", e.g.
    <a class="ppwb-a" href="/blogs/wellness/slug">descriptive anchor text</a>.
    Use ROOT-RELATIVE paths for anything on peakprimalwellness.com. Never paste
    the full https://peakprimalwellness.com/... URL.

  INTERNAL PPW LINKS: 4 to 6, and every href COPIED CHARACTER FOR CHARACTER from
    the LINK INVENTORY printed below. That inventory is the site's real published
    URL list, pulled from the database for this article's topic cluster.
    You cannot guess a slug and you must not try. Do not shorten an inventory URL,
    do not pluralise or depluralise it, do not invent a sibling of it, do not
    "correct" it. Any href that is not in the inventory is deleted before this
    article is published, so writing one costs you a link and gains nothing.
    Every link goes to a DIFFERENT inventory entry. Linking the same entry twice
    spends the budget once.
    Spread them through the body, never two in the same paragraph.
    If the inventory holds fewer than 4 usable entries, write fewer links. Fewer
    real links is correct; a plausible-looking invented one is not.

    ANCHOR TEXT is where these go wrong most often.
    NEVER use the destination article's title as the anchor. The inventory prints
    titles so YOU can tell the entries apart, not so you can paste them into prose.
    Pick 2 to 5 words that were already going to be in your sentence.

    THE TEST: delete the <a> tags and read the sentence back. If it still says
    something useful about the TOPIC, the link is placed correctly. If it now
    reads as a sentence about an article, you have written a signpost, not a link.

    The examples below are from an article about ESPRESSO MACHINES, which PPW does
    not sell. They show the shape of the rule. Do not reuse the words.

      Wrong:
        "the guide to <a>best espresso grinders</a> covers the burr types worth
         considering for home use"
      Strip the tags and you are left with a sentence about a web page.

      Right:
        "A consistent grind removes that variable, though <a>how fine you
         actually need to go</a> depends on the basket and the roast"
      Strip the tags and the sentence still teaches something.

    Never "click here", "this article", "read more", or "the guide to".

    THE HARD CASE: linking a "Best X" guide.

    You do NOT have to avoid the topic words. Link the SUBJECT. What you must
    strip is the PACKAGING, the ranking and format words a headline carries but
    a sentence does not: best, top, ultimate, complete, definitive, options,
    guide, roundup, reviewed, and the year.

      Destination: "Best Espresso Grinders: Getting a Consistent Shot"
        Wrong:  "the best espresso grinders"
        Right:  "espresso grinders"
        Right:  "a grinder matched to your machine"

      Destination: "Best Time of Day to Roast at Home"
        Wrong:  "the best time of day to roast at home"
        Right:  "when you roast"
        Right:  "morning versus evening batches"

    The subject is correct. The headline is not. The word doing the damage is
    usually "best".

  COLLECTION links: exactly 2. Not 1. Not 3. Both copied from the COLLECTIONS
    block of the inventory, both inside a body PARAGRAPH, not in a callout, not
    in a heading, because prose is where they carry weight. They do NOT count
    toward the internal budget, and the shop button at the foot of the article
    is not one of them.

    The first entry in the inventory is this article's own category. Link it once,
    where a reader would naturally start browsing.

    The SECOND must be a different collection, and it must be one a reader of THIS
    article would plausibly cross-shop. The inventory is ranked, so the entries
    nearest the top are the strongest candidates. Ask what else this person is
    likely to buy, and place the link where that comes up in the argument. Do not
    reach for a generic collection and bolt a sentence onto the end of the
    article to justify it. If the second link needs a sentence invented to hold
    it, you have picked the wrong collection.

  EXTERNAL LINKS: none. Zero. Not to PubMed, not to NIH, not to a journal, not
    to a professional body, not to anything off peakprimalwellness.com.
    You cannot verify a DOI, a PMID or a URL you have not fetched, and a citation
    that points at the wrong study is worse than no citation. Every outbound href
    is stripped before publication.

  EVIDENCE WITHOUT LINKS: state the specific finding or mechanism plainly, at
    its real level of certainty ("water above 96°C pulls more bitter compounds
    out of the grounds", not "research shows temperature matters"). Never
    attribute to an unnamed body of work: no "research shows", "studies have
    documented", "experts agree", "science confirms". If you cannot state the
    finding specifically, leave it out. Health effects keep cautious wording
    (may, is associated with) and are never upgraded into promises. Never write
    a bare number you cannot support from the material you were given.

  Citations go INLINE, as prose on the claim they support. Never a references
  or sources list at the end of the article.

NEVER USE OUR TRADE VOCABULARY. You are writing for a reader shopping for this
  equipment, not for a search marketer. These words must not appear anywhere in
  the article: PAA, People Also Ask, SERP, E-E-A-T, LSI, featured snippet,
  search intent, primary keyword, target keyword, long-tail, meta description,
  anchor text, keyword density. Answer the question; never name the mechanism
  that made you ask it.

NEVER REFER TO YOUR SOURCES AS SOURCES. The reader does not know about "the
  product listing", "the product data", "the catalogue", "the specifications
  provided" or "the research above", and must never hear of them. When a fact is
  not available, attribute the gap to the manufacturer: "OxyRevo does not publish
  a power-draw figure", "the manufacturer does not state a maintenance interval",
  or simply leave it out. Write as the dealer who handles the equipment, not as
  someone reading a brief.

BRANDS: name only what PPW sells.
  The product data you were given lists the real brands. Those, plus brands named
  in the article brief, are the only ones you may mention by name.
  Do NOT reach for the brands in this category you have seen most often online.
  They are competitors, PPW does not stock them, and naming one turns a PPW
  article into an advertisement for someone else. Never write "brands like X, Y
  or Z". If you want to talk about price or quality tiers, describe the tier
  ("an entry-level model", "a commercial-grade unit"), never a brand you cannot
  see in the product data.

HARD RULES:
- No <img> tags and no image placeholders. Images are added in a later step.
- No emoji anywhere in the body.
- No FAQ, no "Frequently Asked Questions" heading, no <details> elements.
- A comparison table must never be the last thing. Follow it with prose.
- Do not claim years of experience, certifications, licences, medical review,
  "clinically proven", "doctor recommended" or in-house experts. None are
  evidenced. PPW is an authorized dealer that sells and ships this equipment.
- Never write "free shipping" (conditional on product class) or "white-glove
  delivery" / "assembly included" (not offered).
`;

export const V2_FAQ_SPEC = `Your reply is inserted into the page verbatim: no planning, no thinking aloud, no <thinking> tags.
Return ONLY a JSON array, no prose, no markdown fence:
[{"q":"Question?","a":"Answer, 2 to 3 sentences, specific and useful."}]
JSON RULES: no double-quote characters inside any string. Write inches as the
word "inches" or use the unit in, never the " symbol. No line breaks inside a
string. Escape nothing; simply avoid the characters.
Exactly 8 questions covering different angles: suitability, safety, cost,
setup, running cost, maintenance, sizing, common mistakes. No emoji. No
markdown. Plain sentences.

NO LINKS in FAQ answers. Not internal, not external. Plain text only.

Never mention "the product listing", "the product data" or "the specifications
provided". If a figure is not available, say the manufacturer does not publish
it, or leave it out.

NAME ONLY BRANDS PPW SELLS. The product data lists them. Never write "a brand
like X, Y or Z" using brands you have seen online; those are competitors and PPW
does not stock them. Describe the tier instead ("an entry-level model", "a
commercial-grade unit"). Never name a price range you cannot support from the
product data you were given, and never argue the reader out of the purchase.`;

export const V2_TAKEAWAYS_SPEC = `Your reply is inserted into the page verbatim: no planning, no thinking aloud, no <thinking> tags.
Return ONLY a JSON array, no prose, no markdown fence.
Shape: objects with "label" and "text". Exactly 5 items.

PURPOSE. The takeaways are the article in miniature for a reader who will not
read all of it. Each one should carry the conclusion of a different major
section, in the order the article makes them, so the five together outline
the whole piece: what decides the question, what it costs or takes, what the
common mistake is, what to do first. A reader who reads only these five
lines should walk away with the article's advice, not with a shopping list.

WHAT GOES IN. Decisions, ranges, rules of thumb and trade-offs, stated the
way the article states them: "Plan on a budget of X to Y for a two-person
setup", "Concrete floors need a mat before anything heavy goes down", "Ceiling
height rules out most racks below eight feet". Figures are welcome when they
are the article's figures (budget bands, sizes, durations, temperatures).

WHAT STAYS OUT. Do not name specific products, models or prices as a takeaway.
Featured products have their own cards; a takeaway that reads "The Prism
Fitness rack is 1,349 dollars" tells the reader nothing they can act on
without context. At most ONE takeaway may refer to the kind of product the
article recommends, described by type ("a folding rack", "a wood-burning
barrel"), never by brand and never with a price. No takeaway is an
advertisement.

"label" is 2 to 5 words naming the CONCRETE THING the point is about: a
number, a range, a rule, a constraint, a step. It must be SUPPORTED BY ITS OWN
SENTENCE: every word in it has to appear in, or obviously restate, the text
beside it.
  Examples below are from an article about ESPRESSO MACHINES, which PPW does
  not sell. They show the SHAPE of a good label. Do not reuse the words:
        "Budget 600 to 900" / "Nine bars, not fifteen" / "Descale every 200 shots"
  Bad, and never acceptable: any label that describes the ROLE of the bullet
  rather than its content ("key point", "main takeaway", "mechanism",
  "context", "summary", "overview", "caveat", or any pairing of those words).
  If your label would make sense on a different article, it is wrong.

"text" is one plain sentence, 15 to 30 words, written the way you would say
it to a friend who asked what the article concluded. It stands alone and does
not restate the label. No emoji, no markdown. No double-quote characters
inside any string: write inches as the word "inches", never the " symbol.`;

export const V2_ANSWER_SPEC = `Write the direct answer to the question this article title implies.
40 to 60 words, no preamble, first sentence answers it outright. Wrap the key
phrase in <strong>. No emoji, no markdown. Return only the sentence(s).
Your reply is inserted into the page verbatim: do not plan, think aloud, or
describe what you are about to write, and never use <thinking> or similar tags.
Example: "Equalize your ears <strong>before</strong> you feel pressure, not
after. Start swallowing as soon as pressurization begins, repeat every 15 to 30
seconds, and set the chamber to its slowest inflation rate."`;

// ── TOLERANT JSON ───────────────────────────────────────────────────────────
/**
 * The FAQ and takeaways come back as JSON, and the single most common way that
 * JSON is invalid is an inch mark inside a string: "7'3" interior" ends the
 * string early. Shipped once as an article with no FAQ at all. Parse strictly
 * first; on failure, escape any double quote that is not acting as a JSON
 * delimiter (a quote followed by something other than a comma, colon, brace or
 * bracket once whitespace is skipped) and try again.
 */
export function parseJsonArrayTolerant<T>(raw: string): T[] {
  const t = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const body = t.slice(t.indexOf("["), t.lastIndexOf("]") + 1);
  const attempt = (src: string): T[] | null => {
    try {
      const parsed = JSON.parse(src);
      return Array.isArray(parsed) ? (parsed as T[]) : null;
    } catch {
      return null;
    }
  };
  const strict = attempt(body);
  if (strict) return strict;

  // Repair pass: walk the text, tracking whether we are inside a string. A
  // quote that closes a string is legitimate only if the next non-space
  // character is one of , : } ]. Anything else is an inch mark or a stray
  // quote in prose; escape it and stay inside the string.
  let out = "";
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && inStr) { out += ch + (body[i + 1] ?? ""); i++; continue; }
    if (ch !== '"') { out += ch; continue; }
    if (!inStr) { inStr = true; out += ch; continue; }
    let j = i + 1;
    while (j < body.length && /\s/.test(body[j])) j++;
    const next = body[j] ?? "";
    if (next === "," || next === ":" || next === "}" || next === "]") { inStr = false; out += ch; }
    else out += '\\"';
  }
  const repaired = attempt(out);
  if (repaired) return repaired;

  // Last resort: pull q/a or label/text pairs out with a permissive regex.
  const pairs: T[] = [];
  const re = /"(q|label)"\s*:\s*"([\s\S]*?)"\s*,\s*"(a|text)"\s*:\s*"([\s\S]*?)"\s*\}/g;
  for (const m of out.matchAll(re)) {
    pairs.push({ [m[1]]: m[2].replace(/\\"/g, '"'), [m[3]]: m[4].replace(/\\"/g, '"') } as unknown as T);
  }
  return pairs;
}

// ── LINK AUDIT ──────────────────────────────────────────────────────────────
// A prompt rule is a request, not a guarantee. This counts what the model
// actually did so the numbers show up in the app instead of being eyeballed.

/**
 * Outbound domains that are actively harmful, not merely off-policy. All outbound
 * links are stripped now, but a competitor or marketplace link appearing at all
 * says something different about the run than a journal link does.
 */
const BLOCKED_EXTERNAL = [
  // competing retailers and marketplaces
  "amazon.", "walmart.", "wayfair.", "ebay.", "etsy.", "costco.", "homedepot.", "lowes.",
  "target.com", "recoveryforathletes.", "northernsaunas.", "saunahouse.", "thesaunaheater.",
  "sunhomesaunas.", "plungeworld.", "coldplunge.", "therapeuticsolutions.",
  // low-authority or user-generated
  "wikipedia.", "reddit.", "quora.", "youtube.", "youtu.be", "pinterest.", "medium.com",
  "facebook.", "instagram.", "tiktok.",
];

/**
 * Formerly the approved-citation list. PPW stopped linking off-site in Aug 2026,
 * so nothing here is allowed any more. Kept only to classify what got stripped:
 * a stray link to a journal is a different problem from a stray link to Amazon.
 */
const ALLOWED_EXTERNAL = [
  "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "nih.gov", "nlm.nih.gov",
  "who.int", "cdc.gov", "cochrane.org", "bmj.com", "nature.com", "sciencedirect.com",
  "springer.com", "wiley.com", "tandfonline.com", "jamanetwork.com", "nejm.org",
  "physiology.org", "acsm.org", "apta.org", "mayoclinic.org", "clevelandclinic.org",
  "frontiersin.org", "mdpi.com", "plos.org", "jospt.org", "ahajournals.org",
];

export type LinkAudit = {
  internal: number;
  collections: number;
  external: number;
  externalDomains: string[];
  blocked: string[];
  unrecognisedExternal: string[];
  warnings: string[];
  passed: boolean;
};

/**
 * Normalise an href to a comparison key: origin dropped, query and hash dropped,
 * trailing slash dropped, lowercased. /collections/Cold-Plunges/ and
 * https://peakprimalwellness.com/collections/cold-plunges?x=1 collapse to the same key.
 */
export function linkKey(href: string): string {
  let h = href.trim();
  h = h.replace(/^https?:\/\/(www\.)?peakprimalwellness\.com/i, "");
  h = h.split("#")[0].split("?")[0];
  h = h.replace(/\/+$/, "");
  return h.toLowerCase();
}

/**
 * The inventory the model was given, as comparison keys. Pass it to auditV2Links
 * and sealV2Links so an invented URL can be told apart from a supplied one.
 */
export function buildLinkInventory(
  articles: { url: string }[],
  collections: { url: string }[],
): Set<string> {
  return new Set([...articles, ...collections].map((x) => linkKey(x.url)));
}

/**
 * The inventory as the model sees it. Numbered so it can be referred to, and
 * printed as exact URLs so there is nothing to reconstruct.
 */
export function buildV2LinkBrief(
  articles: { title: string; url: string }[],
  collections: { title: string; url: string }[],
): string {
  if (!articles.length && !collections.length) {
    return `LINK INVENTORY — EMPTY.

No published URLs were supplied for this article. Write NO internal links and NO
collection links. Not one. Write the sentences that would carry them and leave
the phrases as plain text.`;
  }

  const a = articles.length
    ? articles.map((x, i) => `  A${i + 1}. ${x.url}\n        "${x.title}"`).join("\n")
    : "  (none supplied — write no internal article links)";
  const c = collections.length
    ? collections.map((x, i) => `  C${i + 1}. ${x.url}\n        "${x.title}"`).join("\n")
    : "  (none supplied — write no collection links)";

  return `LINK INVENTORY — the only URLs that exist. Copy them exactly.

ARTICLES (pick 4 to 6, each one different):
${a}

COLLECTIONS (pick exactly 2):
${c}

Any href you write that is not in this list will be stripped before publication.`;
}

/**
 * Deterministic repair. The prompt is a request; this is the guarantee.
 * Unwraps any internal or collection link whose href is not in the inventory,
 * keeping the anchor text as plain prose. Returns what it removed so the caller
 * can log it rather than discover it on the live site.
 */
/**
 * Collapse a repeated link. The model writes its own links from the inventory
 * and the add-links step later inserts links from the same inventory, so the
 * same URL can end up wrapped twice in one paragraph:
 *   "The overlap between <a>cold plunge and meditation</a> practices is covered
 *    in the <a>cold plunge and meditation</a> guide."
 * The first occurrence keeps the link, later ones become plain text.
 */
/**
 * Count the editorial links in a body of article HTML.
 *
 * The old counter was `/<a\s+href="[^"]*"\s+class="(?:ppw-links|ppwb-a)"/g`, which
 * demanded href BEFORE class. v2 bodies write `<a class="ppwb-a" href="...">`, so
 * the only links it ever matched were the href-first ones add-links inserted
 * itself. An article with eight real links reported one. Counting the raw <a>
 * tags in the whole document instead over-counts, because it picks up the
 * breadcrumb, the guide link, four product cards, the shop CTA and the related
 * tiles — that is where "11 when it said 8" came from.
 *
 * This counts anchors carrying an editorial link class, in any attribute order,
 * tolerant of extra classes, deduplicated by destination so one URL linked twice
 * counts once.
 */
export function countEditorialLinks(html: string): number {
  const anchors = html.match(
    /<a\b(?=[^>]*\bhref=)[^>]*\bclass=["'][^"']*\b(?:ppwb-a|ppw-links)\b[^"']*["'][^>]*>/gi,
  );
  if (!anchors) return 0;
  const seen = new Set<string>();
  for (const a of anchors) {
    const href = /\bhref=["']([^"']+)["']/i.exec(a)?.[1];
    if (href) seen.add(linkKey(href));
  }
  return seen.size;
}

export function dedupeV2Links(html: string): { html: string; collapsed: string[] } {
  const seen = new Set<string>();
  const collapsed: string[] = [];
  const out = html.replace(
    /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
    (whole, _pre, href: string, _post, text: string) => {
      const h = href.trim();
      if (h.startsWith("#") || h.startsWith("mailto:") || h.startsWith("tel:")) return whole;
      const key = linkKey(h);
      if (!seen.has(key)) { seen.add(key); return whole; }
      collapsed.push(h);
      return text;
    },
  );
  return { html: out, collapsed };
}

/**
 * Two anchors with nothing but whitespace between them render as one continuous
 * underlined run. A reader cannot tell where the first link ends and the second
 * begins, and the click target is ambiguous. Observed live:
 *   browsing <a>cold plunges</a> <a>built for year-round use</a> is a start
 * The first link wins because it is the earlier editorial choice and, in the
 * observed case, the collection link the article is required to carry. The
 * second is unwrapped to plain text; the sentence is untouched.
 */
export function splitAdjacentLinks(html: string): { html: string; unwrapped: string[] } {
  const unwrapped: string[] = [];
  // Only an INLINE editorial anchor is ever unwrapped. The first version
  // matched any <a> and, when run over an assembled article by apply-links,
  // unwrapped the second product card, the second related tile and the ghost
  // CTA button, because those block anchors sit beside each other with only
  // whitespace between them. A card with no <a> is a card nobody can click.
  const pair = /(<\/a>)((?:\s|&nbsp;|&#160;)*)<a\b(?=[^>]*\bclass=["'][^"']*\b(?:ppwb-a|ppw-links)\b)[^>]*href=(["'])([\s\S]*?)\3[^>]*>((?:(?!<\/a>)[^<]|<(?!\/a>)(?!div|section|h[1-6]|p\b|img))*?)<\/a>/gi;
  let out = html;
  // Loop: a run of three adjacent anchors needs two passes, since each pass
  // consumes the closing tag it matched on.
  for (let pass = 0; pass < 4; pass++) {
    let hit = false;
    out = out.replace(pair, (_whole, close: string, gap: string, _q, href: string, text: string) => {
      hit = true;
      unwrapped.push(href.trim());
      return `${close}${gap}${text}`;
    });
    if (!hit) break;
  }
  return { html: out, unwrapped };
}

/**
 * Exactly two collection links in the body. The model is told so and writes
 * three about one time in four. The first two distinct collection destinations
 * keep their links, in reading order; later ones become plain text. The
 * article's own collection is never among the ones dropped, because the
 * inventory lists it first and the model links it early.
 */
export function capCollectionLinks(html: string, max = 2): { html: string; unwrapped: string[] } {
  const seen = new Set<string>();
  const unwrapped: string[] = [];
  const out = html.replace(
    /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
    (whole, _pre, href: string, _post, text: string) => {
      const key = linkKey(href);
      if (!key.startsWith("/collections/")) return whole;
      if (seen.has(key)) return whole;            // dedupe handles repeats
      if (seen.size < max) { seen.add(key); return whole; }
      unwrapped.push(href);
      return text;
    },
  );
  return { html: out, unwrapped };
}

/**
 * The rule is exactly two collection links and the cap above only removes
 * extras. When the writer carries one, find the first plain prose mention of
 * another candidate collection's subject and link it there. Only whole-word
 * matches inside ppwb-p / ppwb-li blocks that hold no anchor yet, so the
 * added link never lands beside or inside an existing one. Pass candidates
 * in rank order.
 */
export function fillCollectionLinks(
  html: string,
  candidates: { title: string; url: string }[],
  target = 2,
): { html: string; added: string[] } {
  const added: string[] = [];
  const present = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const k = linkKey(m[1]);
    if (k.startsWith("/collections/")) present.add(k);
  }
  if (present.size >= target) return { html, added };

  const subjectOf = (title: string) =>
    title
      .replace(/\s*(\||:|\s-\s).*$/, "")
      .replace(/\bfor (every|all|any|your)\b.*$/i, "")
      .replace(/\b(shop|buy|collection|collections)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const singular = (w: string) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);

  let out = html;
  for (const c of candidates) {
    if (present.size >= target) break;
    const key = linkKey(c.url);
    if (!key.startsWith("/collections/") || present.has(key)) continue;
    const subject = subjectOf(c.title);
    if (subject.length < 5) continue;
    const words = subject.split(" ").filter(Boolean).map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean);
    if (!words.length) continue;
    const pattern = new RegExp(
      "\\b" + words.map((w) => singular(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:s|es)?").join("\\s+") + "\\b",
      "i",
    );
    let done = false;
    out = out.replace(
      /(<(p|li) class="ppwb-(?:p|li)"[^>]*>)([\s\S]*?)(<\/\2>)/gi,
      (whole, open: string, _tag: string, inner: string, close: string) => {
        if (done || /<a\b/i.test(inner)) return whole;
        const m = inner.match(pattern);
        if (!m || m.index === undefined) return whole;
        done = true;
        const before = inner.slice(0, m.index);
        const after = inner.slice(m.index + m[0].length);
        return `${open}${before}<a class="ppwb-a" href="${esc(c.url)}">${m[0]}</a>${after}${close}`;
      },
    );
    if (done) { present.add(key); added.push(`${subject} -> ${c.url}`); }
  }
  return { html: out, added };
}

/**
 * The products that will appear on the page, as the model sees them. Without
 * this the body was written blind: an article about the OxyRevo Space60 called
 * it a 1.3 ATA soft-shell that deflates for storage, while the card beside it
 * showed the Space60 Hard, a 2 ATA rigid chamber at $42,999.
 */
/** Shopify body HTML to readable text, keeping list structure so specs survive. */
function listingToText(html: string, cap: number): string {
  const t = (html || "")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return t.length > cap ? t.slice(0, cap).replace(/\s+\S*$/, "") + " [listing continues]" : t;
}

export function buildV2ProductBrief(
  products: { title?: string; vendor?: string; price?: string; description?: string; handle?: string; tags?: string | string[]; productType?: string }[],
): string {
  const rows = (products || []).filter((p) => p?.title).slice(0, 6).map((p, i) => {
    // The listing is the manufacturer's own copy, imported from the Matrixify
    // export. It is the richest source of truth this app has and the reason
    // the app exists, so it goes in nearly whole: 2,500 characters per product
    // keeps four products inside ~2,500 tokens.
    const desc = listingToText(p.description || "", 2500);
    const price = money(p.price);
    const tags = Array.isArray(p.tags) ? p.tags.join(", ") : (p.tags || "");
    return `  P${i + 1}. ${cleanProductTitle(p.title || "")}` +
      (p.vendor ? `\n      Brand: ${p.vendor}` : "") +
      (p.productType ? `\n      Type: ${p.productType}` : "") +
      (price ? `\n      Price: ${price}` : "") +
      (tags ? `\n      Tags: ${tags.slice(0, 200)}` : "") +
      (desc ? `\n      Listing:\n${desc.split("\n").map((l) => "        " + l).join("\n")}` : "");
  });
  if (!rows.length) {
    return `PRODUCT DATA: none supplied. Do not name a specific model, price or specification.
Write about the category in general terms.`;
  }
  return `PRODUCT DATA: the products that will appear on this page, with each one's listing
copied from the manufacturer's product page in PPW's catalogue.

This is the article's main advantage over anything else on the subject. Use it.
  - Specifications, dimensions, pressures, capacities, materials, heater and
    power figures, warranty terms and prices for these models come from here
    and ONLY here. Quote them precisely, with units.
  - Where a section would benefit from a concrete example, reach for one of
    these models and its real numbers rather than a generic statement.
  - If the title names one of these models, everything you say about it must
    agree with its listing. Where the listing is silent, say so or describe the
    category; never fill the gap from memory.
  - Brands named here are the brands PPW sells. Name no others.
  - Do not turn the article into a sales page. Details serve the reader's
    decision; the cards beside the article do the selling.
  - A product that does not fit the article's subject stays OUT of the prose.
    The cards show it regardless; you do not have to mention every product,
    and you must never bend a section to make one fit (a wrist sleeve has no
    place in a home gym equipment checklist).

${rows.join("\n\n")}`;
}

// ── CATALOGUE RESEARCH ──────────────────────────────────────────────────────
// The four featured products are not the point of product data. An article
// about sauna installation should be able to read every sauna listing PPW
// carries and pull out what the manufacturers actually say about electrical
// requirements, clearances, foundations and assembly. This scans a whole
// collection's listings for the passages that match the article's topic and
// hands them to the writer with the model and brand each one came from.
//
// Topic-agnostic by construction: the scoring vocabulary comes from the title
// and keyword, widened by a small stem map so "installation" also finds
// "install", "wiring", "breaker". Nothing here names a product category.

const TOPIC_STEMS: Record<string, string[]> = {
  install: ["install", "assembl", "setup", "set up", "wiring", "wire", "electric", "breaker", "amp", "volt", "120v", "240v", "110v", "220v", "circuit", "gfci", "outlet", "plug", "hardwire", "dedicated", "require", "clearance", "foundation", "base", "pad", "level", "ventilat", "vent", "drain", "plumb", "permit", "delivery", "crate", "lift", "tools", "electrician"],
  assembl: ["assembl", "install", "setup", "tools", "hours", "two people", "instructions"],
  electric: ["electric", "volt", "amp", "120v", "240v", "breaker", "circuit", "gfci", "hardwire", "plug", "outlet", "kw", "watt", "phase", "power", "require", "dedicated", "electrician"],
  size: ["size", "dimension", "width", "depth", "height", "length", "diameter", "footprint", "capacity", "person", "seat", "weight", "interior", "exterior", "clearance"],
  dimension: ["dimension", "width", "depth", "height", "length", "diameter", "footprint", "interior", "exterior"],
  cost: ["price", "cost", "warranty", "financ", "included", "includes"],
  maintain: ["maintain", "maintenance", "clean", "filter", "replace", "care", "drain", "descal", "service", "lubricat"],
  maintenance: ["maintenance", "maintain", "clean", "filter", "replace", "care", "drain", "service"],
  warrant: ["warrant", "guarantee", "coverage", "year", "lifetime", "parts", "labor"],
  heat: ["heat", "heater", "temperature", "degree", "°", "kw", "watt", "stove", "stone", "infrared", "emitter", "warm-up", "heat-up", "preheat"],
  safety: ["safety", "safe", "certif", "etl", "ul", "csa", "ce", "fda", "emf", "shut-off", "shutoff", "timer", "tempered", "contraindicat"],
  outdoor: ["outdoor", "weather", "rain", "snow", "uv", "roof", "shingle", "cover", "seal", "exterior", "climate"],
  indoor: ["indoor", "floor", "ceiling", "room", "ventilat", "moisture", "humidity"],
  benefit: ["benefit", "recovery", "relief", "circulation", "relax", "sleep", "inflammation", "therapy", "session"],
  compare: ["vs", "versus", "difference", "compared", "unlike", "whereas"],
  review: ["feature", "include", "built", "made", "construct", "material", "quality", "warranty"],
  wood: ["wood", "cedar", "hemlock", "spruce", "pine", "thermo", "aspen", "timber", "stave", "grain", "knot"],
  chiller: ["chiller", "cool", "temperature", "filtration", "ozone", "uv", "pump", "flow", "btu", "hp", "insulat"],
  pressure: ["ata", "psi", "pressure", "inflat", "compressor", "concentrator", "oxygen", "valve"],
  light: ["nm", "wavelength", "irradiance", "mw", "led", "red", "infrared", "panel", "coverage", "distance"],
  noise: ["noise", "db", "decibel", "quiet", "loud", "sound"],
  portable: ["portable", "fold", "wheel", "weight", "carry", "storage", "compact"],
};

function topicVocabulary(title: string, keyword: string, articleType?: string | null): string[] {
  const base = `${title} ${keyword} ${articleType || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9° ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !HEADLINE_WORDS.has(w) && !LABEL_FILLER.has(w));
  const out = new Set<string>(base);
  for (const w of base) {
    for (const stem of Object.keys(TOPIC_STEMS)) {
      if (w.startsWith(stem) || stem.startsWith(w)) TOPIC_STEMS[stem].forEach((t) => out.add(t));
    }
  }
  return Array.from(out);
}

/**
 * Passages from a collection's listings that bear on the article topic.
 *
 * Each listing is split into lines and sentences, each is scored by how many
 * topic terms it contains, and the best are returned with attribution. Lines
 * that are pure marketing ("experience the ultimate...") score zero on any
 * technical topic and fall away on their own. Capped by character budget so
 * the prompt stays bounded however large the collection is.
 */
export function buildV2CatalogueResearch(
  products: { title?: string; vendor?: string; description?: string; handle?: string }[],
  o: { title: string; keyword: string; articleType?: string | null; budgetChars?: number; featuredHandles?: Set<string> },
): { text: string; passages: number; productsScanned: number; productsUsed: number } {
  const vocab = topicVocabulary(o.title, o.keyword, o.articleType);
  const budget = o.budgetChars ?? 7000;
  type Hit = { score: number; line: string; product: string; vendor: string; handle: string };
  const hits: Hit[] = [];
  let scanned = 0;

  for (const p of products || []) {
    if (!p?.description || !p.title) continue;
    scanned++;
    const text = listingToText(p.description, 20000);
    const product = cleanProductTitle(p.title);
    const vendor = p.vendor || "";
    const lines = text
      .split(/\n|(?<=[.!?])\s+(?=[A-Z])/)
      .map((l) => l.replace(/^-\s*/, "").trim())
      .filter((l) => l.length >= 30 && l.length <= 400);
    for (const line of lines) {
      const lower = line.toLowerCase();
      let score = 0;
      for (const t of vocab) if (lower.includes(t)) score++;
      // Figures with units are what the writer needs most.
      if (/\d\s*(?:"|in\b|inch|ft|cm|mm|lb|kg|kw|w\b|v\b|volt|amp|°|ata|psi|nm|db|gal|l\b|hour|min|year)/i.test(lower)) score += 1;
      if (score >= 2) hits.push({ score, line, product, vendor, handle: p.handle || "" });
    }
  }

  // Best first; spread across products so one verbose listing does not take
  // the whole budget (max 5 passages per product, then the next best).
  hits.sort((a, b) => b.score - a.score || a.line.length - b.line.length);
  const perProduct = new Map<string, number>();
  const seenLine = new Set<string>();
  const chosen: Hit[] = [];
  let used = 0;
  for (const h of hits) {
    const key = h.line.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80);
    if (seenLine.has(key)) continue;
    const n = perProduct.get(h.product) || 0;
    if (n >= 5) continue;
    if (used + h.line.length + h.product.length + 12 > budget) break;
    seenLine.add(key);
    perProduct.set(h.product, n + 1);
    chosen.push(h);
    used += h.line.length + h.product.length + 12;
  }

  if (!chosen.length) {
    return { text: "", passages: 0, productsScanned: scanned, productsUsed: 0 };
  }

  // Group by product for readability.
  const byProduct = new Map<string, Hit[]>();
  for (const h of chosen) {
    if (!byProduct.has(h.product)) byProduct.set(h.product, []);
    byProduct.get(h.product)!.push(h);
  }
  const blocks = Array.from(byProduct.entries()).map(([product, hs]) => {
    const head = `${product}${hs[0].vendor ? ` (${hs[0].vendor})` : ""}`;
    return `  ${head}\n${hs.map((h) => `    - ${h.line}`).join("\n")}`;
  });

  const text = `CATALOGUE RESEARCH: what the manufacturers' own listings say about this topic,
gathered from ${byProduct.size} of the ${scanned} products PPW carries in this category.
This is the material that makes the article more useful than a generic one. Use it:
  - When the article makes a claim about how these products are built, installed,
    sized, powered, maintained or specified, ground it in a passage below and name
    the model, e.g. "the <model> calls for a dedicated 240V/40A circuit".
  - Where several models agree, say so as a pattern ("most of the traditional
    units here specify..."). Where they differ, say that too; the range is useful.
  - Do not copy a line verbatim into prose. Restate it in the article's voice.
  - Anything not supported here or in the PRODUCT DATA is general knowledge and
    must be phrased as such, never as a fact about a specific model.

${blocks.join("\n\n")}`;

  return { text, passages: chosen.length, productsScanned: scanned, productsUsed: byProduct.size };
}

// ── COMPARISON TABLE PRODUCT LINKS ──────────────────────────────────────────
/**
 * A comparison table that names products PPW sells should link to them, with a
 * thumbnail, the way the collection pages do. The model writes plain model
 * names in the first column; this matches each one against the products on the
 * page and in the collection pool, and rewrites the cell. Unmatched cells are
 * left as plain text, so a row about a generic alternative is unaffected.
 *
 * Matching: every significant word of the cell text must appear in the product
 * title (vendor words may be dropped from the cell, since the model often
 * writes "Arosa" for "Golden Designs Arosa"). Among candidates the shortest
 * title wins, which prefers the base model over a variant.
 */
/** Decode the handful of entities that appear in generated table cells. */
function decodeEntities(t: string): string {
  return (t || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-");
}

const SEAL_VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);

/**
 * Close any block the written body left open, at the end of the body.
 *
 * Why this exists, and why sealTruncatedBody does not cover it: that guard
 * compares TAG COUNTS. An article shipped with its fourth <li class="ppwb-step">
 * never closed, and still counted 23 <li> against 23 </li>, because the closers
 * turned up at the very end of the document. The counts balanced, the guard
 * passed, and every block appended after the body — FAQ, shop card, author,
 * keep reading — rendered INSIDE that open list item. On the page the FAQ
 * appeared to swallow the contact card.
 *
 * Counting is not nesting. This walks a real stack and closes what is actually
 * open, innermost first, so anything appended afterwards lands at article level.
 */
export function closeUnclosedBlocks(html: string): { html: string; closed: string[] } {
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ""))) {
    const [, closing, rawName, selfClose] = m;
    const name = rawName.toLowerCase();
    if (SEAL_VOID.has(name) || selfClose === "/") continue;
    if (!closing) {
      stack.push(name);
      continue;
    }
    if (stack[stack.length - 1] === name) { stack.pop(); continue; }
    const at = stack.lastIndexOf(name);
    if (at >= 0) stack.length = at;   // implicit close of everything above it
  }
  if (!stack.length) return { html, closed: [] };
  const closed = [...stack].reverse();
  return { html: `${html}${closed.map((t) => `</${t}>`).join("")}`, closed };
}

/**
 * Drop a comparison column whose cells are mostly "Not published".
 *
 * The writer is told to write "Not published" rather than invent a spec, which
 * is right. But a Resistance column reading "Not published" in five of six rows
 * is a column of noise: it costs horizontal space on mobile and tells the
 * reader nothing. If most of a column is unknown, the column goes.
 */
export function dropEmptyComparisonColumns(html: string, threshold = 0.6): { html: string; dropped: string[] } {
  const dropped: string[] = [];
  const out = (html || "").replace(/<table class="ppwb-cmp">([\s\S]*?)<\/table>/gi, (whole: string, inner: string) => {
    const headers = Array.from(inner.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m: RegExpMatchArray) => m[1].replace(/<[^>]+>/g, "").trim());
    const rows = Array.from(inner.matchAll(/<tr[\s\S]*?<\/tr>/gi)).map((m: RegExpMatchArray) => m[0]).filter((r: string) => /<td/i.test(r));
    if (headers.length < 3 || rows.length < 2) return whole;

    const unknown = (t: string) => /^(not published|n\/a|unknown|not specified|-|)$/i.test(String(t).replace(/<[^>]+>/g, "").trim());
    const kill = new Set<number>();
    for (let c = 1; c < headers.length; c++) {
      let miss = 0;
      for (const r of rows) {
        const cells = Array.from(r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((m: RegExpMatchArray) => m[1]);
        if (cells[c] === undefined || unknown(cells[c])) miss++;
      }
      if (miss / rows.length >= threshold) { kill.add(c); dropped.push(headers[c]); }
    }
    if (!kill.size) return whole;

    const stripCells = (chunk: string, tag: "th" | "td") => {
      let idx = -1;
      return chunk.replace(new RegExp("<" + tag + "[^>]*>[\\s\\S]*?<\\/" + tag + ">", "gi"), (cell: string) => {
        idx++;
        return kill.has(idx) ? "" : cell;
      });
    };
    const next = inner
      .replace(/<tr[\s\S]*?<\/tr>/gi, (r: string) => stripCells(r, /<th/i.test(r) ? "th" : "td"))
      .replace(/\n{2,}/g, "\n");
    return '<table class="ppwb-cmp">' + next + '</table>';
  });
  return { html: out, dropped };
}

/**
 * Hold a comparison table to `max` product rows. Ryan's rule: six.
 *
 * Rows that link to a product PPW carries are kept first, then the rest in
 * document order, so a trimmed table shows what is actually for sale rather
 * than whichever models the model happened to list first. Run this AFTER
 * linkComparisonTable so the linked rows are known.
 */
export function capComparisonRows(html: string, max = 6): { html: string; dropped: string[] } {
  const dropped: string[] = [];
  const out = (html || "").replace(/<tbody>([\s\S]*?)<\/tbody>/gi, (whole, body: string) => {
    const rows = Array.from(body.matchAll(/<tr[\s\S]*?<\/tr>/gi)).map((r) => r[0]);
    if (rows.length <= max) return whole;
    const linked: number[] = [];
    const plain: number[] = [];
    rows.forEach((r, i) => (/<a\b/i.test(r) ? linked : plain).push(i));
    const keep = new Set([...linked, ...plain].slice(0, max));
    rows.forEach((r, i) => {
      if (keep.has(i)) return;
      const name = decodeEntities(
        (r.match(/<td class="ppwb-cmp-model">([\s\S]*?)<\/td>/i)?.[1] || "").replace(/<[^>]+>/g, "")
      ).trim();
      dropped.push(name || `row ${i + 1}`);
    });
    const kept = rows.filter((_, i) => keep.has(i));
    return `<tbody>\n${kept.join("\n")}\n</tbody>`;
  });
  return { html: out, dropped };
}

const CMP_FILLER = new Set(["the", "a", "an", "and", "or", "of", "with", "by", "for", "in", "sauna", "saunas", "chamber", "chambers", "model", "series"]);

export function linkComparisonTable(
  html: string,
  products: { title?: string; handle?: string; imageUrl?: string; vendor?: string }[],
  /** The first N products are the ones on the page's cards; they win ties. */
  featuredCount = 0,
): { html: string; linked: string[] } {
  const linked: string[] = [];
  const cands = (products || [])
    .filter((p) => p?.title && p?.handle)
    .map((p, i) => ({
      p,
      featured: i < featuredCount,
      title: cleanProductTitle(p.title || ""),
      words: new Set(cleanProductTitle(p.title || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)),
      titleWordList: cleanProductTitle(p.title || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean),
      vendorWords: new Set((p.vendor || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)),
    }));
  if (!cands.length) return { html, linked };

  const out = html.replace(
    /<td class="ppwb-cmp-model">([\s\S]*?)<\/td>/gi,
    (whole, inner: string) => {
      if (/<a\b/i.test(inner)) return whole;
      // Decode entities BEFORE matching. "&amp;" survived the tag strip and
      // became the word "amp", which is in no product title, so every row with
      // an ampersand failed to match and shipped with no link and no image.
      const text = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
      // "Prism Wall Gym (7-ft track)" never matched because the bracketed
      // qualifier is not in the title. Drop parentheticals before matching.
      const core = text.replace(/\([^)]*\)/g, " ");
      const toWords = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !CMP_FILLER.has(w));
      const words = toWords(core);
      if (!words.length) return whole;
      // The model abbreviates in tables ("HCI PhysioTrainer Bi-Directional UBE")
      // where the catalogue spells it out ("... Upper Body Ergometer"). Treat a
      // short all-letter token as present when it is the initials of a run of
      // words in the title.
      const acronymOf = (w: string, titleWords: string[]) => {
        if (w.length < 2 || w.length > 5 || /\d/.test(w)) return false;
        for (let i = 0; i + w.length <= titleWords.length; i++) {
          if (titleWords.slice(i, i + w.length).map((t) => t[0]).join("") === w) return true;
        }
        return false;
      };
      const has = (c: (typeof cands)[number], w: string) =>
        c.words.has(w) || acronymOf(w, c.titleWordList);

      const better = (c: (typeof cands)[number], b: (typeof cands)[number] | null) =>
        !b || (c.featured && !b.featured) || (c.featured === b.featured && c.title.length < b.title.length);
      let best: (typeof cands)[number] | null = null;
      for (const c of cands) {
        const needed = words.filter((w) => !c.vendorWords.has(w));
        if (!needed.length) continue;
        if (!needed.every((w) => has(c, w))) continue;
        if (better(c, best)) best = c;
      }
      // Fallback: the row names the vendor and at least two title words, and
      // no other candidate matches as well. Numbers and units in the row
      // ("7 ft") are allowed to miss.
      if (!best) {
        let bestScore = 0;
        let tie = false;
        for (const c of cands) {
          const hasVendor = words.some((w) => c.vendorWords.has(w));
          if (!hasVendor) continue;
          const needed = words.filter((w) => !c.vendorWords.has(w));
          const hit = needed.filter((w) => has(c, w));
          const missed = needed.filter((w) => !has(c, w) && !/^\d+$|^(ft|in|lb|lbs|mm|cm|kg)$/.test(w));
          if (hit.length < 2 || missed.length) continue;
          if (hit.length > bestScore) { best = c; bestScore = hit.length; tie = false; }
          else if (hit.length === bestScore && best) {
            if (better(c, best)) best = c; else tie = tie || c.title === best.title;
          }
        }
        if (tie) best = null;
      }
      // Guide tables write the row as "Type (Model Name)": the type words match
      // nothing, but the parenthetical names the product. Try it on its own.
      // "(BenchK 233B / Series 7 723)" carries two models; each side of the
      // slash is tried and the first match wins.
      if (!best) {
        const parens = Array.from(text.matchAll(/\(([^)]+)\)/g)).flatMap((m) => m[1].split("/"));
        for (const candText of parens) {
          const pw = toWords(candText);
          if (!pw.length) continue;
          for (const c of cands) {
            const needed = pw.filter((w) => !c.vendorWords.has(w));
            if (!needed.length) continue;
            if (!needed.every((w) => c.words.has(w))) continue;
            if (better(c, best)) best = c;
          }
          if (best) break;
        }
      }
      if (!best) return whole;
      const href = `/products/${best.p.handle}`;
      const img = best.p.imageUrl
        ? `<img class="ppwb-cmp-thumb" src="${esc(best.p.imageUrl)}" alt="" loading="lazy" />`
        : "";
      linked.push(`${text} -> ${href}`);
      return `<td class="ppwb-cmp-model"><a class="ppwb-cmp-link" href="${esc(href)}">${img}<span>${esc(text)}</span></a></td>`;
    },
  );
  return { html: out, linked };
}

/**
 * Second pass for tables whose first column is not the model.
 *
 * The guide template writes Type / Best for / Key trade-off / Example model,
 * so the product name sits in the LAST cell while linkComparisonTable only
 * ever reads the first. On the treatment tables guide that left two of four
 * rows unlinked, including one whose "Example model" column named a product
 * the page already featured.
 *
 * For every row whose model cell is still unlinked, each OTHER cell is offered
 * to linkComparisonTable on its own. The first cell that resolves to a product
 * lends its link and thumbnail to the model cell. Visible text never changes:
 * the row keeps its own words and only gains an anchor.
 */
export function linkComparisonRowsByAnyCell(
  html: string,
  products: { title?: string; handle?: string; imageUrl?: string; vendor?: string }[],
): { html: string; linked: string[] } {
  const linked: string[] = [];
  if (!products?.length) return { html, linked };

  const out = html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const modelCell = row.match(/<td class="ppwb-cmp-model">([\s\S]*?)<\/td>/i);
    if (!modelCell || /<a\b/i.test(modelCell[1])) return row;

    const others = Array.from(row.matchAll(/<td(?! class="ppwb-cmp-model")[^>]*>([\s\S]*?)<\/td>/gi))
      .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim())
      .filter((t) => t && t.length < 120);

    for (const cellText of others) {
      const probe = linkComparisonTable(
        `<td class="ppwb-cmp-model">${cellText}</td>`,
        products,
        products.length,
      );
      const href = probe.html.match(/href="([^"]+)"/)?.[1];
      if (!href) continue;
      const img = probe.html.match(/<img class="ppwb-cmp-thumb"[^>]*>/i)?.[0] || "";
      const inner = modelCell[1];
      linked.push(`${cellText} -> ${href}`);
      return row.replace(
        modelCell[0],
        `<td class="ppwb-cmp-model"><a class="ppwb-cmp-link" href="${href}">${img}<span>${inner}</span></a></td>`,
      );
    }
    return row;
  });
  return { html: out, linked };
}

export function sealV2Links(
  html: string,
  inventory: Set<string>,
): { html: string; stripped: string[] } {
  const stripped: string[] = [];
  const out = html.replace(
    /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
    (whole, _pre, href: string, _post, text: string) => {
      const h = href.trim();
      if (h.startsWith("#") || h.startsWith("mailto:") || h.startsWith("tel:")) return whole;

      const key = linkKey(h);
      const isSiteLink =
        key.startsWith("/blogs/") ||
        key.startsWith("/collections/") ||
        key.startsWith("/pages/") ||
        key.startsWith("/products/");
      // Outbound links are dropped wholesale. PPW does not cite off-site, and an
      // unverifiable PMID is the same failure as an invented slug.
      if (!isSiteLink) { stripped.push(h); return text; }
      if (inventory.has(key)) {
        // Supplied, keep it, but as a root-relative path. The prompt asks for
        // root-relative and the model writes the full origin about half the time.
        const rel = h.replace(/^https?:\/\/(www\.)?peakprimalwellness\.com/i, "");
        return rel === h ? whole : whole.replace(href, rel);
      }

      stripped.push(h);
      return text;                                 // keep the sentence, drop the dead link
    },
  );
  return { html: out, stripped };
}

/**
 * Ranking and format words. A headline carries these; a sentence does not.
 * Their presence in BOTH the anchor and the destination title is the signal
 * that a title was pasted rather than a subject linked.
 */
const HEADLINE_WORDS = new Set([
  "best", "top", "ultimate", "complete", "definitive", "greatest", "finest",
  "options", "guide", "guides", "roundup", "reviewed", "review", "reviews",
  "ranked", "compared", "comparison", "2024", "2025", "2026", "2027",
]);

/** Normalise for comparing an anchor against a destination title. */
function titleKey(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Flag links whose anchor text is just the destination's own title.
 *
 * The spec asks for a natural phrase, but the inventory prints titles directly
 * beside the URLs, so the pull toward pasting them is strong. Reported rather
 * than repaired: fixing one means rewriting the sentence around it, which is
 * not something a regex can do without producing nonsense.
 */
export function auditAnchorText(html: string, titles: Map<string, string>): string[] {
  const lazy: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const dest = titles.get(linkKey(m[1]));
    if (!dest) continue;
    const plain = m[2].replace(/<[^>]+>/g, "").trim();
    const anchor = titleKey(plain);
    const title = titleKey(dest);
    const aw = anchor.split(" ").filter(Boolean);
    if (aw.length < 2) continue;

    // An anchor sharing the destination's SUBJECT is fine and often ideal:
    // "cold plunge chillers" pointing at "Best Cold Plunge Chillers" is exactly
    // right. What marks an anchor as a pasted headline is carrying the title's
    // PACKAGING — the ranking and format words that belong on a headline and
    // never in a sentence. An earlier version compared token overlap and would
    // have flagged "cold plunge chillers", which is the good version.
    const tw = new Set(title.split(" ").filter(Boolean));
    const packagingInBoth = aw.filter((w) => HEADLINE_WORDS.has(w) && tw.has(w));

    if (packagingInBoth.length) {
      lazy.push(`"${plain}" carries the headline word "${packagingInBoth[0]}" — link the subject, not the title`);
    } else if (anchor === title) {
      lazy.push(`"${plain}" is the destination's title verbatim`);
    }
  }
  return lazy;
}

export function auditV2Links(html: string, inventory?: Set<string>): LinkAudit {
  const hrefs = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)).map((m) => m[1]);

  const internal: string[] = [];
  const collections: string[] = [];
  const external: string[] = [];

  for (const h of hrefs) {
    if (h.startsWith("#") || h.startsWith("mailto:") || h.startsWith("tel:")) continue;
    if (h.startsWith("/collections/")) { collections.push(h); continue; }
    if (h.startsWith("/blogs/")) { internal.push(h); continue; }
    if (h.startsWith("/")) continue;           // /pages/, /products/, home
    if (/^https?:\/\/(www\.)?peakprimalwellness\.com/i.test(h)) {
      if (/\/collections\//.test(h)) collections.push(h);
      else if (/\/blogs\//.test(h)) internal.push(h);
      continue;
    }
    external.push(h);
  }

  const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return u } };
  const extDomains = external.map(domainOf);
  const blocked = extDomains.filter((d) => BLOCKED_EXTERNAL.some((b) => d.includes(b)));
  const unrecognised = extDomains.filter(
    (d) => !blocked.includes(d) && !ALLOWED_EXTERNAL.some((a) => d.endsWith(a)),
  );

  const warnings: string[] = [];
  if (internal.length < 4) warnings.push(`only ${internal.length} internal article link(s), target is 4 to 6`);
  if (internal.length > 6) warnings.push(`${internal.length} internal article links, target is 4 to 6`);
  if (collections.length !== 2) warnings.push(`${collections.length} in-context collection link(s), the rule is exactly 2`);

  // The real check. A slug the model invented looks exactly like a slug it was
  // given, so counting links proves nothing on its own.
  if (inventory) {
    const offList = [...internal, ...collections].filter((h) => !inventory.has(linkKey(h)));
    if (offList.length) {
      warnings.push(
        `${offList.length} link(s) not in the supplied inventory, i.e. invented: ${[...new Set(offList)].join(", ")}`,
      );
    }
  }
  // House rule as of Aug 2026: PPW does not link off-site from article bodies.
  if (external.length) {
    warnings.push(
      `${external.length} external link(s), the rule is zero: ${[...new Set(extDomains)].join(", ")}`,
    );
  }

  return {
    internal: internal.length,
    collections: collections.length,
    external: external.length,
    externalDomains: [...new Set(extDomains)],
    blocked: [...new Set(blocked)],
    unrecognisedExternal: [...new Set(unrecognised)],
    warnings,
    passed: warnings.length === 0,
  };
}

// ── TRUNCATION GUARD ────────────────────────────────────────────────────────
// The model can hit its token ceiling mid-sentence. The failure is quiet: the
// body just stops, an element is left unclosed, and the assembled article looks
// fine until you read it. Detect it, and cut back to the last complete block
// rather than publishing half a sentence.

export type SealResult = { html: string; truncated: boolean; removed: string; note: string };

const BLOCK_OPEN = /<(h2|h3|p|ul|ol|aside|div|blockquote|figure|table|section)\b/gi;

export function sealTruncatedBody(html: string): SealResult {
  const clean = (html || "").trim();
  if (!clean) return { html: clean, truncated: false, removed: "", note: "" };

  const count = (re: RegExp) => (clean.match(re) || []).length;
  const unbalanced =
    count(/<p\b/gi) !== count(/<\/p>/gi) ||
    count(/<div\b/gi) !== count(/<\/div>/gi) ||
    count(/<li\b/gi) !== count(/<\/li>/gi) ||
    count(/<ol\b/gi) !== count(/<\/ol>/gi) ||
    count(/<ul\b/gi) !== count(/<\/ul>/gi) ||
    count(/<aside\b/gi) !== count(/<\/aside>/gi) ||
    count(/<table\b/gi) !== count(/<\/table>/gi);

  // A body that ends mid-word or on a comma is truncated even if tags balance.
  const endsMidSentence = /[a-z0-9,;:]\s*$/i.test(clean.replace(/<[^>]*>\s*$/, "").trim());

  if (!unbalanced && !endsMidSentence) {
    return { html: clean, truncated: false, removed: "", note: "" };
  }

  // Walk back to the last closing tag of a top-level block and cut there.
  const closers = Array.from(clean.matchAll(/<\/(p|ul|ol|aside|div|blockquote|figure|table|section)>/gi));
  if (!closers.length) {
    return { html: clean, truncated: true, removed: "", note: "body looks truncated and could not be sealed, review by hand" };
  }
  const last = closers[closers.length - 1];
  let cut = clean.slice(0, last.index! + last[0].length);

  // A heading immediately before the cut now introduces nothing. Drop it.
  cut = cut.replace(/\s*<h[23]\b[^>]*>[\s\S]*?<\/h[23]>\s*$/i, "");

  const removed = clean.slice(cut.length).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    html: cut.trim(),
    truncated: true,
    removed: removed.slice(0, 160),
    note: `body was truncated mid-section and trimmed back to the last complete block. Raise the word count or regenerate. Dropped: "${removed.slice(0, 80)}"`,
  };
}
