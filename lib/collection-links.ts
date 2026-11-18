/**
 * In-content collection link auditor.
 *
 * Standing rule: every post needs 1-2 contextual /collections/ links in the
 * body, in ADDITION to the bottom "Shop The Collection" button. The bottom
 * button is identifiable as an <a> with class gtd-cta linking to /collections/
 * (product-card gtd-cta links point at /products/ so they never match).
 * Everything else linking to /collections/ counts as in-content.
 */

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const COLLECTION_HREF = /\/collections\/([a-z0-9_-]+)/i;

export type CollectionLink = { href: string; text: string; slug: string };

export type CollectionLinkAudit = {
  /** Contextual in-content collection links (excludes gtd-cta template buttons). */
  inContent: CollectionLink[];
  /** Count of template "Shop The Collection" style buttons (gtd-cta -> /collections/). */
  ctaButtons: number;
  /** Any link (either kind) pointing at a Finnmark collection — must never exist. */
  finnmarkLinks: string[];
};

export function auditCollectionLinks(html: string): CollectionLinkAudit {
  const inContent: CollectionLink[] = [];
  let ctaButtons = 0;
  const finnmarkLinks: string[] = [];

  for (const m of html.matchAll(ANCHOR_RE)) {
    const attrs = m[1];
    const href = attrs.match(/href="([^"]*)"/i)?.[1] || "";
    const slugMatch = href.match(COLLECTION_HREF);
    if (!slugMatch) continue;

    const slug = slugMatch[1].toLowerCase();
    if (slug.includes("finnmark")) finnmarkLinks.push(href);

    const cls = attrs.match(/class="([^"]*)"/i)?.[1] || "";
    if (cls.includes("gtd-cta")) {
      ctaButtons++;
      continue;
    }
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    inContent.push({ href, text, slug });
  }

  return { inContent, ctaButtons, finnmarkLinks };
}

// ═════════════════════════════════════════════════════════════════════════════
// INJECTION (used by the revamp pipeline)
// ═════════════════════════════════════════════════════════════════════════════

import { COLLECTION_DISPLAY_TAGS } from "@/lib/tagMapping";
import {
  COLLECTION_KEYWORDS,
  SECONDARY_MAP,
  APP_SLUG_TO_LIVE_HANDLE,
  SAUNA_SPECIFIC,
  BRAND_COLLECTIONS,
  EXCLUDED_HANDLES,
  ANCHOR_TEMPLATES,
} from "@/lib/collection-link-map";

export type InjectOptions = {
  /** App category slug from revamp settings (master collections list). */
  category: string;
  /** Post target keyword. */
  keyword: string;
  /** Post title. */
  title: string;
  /** Stable seed (e.g. article handle) for anchor rotation. */
  seed: string;
};

export type InjectResult = {
  html: string;
  added: { handle: string; anchor: string; method: "wrapped" | "inserted" }[];
  primaryHandle: string | null;
};

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Resolve the post's primary collection handle (live Shopify handle). */
export function resolvePrimaryHandle(category: string, keyword: string, title: string): string | null {
  const haystack = `${keyword} ${title}`.toLowerCase();
  // Sauna posts: most specific existing sauna collection whose keyword terms
  // all appear in the post keyword/title.
  if (haystack.includes("sauna") || category.includes("sauna") || category === "steam") {
    for (const s of SAUNA_SPECIFIC) {
      const terms = s.keyword.toLowerCase().split(/\s+/);
      if (terms.every((t) => haystack.includes(t))) return s.handle;
    }
  }
  const live = APP_SLUG_TO_LIVE_HANDLE[category] || category;
  return COLLECTION_KEYWORDS[live] ? live : null;
}

/** Brand collection when the post is explicitly about that brand. */
function resolveBrandHandle(keyword: string, title: string): string | null {
  const haystack = `${keyword} ${title}`.toLowerCase();
  for (const b of BRAND_COLLECTIONS) {
    if (haystack.includes(b.name.toLowerCase())) return b.handle;
  }
  return null;
}

function buildAnchorText(handle: string, seed: number, slot: number): string {
  const kw = COLLECTION_KEYWORDS[handle] || handle.replace(/-/g, " ");
  const tpl = ANCHOR_TEMPLATES[(seed + slot) % ANCHOR_TEMPLATES.length];
  return tpl.replace("{kw}", kw);
}

/**
 * Try to wrap an existing plain-text mention of the collection keyword in a
 * paragraph (no other links in that paragraph, not a heading/attribute).
 * Returns null when no safe mention exists.
 */
function wrapExistingMention(html: string, handle: string, fromRatio: number, toRatio: number): string | null {
  const kw = COLLECTION_KEYWORDS[handle];
  if (!kw) return null;
  // Try the SEO keyword, the collection's plain name (handle words), and
  // singular/plural siblings — prose usually says "traditional sauna", not
  // the exact SEO phrase "traditional sauna for sale".
  const name = handle.replace(/-/g, " ");
  const base = [kw, name];
  const variants = base
    .flatMap((v) => [v, v.endsWith("s") ? v.slice(0, -1) : v + "s"])
    .filter((v, i, arr) => v.length > 3 && arr.indexOf(v) === i)
    .sort((a, b) => b.length - a.length);
  const from = Math.floor(html.length * fromRatio);
  const to = Math.floor(html.length * toRatio);

  const paraRe = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
  for (const m of html.matchAll(paraRe)) {
    const start = m.index ?? 0;
    if (start < from || start > to) continue;
    const para = m[0];
    if (/<a\b/i.test(para)) continue; // already links somewhere
    for (const v of variants) {
      // keyword must sit in a text node (no '<' or '>' between tag boundaries)
      const textRe = new RegExp(`(>)([^<>]*?)(${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i");
      const hit = para.match(textRe);
      if (hit) {
        const wrapped = para.replace(
          textRe,
          (_full, gt: string, before: string, word: string) =>
            `${gt}${before}<a href="/collections/${handle}">${word}</a>`
        );
        return html.slice(0, start) + wrapped + html.slice(start + para.length);
      }
    }
  }
  return null;
}

/** Insert a standalone sentence paragraph before the Nth <h2 (1-based). */
function insertSentence(html: string, handle: string, anchor: string, position: "early" | "mid"): string | null {
  const h2Positions: number[] = [];
  const re = /<h2\b/gi;
  let m;
  while ((m = re.exec(html)) !== null) h2Positions.push(m.index);
  if (h2Positions.length === 0) return null;

  const kw = COLLECTION_KEYWORDS[handle] || handle.replace(/-/g, " ");
  const sentence = `<p>If you're weighing options, <a href="/collections/${handle}">${anchor}</a> to see every ${kw.replace(/s$/, "")} we carry.</p>`;

  // early: end of first H2 section (right before the 2nd H2, or after the last
  // paragraph when there's only one section). mid: before the middle H2.
  let at: number;
  if (position === "early") {
    at = h2Positions.length > 1 ? h2Positions[1] : html.length;
  } else {
    at = h2Positions[Math.min(h2Positions.length - 1, Math.ceil(h2Positions.length / 2))];
  }
  return html.slice(0, at) + sentence + "\n" + html.slice(at);
}

/**
 * Top up a post to 2 in-content collection links per the standing rule:
 * 0 found -> inject primary + secondary; 1 found -> inject one more;
 * 2+ found -> unchanged. Never duplicates an existing target, never links
 * excluded handles. Wrapping an existing keyword mention is preferred; a
 * short standalone sentence is the fallback.
 */
export function injectCollectionLinks(html: string, opts: InjectOptions): InjectResult {
  const audit = auditCollectionLinks(html);
  const needed = Math.max(0, 2 - audit.inContent.length);
  const primaryHandle = resolvePrimaryHandle(opts.category, opts.keyword, opts.title);
  if (needed === 0) return { html, added: [], primaryHandle };

  const existingTargets = new Set(audit.inContent.map((l) => l.slug));
  const brandHandle = resolveBrandHandle(opts.keyword, opts.title);
  // Specific sauna collections aren't SECONDARY_MAP keys — fall back to the
  // category parent's mapping (e.g. 2-person-saunas -> traditional-saunas' pair).
  const categoryLive = APP_SLUG_TO_LIVE_HANDLE[opts.category] || opts.category;
  const secondaryHandle =
    brandHandle ||
    (primaryHandle ? SECONDARY_MAP[primaryHandle] : null) ||
    SECONDARY_MAP[categoryLive] ||
    null;

  const candidates = [primaryHandle, secondaryHandle]
    .filter((h): h is string => !!h)
    .filter((h, i, arr) => arr.indexOf(h) === i)
    .filter((h) => !existingTargets.has(h))
    .filter((h) => !EXCLUDED_HANDLES.some((x) => h.includes(x)))
    .slice(0, needed);

  const seed = hashSeed(opts.seed || opts.keyword);
  let out = html;
  const added: InjectResult["added"] = [];

  candidates.forEach((handle, i) => {
    const isPrimary = handle === primaryHandle;
    const anchor = buildAnchorText(handle, seed, i);
    const wrapped = isPrimary
      ? wrapExistingMention(out, handle, 0, 0.45)
      : wrapExistingMention(out, handle, 0.35, 0.85);
    if (wrapped) {
      out = wrapped;
      added.push({ handle, anchor: COLLECTION_KEYWORDS[handle] || handle, method: "wrapped" });
      return;
    }
    const inserted = insertSentence(out, handle, anchor, isPrimary ? "early" : "mid");
    if (inserted) {
      out = inserted;
      added.push({ handle, anchor, method: "inserted" });
    }
  });

  return { html: out, added, primaryHandle };
}


/**
 * Derive the post's app category slug from its Shopify display tags by
 * inverting COLLECTION_DISPLAY_TAGS. Most specific match (most tags) wins:
 * "Saunas, Barrel Saunas" -> barrel-saunas, not saunas.
 */
export function deriveCategoryFromTags(tags: string): string | null {
  const tagSet = new Set(
    tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
  );
  let best: string | null = null;
  let bestCount = 0;
  for (const [slug, displayTags] of Object.entries(COLLECTION_DISPLAY_TAGS)) {
    if (displayTags.every((d) => tagSet.has(d.toLowerCase()))) {
      if (displayTags.length > bestCount) {
        best = slug;
        bestCount = displayTags.length;
      }
    }
  }
  return best;
}
