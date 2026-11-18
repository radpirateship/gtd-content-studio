// ============================================================================
// lib/authors.ts: the GTD authors table.
//
// Bylines confirmed by Ryan, 18 Nov 2026:
//   - Elliott Gorfain on technical content (cultivation, equipment, lighting,
//     climate, irrigation, media and nutrients, harvest, extraction,
//     processing, buying guides, comparisons).
//   - James Ruhle on business content (licensing, compliance overviews,
//     facility costs and ROI, financing, starting or scaling a business).
//
// WHY THIS IS A TABLE AND NOT A PROMPT
// Bios and roles are fixed data, never generated per article. A bio written
// fresh each time drifts into invented credentials within a few dozen
// articles. Everything here must be verifiable. Elliott's bio uses only what
// GTD's consulting page states. The matching enforcement for article bodies
// lives in UNSUPPORTED_CLAIMS in lib/brandRules.ts.
//
// Writing under a named byline never licenses invented first-person
// experience, anecdotes, client stories or quotes. Credentials go in the bio.
//
// TO SWITCH ONE ON
//   1. Replace the TODO bio and role with confirmed wording.
//   2. Create the author archive page, then set hasArchive: true.
//   3. Set status: "active".
// ============================================================================

export type AuthorStatus = "active" | "planned";

export type Author = {
  slug: string;
  name: string;
  /** Real role at GTD. Empty renders no role line. */
  role: string;
  /** 25 to 40 words. Verifiable scope of work only. */
  bio: string;
  /** Fallback when there is no headshot. */
  initials: string;
  photoUrl?: string;
  /** Hubs this person is bylined on. Empty means catch-all. */
  hubs: string[];
  /**
   * Finer-grained ownership, matched against the article's topic or collection
   * tag and checked BEFORE hubs. This is how "weight lifting" is assigned
   * without giving away a whole hub.
   */
  topics?: string[];
  /**
   * Ownership by articleType, checked BEFORE topic and hub. Use for people who
   * own a FORMAT across every hub rather than a subject area.
   * Valid values are the pipeline's own slugs: buyers-guide, comparison,
   * how-to, listicle, benefit-deep-dive, brand-review.
   */
  articleTypes?: string[];
  /**
   * Hubs this person keeps no matter the article type. Beats articleTypes.
   * Used where subject knowledge should outrank format ownership.
   */
  alwaysHubs?: string[];
  /** false = no archive page exists yet, so the byline must not link out. */
  hasArchive: boolean;
  status: AuthorStatus;
};

export const AUTHORS: Author[] = [
  {
    slug: "elliott-gorfain",
    name: "Elliott Gorfain",
    role: "CEA Specialist at Green Thumb Depot",
    // Facts as stated on GTD's consulting page. Do not add to them.
    bio:
      "Elliott is Green Thumb Depot's CEA specialist, with 27 years of CEA growing experience and 10 years of commercial CEA consulting. He holds a B.S. in Molecular Biology and has worked at Hydrofarm, Greencoast, Hanna Instruments and Impello.",
    initials: "EG",
    // Catch-all: every article that is not claimed by a business topic below.
    hubs: [],
    hasArchive: false,
    status: "active",
  },
  {
    slug: "james-ruhle",
    name: "James Ruhle",
    role: "", // TODO confirm with James. A real role only.
    bio: "", // TODO 25 to 40 words, confirmed by James.
    initials: "JR",
    hubs: [],
    // Business content. Matched against the article's topic or collection tag.
    topics: ["business", "licensing", "compliance", "financing", "roi", "facility-costs", "starting-a-grow"],
    hasArchive: false,
    // Stays planned until the role and bio above are confirmed; until then
    // business articles fall through to the catch-all byline.
    status: "planned",
  },
  {
    slug: "gtd",
    name: "Green Thumb Depot",
    role: "",
    bio:
      "Green Thumb Depot is an authorized dealer for the brands listed on its Brands page. Specifications in these guides are taken from manufacturer documentation.",
    initials: "GTD",
    hubs: [], // fallback only, see FALLBACK below
    hasArchive: false,
    status: "planned",
  },
];

const BY_SLUG = new Map(AUTHORS.map((a) => [a.slug, a]));
const FALLBACK = AUTHORS.find((a) => a.slug === "gtd")!;

const active = () => AUTHORS.filter((a) => a.status === "active");

/** Author archive URL, or null when there is no page to link to yet. */
export function authorUrl(a: Author): string | null {
  return a.hasArchive ? `/blogs/guides/tagged/author-${a.slug}` : null;
}

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "-");

/**
 * Pick the byline. Most specific match wins:
 *   locked hub  ->  articleType  ->  topic  ->  hub  ->  catch-all  ->  GTD team
 * Planned authors are skipped entirely, so nothing appears before its bio is
 * confirmed. Regeneration is stable: the same article always resolves the same
 * way, so a byline never silently changes between runs.
 */
export function authorForArticle(
  hub: string | null | undefined,
  slug: string,
  topics: string[] = [],
  articleType?: string | null,
): Author {
  const pool = active();
  const h = norm(hub || "");
  const t = topics.map(norm);
  const at = norm(articleType || "");

  const locked = pool.find((a) => (a.alwaysHubs || []).map(norm).includes(h));
  if (locked) return locked;

  const byType = at ? pool.find((a) => (a.articleTypes || []).map(norm).includes(at)) : undefined;
  if (byType) return byType;

  const byTopic = pool.find((a) => (a.topics || []).some((x) => t.includes(norm(x))));
  if (byTopic) return byTopic;

  const byHub = pool.find((a) => a.hubs.map(norm).includes(h));
  if (byHub) return byHub;

  const catchAll = pool.filter(
    (a) => a.hubs.length === 0 && !(a.topics || []).length && !(a.articleTypes || []).length,
  );
  if (catchAll.length === 1) return catchAll[0];
  if (catchAll.length > 1) {
    let sum = 0;
    for (let i = 0; i < slug.length; i++) sum = (sum + slug.charCodeAt(i)) % 100000;
    return catchAll[sum % catchAll.length];
  }
  return FALLBACK;
}

export function authorBySlug(slug: string): Author | undefined {
  return BY_SLUG.get(slug);
}

/** Guard for the switch-on step: an author is only publishable when complete. */
export function isPublishable(a: Author): boolean {
  return Boolean(a.name.trim() && a.bio.trim() && a.initials.trim());
}
