// ============================================================================
// lib/guide-v2.ts, the ultimate guide on the blog v2 design system.
//
// Guides are Shopify PAGES at /pages/{slug}. Until Aug 2026 they had their own
// pipeline: topic-specific prompts written for cold plunges, an embedded
// <style> block with a different navy, a hand-rolled FAQ accordion with inline
// script, badges on the product cards and an author bio that invented
// credentials. None of the blog guards ran on them.
//
// This module puts a guide on the same footing as a template_version 2 article:
//   - the same gtdb- markup and the same theme stylesheet (gtd-blog.css), with a
//     handful of guide-only classes appended to it (.gtdb-guide-*)
//   - the same deterministic blocks from lib/article-v2 (takeaways, jump nav,
//     product cards, FAQ, shop CTA, author)
//   - the same guard chain, run per section by the generate-v2 route and once
//     more over the assembled body here
//
// What stays guide-specific: a hero image, a related guides grid, a larger
// "keep reading" block, a section PLAN the editor can trim per topic, and
// citations. Articles never link off-site; guides may, to an allowlist of
// domains, and every citation is checked live before it ships.
//
// The old assembler (lib/guide-assembler.ts) is untouched. assembleGuideHtml()
// there dispatches on guide.template_version, so every existing guide keeps
// rendering exactly as it did.
// ============================================================================

import {
  esc,
  buildV2Takeaways,
  buildV2Toc,
  buildV2Picks,
  buildV2Faq,
  buildV2ShopCta,
  buildV2Author,
  cleanProductTitle,
  dedupeV2Links,
  splitAdjacentLinks,
  capCollectionLinks,
  fillCollectionLinks,
  linkKey,
  navLabelFrom,
  linkComparisonTable,
  linkComparisonRowsByAnyCell,
  capComparisonRows,
  dropEmptyComparisonColumns,
} from "./article-v2";
import { authorBySlug, type Author } from "./authors";
import { extractFeatures } from "./product-card";
import { upgradeImagesToPicture } from "./imageUtils";

// ── Section plan ────────────────────────────────────────────────────────────

export type GuidePlanItem = {
  /** Stable key. Section fragments are stored under it in section_content. */
  key: string;
  /** The H2 as published. */
  heading: string;
  /** Short form for the jump nav, 34 characters or fewer. */
  navLabel?: string;
  /** What the reader needs from this section. Topic words are filled in at prompt time. */
  brief: string;
  /** Word target for the writer. */
  words: number;
  /** Unticked in Setup for topics where the section makes no sense. */
  enabled: boolean;
  /** Off-site citations are only invited here. */
  citations?: boolean;
};

/**
 * The default plan. Nine slots, none of them written for one product category.
 * "{topic}" and "{topics}" are replaced with the guide's short topic at prompt
 * time; the plan itself never names a modality. A home gym guide and a sauna
 * guide start from the same list and the editor unticks what does not apply.
 */
export const DEFAULT_GUIDE_PLAN: GuidePlanItem[] = [
  {
    key: "what-it-is",
    heading: "What it is and who it is for",
    navLabel: "What it is",
    brief:
      "Define {topic} plainly, say what problem it solves and who actually buys it (home users, athletes, clinics, facilities). " +
      "Say what it is not, and where it sits relative to the alternatives a reader might be weighing. " +
      "Set up the rest of the guide in one short closing paragraph.",
    words: 650,
    enabled: true,
  },
  {
    key: "how-it-works",
    heading: "How it works",
    navLabel: "How it works",
    brief:
      "Explain the mechanism: what the equipment does, what determines whether it works well, and which specifications drive results. " +
      "Use real figures from the product data where they exist. Where the manufacturers disagree, say so.",
    words: 750,
    enabled: true,
  },
  {
    key: "types",
    heading: "Types of {topics} and how to choose",
    navLabel: "Types and how to choose",
    brief:
      "Lay out the main types GTD carries, what each is best for, and the trade-offs between them. " +
      "Include one comparison table (gtdb-cmp) with a row per type, naming real models from the product data in the first column where a model exemplifies the type. " +
      "Follow the table with prose on how to decide: space, budget, who uses it, how often. Be opinionated.",
    words: 800,
    enabled: true,
  },
  {
    key: "benefits",
    heading: "Benefits and what the evidence says",
    navLabel: "Benefits and evidence",
    brief:
      "Cover the main reasons people use {topic} and what the research actually supports for each, including where the evidence is thin. " +
      "No marketing claims: describe the mechanism and the measured outcome, not a promise. " +
      "Where you cite a study, name the journal or organisation and the year inline.",
    words: 800,
    enabled: true,
    citations: true,
  },
  {
    key: "how-to-use",
    heading: "How to use {topics}",
    navLabel: "How to use it",
    brief:
      "Getting started, a sensible routine or progression for a beginner, how experienced users go further, and the mistakes that waste the purchase. " +
      "Use a numbered step list (gtdb-steps) for the getting-started part. Figures must be specific and must agree with the product data.",
    words: 800,
    enabled: true,
  },
  {
    key: "buying",
    heading: "What to look for when buying {topics}",
    navLabel: "What to look for",
    brief:
      "The buyer's checklist: the specifications that matter and why, the space, power and installation requirements from the listings, " +
      "what moves the price between an entry-level and a commercial-grade unit, and the questions to ask before ordering. " +
      "Ground every figure in the product data or catalogue research. Never mention shipping cost.",
    words: 750,
    enabled: true,
  },
  {
    key: "safety",
    heading: "Safety and things to consider",
    navLabel: "Safety",
    brief:
      "Who should talk to a doctor first, how to use {topic} safely, the warning signs that mean stop, and the maintenance that keeps it safe. " +
      "Open with a gtdb-call-warn callout holding a one-sentence medical disclaimer. Name specific considerations, not vague categories.",
    words: 600,
    enabled: true,
  },
  {
    key: "maintenance",
    heading: "Maintenance and running costs",
    navLabel: "Maintenance and costs",
    brief:
      "What owning {topic} involves after delivery: cleaning, consumables, servicing intervals, power use and the running costs a buyer should expect. " +
      "Take the figures from the listings where the manufacturers publish them and say when they do not.",
    words: 550,
    enabled: true,
  },
  {
    key: "common-questions",
    heading: "Common mistakes with {topics}",
    navLabel: "Common mistakes",
    brief:
      "The five or six mistakes that come up most with {topic}: wrong size, wrong type for the goal, skipped installation requirement, unrealistic expectations, poor routine. " +
      "Each as an H3 with a short paragraph on how to avoid it.",
    words: 550,
    enabled: false,
  },
];

/**
 * Topic words go mid-sentence in the headings, so Title Case from the Setup
 * form ("Cold Plunge") is lowered. A word with an internal capital or in all
 * caps (VersaClimber, EMF) is a name and is left alone.
 */
function midSentence(s: string): string {
  return s.split(/\s+/).map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w)).join(" ");
}

/**
 * "Home Gym Equipment" + "s" gave four headings the word "equipments". A mass
 * noun never takes the s, and neither does a topic already ending in one.
 */
export function smartPlural(topic: string, plural?: string): string {
  const t = topic.trim();
  const p = (plural || "").trim();
  const MASS = new Set(["equipment", "gear", "storage", "training", "cardio", "recovery"]);
  const last = (x: string) => x.toLowerCase().split(/\s+/).pop() || "";
  if (p && p.toLowerCase() !== `${t.toLowerCase()}s`) return p;
  if (MASS.has(last(t)) || /s$/i.test(t)) return t;
  return p || `${t}s`;
}

export function fillPlan(plan: GuidePlanItem[], topic: string, topicPlural: string): GuidePlanItem[] {
  const t = midSentence(topic.trim());
  const tp = midSentence(smartPlural(topic.trim(), topicPlural));
  const sub = (s: string) => s.replace(/\{topics\}/g, tp).replace(/\{topic\}/g, t);
  return plan.map((p) => ({ ...p, heading: sentence(sub(p.heading)), brief: sub(p.brief) }));
}

/** "What cold plunge is" reads wrong capitalised mid-sentence; lowercase the topic after the first word. */
function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function normalisePlan(raw: unknown): GuidePlanItem[] {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_GUIDE_PLAN.map((p) => ({ ...p }));
  const out: GuidePlanItem[] = [];
  for (const r of raw as Partial<GuidePlanItem>[]) {
    if (!r || typeof r.key !== "string" || !r.key.trim()) continue;
    const base = DEFAULT_GUIDE_PLAN.find((d) => d.key === r.key);
    out.push({
      key: r.key.trim(),
      heading: String(r.heading || base?.heading || r.key),
      navLabel: r.navLabel || base?.navLabel,
      brief: String(r.brief || base?.brief || ""),
      words: Number(r.words || base?.words || 700),
      enabled: r.enabled !== false,
      citations: r.citations ?? base?.citations ?? false,
    });
  }
  return out.length ? out : DEFAULT_GUIDE_PLAN.map((p) => ({ ...p }));
}

// ── Author ──────────────────────────────────────────────────────────────────

/**
 * Guides are bylined to Ryan by his own decision (Aug 2026), with his real
 * role. The blog keeps the GTD team byline until the other authors are
 * confirmed; that is why this reads the table by slug rather than through
 * authorForArticle(), which only returns active authors.
 */
export function guideAuthor(): Author {
  const ryan = authorBySlug("ryan-oconnor");
  const gtd = authorBySlug("gtd")!;
  if (ryan && ryan.name && ryan.bio) return ryan;
  return gtd;
}

// ── Citations ───────────────────────────────────────────────────────────────
// Articles strip every outbound link. Guides may cite, to these hosts only.
// The allowlist is the first gate; the second is a live HEAD request in the
// generate-v2 route, because a plausible PubMed URL the model invented is the
// same failure as an invented slug.

export const GUIDE_CITATION_HOSTS = [
  "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "nih.gov", "nlm.nih.gov",
  "who.int", "cdc.gov", "cochrane.org", "cochranelibrary.com", "bmj.com", "nature.com",
  "sciencedirect.com", "springer.com", "link.springer.com", "wiley.com", "onlinelibrary.wiley.com",
  "tandfonline.com", "jamanetwork.com", "nejm.org", "thelancet.com", "cell.com",
  "physiology.org", "journals.physiology.org", "acsm.org", "apta.org", "mayoclinic.org",
  "clevelandclinic.org", "frontiersin.org", "mdpi.com", "plos.org", "journals.plos.org",
  "jospt.org", "ahajournals.org", "heart.org", "diabetes.org", "cancer.gov", "nhs.uk",
  "health.harvard.edu", "hopkinsmedicine.org", "fda.gov", "osha.gov", "energy.gov",
  "ul.com", "intertek.com", "csagroup.org", "nsf.org",
];

export function isCitationHost(href: string): boolean {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
    return GUIDE_CITATION_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * The guide version of sealV2Links. Site links must be in the inventory;
 * outbound links survive only on an allowlisted host, and come out with the
 * rel attributes a citation should carry. Everything else is unwrapped to its
 * anchor text, sentence intact.
 */
export function sealGuideLinks(
  html: string,
  inventory: Set<string>,
  opts?: { allowCitations?: boolean; verified?: Set<string> },
): { html: string; stripped: string[]; citations: string[] } {
  const stripped: string[] = [];
  const citations: string[] = [];
  const out = html.replace(
    /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
    (whole, pre: string, href: string, post: string, text: string) => {
      const h = href.trim();
      if (h.startsWith("#") || h.startsWith("mailto:") || h.startsWith("tel:")) return whole;
      const key = linkKey(h);
      const isSite =
        key.startsWith("/blogs/") || key.startsWith("/collections/") ||
        key.startsWith("/pages/") || key.startsWith("/products/");
      if (isSite) {
        // Product links are written by linkComparisonTable() and the product
        // cards, never by the model, so they are trusted as our own.
        if (key.startsWith("/products/") || inventory.has(key)) {
          const rel = h.replace(/^https?:\/\/(www\.)?greenthumbdepot\.com/i, "");
          return rel === h ? whole : whole.replace(href, rel);
        }
        stripped.push(h);
        return text;
      }
      if (!/^https?:\/\//i.test(h)) { stripped.push(h); return text; }
      if (!opts?.allowCitations || !isCitationHost(h)) { stripped.push(h); return text; }
      if (opts.verified && !opts.verified.has(h)) { stripped.push(h); return text; }
      citations.push(h);
      const attrs = `${pre}${post}`.replace(/\s*\brel=["'][^"']*["']/i, "").replace(/\s*\btarget=["'][^"']*["']/i, "");
      return `<a${attrs} href="${esc(h)}" rel="nofollow noopener" target="_blank">${text}</a>`;
    },
  );
  return { html: out, stripped, citations };
}

/** Every outbound href in a body, deduplicated, in reading order. */
export function collectCitations(html: string): { href: string; label: string }[] {
  const seen = new Set<string>();
  const out: { href: string; label: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    if (/greenthumbdepot\.com/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, label: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  }
  return out;
}

function buildGuideSources(citations: { href: string; label: string }[]): string {
  if (!citations.length) return "";
  const li = citations.map((c) => {
    let host = c.href;
    try { host = new URL(c.href).hostname.replace(/^www\./, ""); } catch { /* keep href */ }
    return `<li class="gtdb-source">${esc(c.label || host)}. <a class="gtdb-a" href="${esc(c.href)}" rel="nofollow noopener" target="_blank">${esc(host)}</a></li>`;
  }).join("\n");
  return `<section class="gtdb-sources">
<div class="gtdb-sources-label">Sources cited</div>
<ol class="gtdb-sources-list">
${li}
</ol>
</section>`;
}

// ── Fragment normalisation ──────────────────────────────────────────────────

/**
 * The image storyboard drops a bare, inline-styled <img> after the first
 * paragraph of a section. On the v2 template that becomes a figure so the
 * stylesheet owns the radius and rhythm. Images already inside a figure are
 * left alone.
 */
/**
 * The image storyboard inserts its figure after the section's first closing
 * paragraph tag. When that paragraph lives inside a callout (the safety
 * section opens with the disclaimer aside), the figure lands inside the
 * aside. Move any figure found inside an aside to just after it.
 */
export function liftFiguresOutOfCallouts(html: string): string {
  return html.replace(
    /(<aside\b[^>]*class=["'][^"']*gtdb-call[^"']*["'][^>]*>)([\s\S]*?)(<\/aside>)/gi,
    (whole, open: string, inner: string, close: string) => {
      const figs: string[] = [];
      const cleaned = inner.replace(/<figure\b[\s\S]*?<\/figure>/gi, (f) => { figs.push(f); return ""; });
      if (!figs.length) return whole;
      return `${open}${cleaned}${close}\n${figs.join("\n")}`;
    },
  );
}

export function normaliseGuideImages(html: string): string {
  // Repair pass first: a comparison thumbnail that an earlier assembly wrapped
  // in a figure gets unwrapped, so the table cell holds the bare thumb again.
  html = html.replace(
    /<figure class="gtdb-fig">\s*((?:<picture>[\s\S]*?<\/picture>|<img\b[^>]*gtdb-cmp-thumb[^>]*>))\s*<\/figure>/gi,
    (whole, inner: string) => (/gtdb-cmp-thumb/i.test(inner) ? inner : whole),
  );
  return html.replace(/<img\b[^>]*>/gi, (tag, offset: number, whole: string) => {
    // An img that already carries a gtdb- class is a deliberate block
    // (comparison thumb, pick image); never rewrap it.
    if (/class=["'][^"']*gtdb-/i.test(tag)) return tag;
    const before = whole.slice(Math.max(0, offset - 80), offset);
    if (/<figure\b[^>]*>\s*$/i.test(before) || /gtdb-pick-img|gtdb-cmp-thumb|gtdb-cmp-link/i.test(before)) return tag;
    const clean = tag
      .replace(/\s*style=["'][^"']*["']/i, "")
      .replace(/\s*loading=["'][^"']*["']/i, "")
      .replace(/\/?>$/, "") + ' loading="lazy" />';
    return `<figure class="gtdb-fig">${clean}</figure>`;
  });
}

/**
 * Old-template fragments carry legacy classes. When an existing guide is
 * re-assembled on v2 without regeneration, the common ones are mapped so the
 * page is at least readable; a regenerate is still the real fix.
 */
export function upgradeLegacyFragment(html: string): string {
  let h = html;
  if (/class="gtdb-/.test(h)) return h;
  h = h
    .replace(/<p(?![^>]*class=)/gi, '<p class="gtdb-p"')
    .replace(/<h3(?![^>]*class=)/gi, '<h3 class="gtdb-h3"')
    .replace(/<h4(?![^>]*class=)/gi, '<h3 class="gtdb-h3"').replace(/<\/h4>/gi, "</h3>")
    .replace(/<ul(?![^>]*class=)/gi, '<ul class="gtdb-ul"')
    .replace(/<ol(?![^>]*class=)/gi, '<ol class="gtdb-ol"')
    .replace(/<li(?![^>]*class=)/gi, '<li class="gtdb-li"')
    .replace(/<div class="gtd-callout-warn">/gi, '<aside class="gtdb-call gtdb-call-warn"><span class="gtdb-call-label">Before you start</span>')
    .replace(/<div class="callout-info">/gi, '<aside class="gtdb-call"><span class="gtdb-call-label">Note</span>')
    .replace(/<div class="gtd-table-wrap">\s*<table class="gtd-table">/gi, '<div class="gtdb-cmp-wrap"><table class="gtdb-cmp">')
    .replace(/<div class="gtd-stat-box"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<span class="gtd-benefit-icon">[\s\S]*?<\/span>/gi, "")
    .replace(/<div class="gtd-benefits-grid">/gi, "<div>")
    .replace(/<div class="gtd-benefit-card">/gi, "<div>");
  // The warn/info callouts above opened an <aside>; their closing </div> is now wrong.
  h = h.replace(/(<aside class="gtdb-call[^"]*">[\s\S]*?)<\/div>/gi, "$1</aside>");
  return h;
}

// ── Assembly ────────────────────────────────────────────────────────────────

export type GuideV2Product = {
  title: string;
  handle: string;
  image_url?: string;
  price?: number | string;
  vendor?: string;
  productType?: string;
  description?: string;
  tags?: string;
  specs?: string[];
};

export type GuideV2Input = {
  title: string;
  slug: string;
  topic_short: string;
  topic_short_plural?: string;
  description?: string;
  meta_description?: string;
  collection_slug?: string;
  breadcrumb_l2_name?: string;
  breadcrumb_l2_slug?: string;
  hub?: string;
  hero_image_cdn_url?: string;
  hero_image_url?: string;
  date_published?: string;
  section_plan?: GuidePlanItem[] | unknown;
  key_takeaways?: { label: string; text: string }[] | unknown;
  faq_pairs?: { q: string; a: string }[] | unknown;
  selected_products?: GuideV2Product[];
  related_guides?: { title: string; slug: string; description?: string }[];
  cluster_links?: { url: string; anchor?: string; title?: string }[];
};

export type GuideV2Options = {
  /** Ranked collection candidates for the two in-body collection links. */
  collectionCandidates?: { title: string; url: string }[];
  /** Verified citation URLs. When supplied, any outbound link not in it is unwrapped. */
  verifiedCitations?: Set<string>;
  /** Site URLs the body may link. When supplied, anything else is unwrapped. */
  linkInventory?: Set<string>;
  verifiedAt?: Date;
};

// "gtdb-guide" was the first choice and collided with the blog's "Go deeper"
// guide-link box (.gtdb-guide is display:flex in section 10 of the CSS), which
// laid the whole page out as that little flex row. Hence the longer name.
export const GUIDE_V2_MARKER = "gtdb-guidepage";

export function isGuideV2Html(html: string | null | undefined): boolean {
  return !!html && html.includes(`class="gtdb-article ${GUIDE_V2_MARKER}`);
}

function fmtDate(d: Date): string {
  return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getFullYear()}`;
}

function wordsIn(html: string): number {
  return html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

function buildGuideHeader(o: {
  title: string;
  deck: string;
  collectionLabel?: string;
  collectionSlug?: string;
  readTime: number;
  author: Author;
  updated: Date;
}): string {
  const crumb = o.collectionLabel && o.collectionSlug
    ? `<a href="/">Home</a><span>›</span><a href="/collections/${esc(o.collectionSlug)}">${esc(o.collectionLabel)}</a><span>›</span><span aria-current="page">Ultimate guide</span>`
    : `<a href="/">Home</a><span>›</span><span aria-current="page">Ultimate guide</span>`;
  return `<header class="gtdb-head">
<nav class="gtdb-crumb" aria-label="Breadcrumb">${crumb}</nav>
<div class="gtdb-kicker">Ultimate guide</div>
<h1 class="gtdb-h1">${esc(o.title)}</h1>${o.deck ? `\n<p class="gtdb-deck">${esc(o.deck)}</p>` : ""}
<div class="gtdb-meta">
<span>By <strong>${esc(o.author.name)}</strong>${o.author.role ? `, ${esc(o.author.role)}` : ""}</span>
<i class="gtdb-meta-dot"></i>
<span>${o.readTime} min read</span>
<i class="gtdb-meta-dot"></i>
<span>Updated ${fmtDate(o.updated)}</span>
</div>
</header>`;
}

function buildGuideHero(url: string, alt: string): string {
  if (!url) return "";
  return `<figure class="gtdb-hero-img gtdb-guide-hero"><img src="${esc(url)}" alt="${esc(alt)}" width="1200" height="675" loading="eager" /></figure>`;
}

function buildRelatedGuides(guides: { title: string; slug: string; description?: string }[]): string {
  const list = (guides || []).filter((g) => g?.title && g?.slug).slice(0, 6);
  if (!list.length) return "";
  const cards = list.map((g) => {
    const href = g.slug.startsWith("/") ? g.slug : `/pages/${g.slug}`;
    return `<a class="gtdb-gcard" href="${esc(href)}">
<div class="gtdb-gcard-kick">Ultimate guide</div>
<div class="gtdb-gcard-title">${esc(g.title)}</div>${g.description ? `\n<p class="gtdb-card-dek">${esc(g.description)}</p>` : ""}
<div class="gtdb-gcard-meta">Read the guide ›</div>
</a>`;
  }).join("\n");
  return `<section class="gtdb-guide-related">
<h2 class="gtdb-h2" id="related-guides" style="margin-top:0">Related ultimate guides</h2>
<div class="gtdb-guide-related-grid">
${cards}
</div>
</section>`;
}

function buildKeepReading(links: { url: string; title: string }[], topic: string): string {
  const list = links.filter((l) => l.url && l.title).slice(0, 6);
  if (!list.length) return "";
  const tiles = list.map((l) =>
    `<a class="gtdb-tile" href="${esc(l.url)}">
<div class="gtdb-tile-hub">${esc(topic)}</div>
<div class="gtdb-tile-title">${esc(l.title)}</div>
</a>`).join("\n");
  return `<section class="gtdb-related">
<h2 class="gtdb-h2" id="keep-reading" style="margin-top:0">Keep reading</h2>
<div class="gtdb-related-grid">
${tiles}
</div>
</section>`;
}

/**
 * Assemble a complete guide page from its section fragments.
 *
 * sectionContent is keyed by plan key and holds BODY markup only (h3, p, ul,
 * steps, callouts, tables, figures). The H2 for each section comes from the
 * plan, so the heading the jump nav advertises is always the heading on the
 * page. Takeaways and FAQ come from the row's key_takeaways and faq_pairs.
 */
export function assembleGuideV2(
  guide: GuideV2Input,
  sectionContent: Record<string, string>,
  opts: GuideV2Options = {},
): { html: string; warnings: string[]; wordCount: number } {
  const warnings: string[] = [];
  const topic = (guide.topic_short || "").trim() || "this equipment";
  const topicPlural = smartPlural(topic, guide.topic_short_plural);
  const plan = fillPlan(normalisePlan(guide.section_plan), topic, topicPlural).filter((p) => p.enabled);
  const author = guideAuthor();
  const now = opts.verifiedAt ?? new Date();
  const collectionSlug = guide.collection_slug || guide.breadcrumb_l2_slug || "";
  const collectionLabel = guide.breadcrumb_l2_name || topicPlural;

  // ── Body sections, in plan order ──────────────────────────────────────────
  const tocItems: { id: string; text: string; navLabel?: string }[] = [];
  const bodyParts: string[] = [];
  let n = 0;
  for (const item of plan) {
    const raw = sectionContent[item.key];
    if (!raw || !raw.trim()) continue;
    n++;
    const id = `section-${n}`;
    let frag = upgradeLegacyFragment(raw);
    // Normalise first: the storyboard's bare <img> becomes a figure, and only
    // then can the lift move it out of a callout it was injected into.
    frag = normaliseGuideImages(frag);
    frag = liftFiguresOutOfCallouts(frag);
    // A fragment must not carry its own H2; the plan owns the heading.
    frag = frag.replace(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi, "");
    tocItems.push({ id, text: item.heading, navLabel: item.navLabel || navLabelFrom(item.heading) });
    bodyParts.push(`<h2 class="gtdb-h2" id="${id}">${esc(item.heading)}</h2>\n${frag.trim()}`);
  }
  if (!bodyParts.length) warnings.push("no section content; the page has a header and nothing else");

  // Picks sit after the buying section when it exists, otherwise after the last section.
  const products = (guide.selected_products || []).filter((p) => p?.title && p?.handle);
  const picksHtml = products.length
    ? buildV2Picks(
        products.map((p) => ({
          title: p.title,
          handle: p.handle,
          imageUrl: p.image_url,
          price: p.price != null ? String(p.price) : undefined,
          vendor: p.vendor,
          description: p.description,
          tags: p.tags,
          specs: p.specs,
        })),
        (p) => {
          const specs = (p as { specs?: string[] }).specs;
          return specs?.length ? specs : extractFeatures({ title: p.title, description: p.description, tags: p.tags, vendor: p.vendor });
        },
        `Where to start with ${topicPlural.toLowerCase()}`,
        { anchor: "picks" },
      )
    : "";
  // ── Whole-body link guards, on the WRITTEN body only ──────────────────────
  // Each section was sealed on its own by the route. Across sections the
  // same URL can be linked twice and the collection count can exceed two.
  // The product cards are added afterwards so their anchors are never
  // counted, deduplicated or unwrapped.
  let body = bodyParts.join("\n\n");
  if (opts.linkInventory) {
    const sealed = sealGuideLinks(body, opts.linkInventory, { allowCitations: true, verified: opts.verifiedCitations });
    body = sealed.html;
    if (sealed.stripped.length) warnings.push(`stripped ${sealed.stripped.length} link(s) not in the inventory: ${sealed.stripped.slice(0, 6).join(", ")}`);
  }
  // Comparison-table product links sit out the editorial link guards: the
  // same product may legitimately anchor a row in two different tables, and
  // dedupe was unwrapping the second one to plain text.
  const cmpTokens: string[] = [];
  body = body.replace(/<a class="gtdb-cmp-link"[\s\S]*?<\/a>/gi, (m) => {
    cmpTokens.push(m);
    return `\u0001CMPLINK${cmpTokens.length - 1}\u0001`;
  });
  const dedupe = dedupeV2Links(body);
  body = dedupe.html;
  if (dedupe.collapsed.length) warnings.push(`collapsed ${dedupe.collapsed.length} repeated link(s)`);
  const split = splitAdjacentLinks(body);
  body = split.html;
  const cap = capCollectionLinks(body, 2);
  body = cap.html;
  if (cap.unwrapped.length) warnings.push(`unwrapped ${cap.unwrapped.length} collection link(s) over the limit of 2`);
  if (opts.collectionCandidates?.length) {
    const fill = fillCollectionLinks(body, opts.collectionCandidates, 2);
    body = fill.html;
  }

  body = body.replace(/\u0001CMPLINK(\d+)\u0001/g, (_m, i: string) => cmpTokens[Number(i)] || "");

  // Comparison table rows that name a featured product link to it with a
  // thumbnail, the way blog tables do. The route already did this with the
  // full collection pool at write time; this pass covers re-assembly and any
  // row it could not match then. Anchors that shipped without a thumbnail
  // (the first guide's did) get one backfilled from the selected products.
  if (products.length) {
    const tableProducts = products.map((p) => ({ title: p.title, handle: p.handle, imageUrl: p.image_url, vendor: p.vendor }));
    body = linkComparisonTable(body, tableProducts, tableProducts.length).html;
    // Guide tables put the model in "Example model", not the first column, so
    // rows the first-cell matcher cannot reach get a second pass over every
    // other cell in the row.
    const byCell = linkComparisonRowsByAnyCell(body, tableProducts);
    body = byCell.html;
    if (byCell.linked.length) warnings.push(`linked ${byCell.linked.length} comparison row(s) from a non-model column`);

    // Six rows maximum, same rule as the blog tables, and an empty column is
    // dropped rather than shipped blank.
    const capped = capComparisonRows(body, 6);
    body = capped.html;
    if (capped.dropped.length) warnings.push(`trimmed ${capped.dropped.length} comparison row(s) over the limit of six`);
    const emptied = dropEmptyComparisonColumns(body);
    body = emptied.html;
    if (emptied.dropped.length) warnings.push(`dropped ${emptied.dropped.length} mostly empty comparison column(s)`);

    // A guide with six products should compare six. The row count is the
    // model's to write, so this reports rather than repairs: a short table is
    // visible in the run instead of being found on the published page.
    for (const t of body.match(/<table class="gtdb-cmp"[\s\S]*?<\/table>/gi) || []) {
      const rows = (t.match(/<td class="gtdb-cmp-model">/g) || []).length;
      const unlinked = (t.match(/<td class="gtdb-cmp-model">(?!\s*<a)/g) || []).length;
      if (rows && rows < Math.min(6, products.length)) {
        warnings.push(`comparison table has ${rows} rows for ${products.length} featured products`);
      }
      if (unlinked) warnings.push(`${unlinked} comparison row(s) name no product GTD sells`);
    }
    const imgByHandle = new Map(products.filter((p) => p.image_url).map((p) => [p.handle.toLowerCase(), p.image_url as string]));
    body = body.replace(
      /(<a class="gtdb-cmp-link" href="\/products\/([^"]+)">)(?!\s*<img)/gi,
      (whole, open: string, rawHandle: string) => {
        let img: string | undefined;
        try { img = imgByHandle.get(decodeURIComponent(rawHandle).toLowerCase()); } catch { img = imgByHandle.get(rawHandle.toLowerCase()); }
        return img ? `${open}<img class="gtdb-cmp-thumb" src="${esc(img)}" alt="" loading="lazy" />` : whole;
      },
    );
  }

  // Picks go after the buying section when it was written, else at the end.
  if (picksHtml) {
    const renderedKeys = plan.filter((p) => sectionContent[p.key]?.trim()).map((p) => p.key);
    const at = renderedKeys.indexOf("buying");
    if (at >= 0) {
      // Re-split on the H2 markers so the insertion lands between sections.
      const chunks = body.split(/(?=<h2 class="gtdb-h2" id="section-\d+">)/);
      chunks.splice(at + 1, 0, picksHtml);
      body = chunks.join("\n\n");
    } else {
      body = `${body}\n\n${picksHtml}`;
    }
  }

  // ── Deterministic blocks ──────────────────────────────────────────────────
  const takeaways = (Array.isArray(guide.key_takeaways) ? guide.key_takeaways : [])
    .filter((t): t is { label: string; text: string } => !!t && typeof (t as { text?: unknown }).text === "string")
    .map((t) => ({ label: String(t.label || ""), text: t.text }));
  const faq = (Array.isArray(guide.faq_pairs) ? guide.faq_pairs : [])
    .filter((f): f is { q: string; a: string } => !!f && typeof (f as { q?: unknown }).q === "string" && typeof (f as { a?: unknown }).a === "string");
  if (faq.length) tocItems.push({ id: "faq", text: "Frequently asked questions", navLabel: "FAQ" });

  const wordCount = wordsIn(body) + wordsIn(faq.map((f) => f.a).join(" "));
  const readTime = Math.max(5, Math.round(wordCount / 230));
  const deck = (guide.description || guide.meta_description || "").trim();
  const hero = guide.hero_image_cdn_url || guide.hero_image_url || "";

  const clusterLinks = (guide.cluster_links || [])
    .map((l) => ({ url: l.url, title: l.title || l.anchor || "" }))
    .filter((l) => l.url && l.title && !/^\/pages\//.test(linkKey(l.url)));

  const citations = collectCitations(body);

  const parts = [
    buildGuideHeader({ title: guide.title, deck, collectionLabel, collectionSlug, readTime, author, updated: now }),
    buildGuideHero(hero, guide.title),
    buildV2Takeaways(takeaways),
    buildV2Toc(tocItems),
    body,
    buildV2Faq(faq),
    buildGuideSources(citations),
    buildRelatedGuides(guide.related_guides || []),
    buildKeepReading(clusterLinks, topicPlural),
    collectionSlug
      ? buildV2ShopCta({ kicker: "Ultimate guide", collectionSlug, collectionLabel, hub: guide.hub })
      : "",
    buildV2Author(author, now),
  ];

  const schema = faq.length
    ? `\n<script type="application/ld+json">\n${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a.replace(/<[^>]+>/g, "") },
        })),
      }, null, 2)}\n</script>`
    : "";

  const html = `<article class="gtdb-article ${GUIDE_V2_MARKER}">

${parts.filter((p) => p && p.trim()).join("\n\n")}

</article>${schema}`;

  return { html: upgradeImagesToPicture(html), warnings, wordCount };
}

/** The product shape stored on the guide row, from a live Shopify product. */
export function toGuideProduct(p: {
  title: string; handle?: string; imageUrl?: string; price?: string; vendor?: string;
  productType?: string; description?: string; tags?: string;
}): GuideV2Product {
  return {
    title: cleanProductTitle(p.title),
    handle: p.handle || "",
    image_url: p.imageUrl || "",
    price: parseFloat(p.price || "0") || 0,
    vendor: p.vendor || "",
    productType: p.productType || "",
    specs: extractFeatures({ title: p.title, description: p.description, tags: p.tags, vendor: p.vendor }),
  };
}
