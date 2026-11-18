// ============================================================================
// lib/authors.ts — the GTD authors table.
//
// STATUS (Aug 2026): four bylines are PLANNED, one is ACTIVE.
// Only "GTD team" is active, so that is what every article is bylined to today.
// The other three are defined so the wiring, hub assignment and archive links
// are already built; each switches on by setting status to "active" once its
// bio is confirmed and (for real people) they have agreed to be named.
//
// WHY THIS IS A TABLE AND NOT A PROMPT
// Bios and roles are fixed data, never generated per article. A bio written
// fresh each time drifts into invented credentials ("12 years of experience",
// "certified specialist") within a few dozen articles. Everything here must be
// verifiable: real people, real roles, real scope of work. The matching
// enforcement lives in UNSUPPORTED_CLAIMS in lib/brandRules.ts.
//
// Nothing in a bio may assert a certification, licence, qualification, or a
// years-of-experience figure. GTD's authority is that it sells, ships and
// installs this equipment as an authorized dealer. That is the claim to make.
//
// TO SWITCH ONE ON
//   1. Replace the TODO bio and role with confirmed wording.
//   2. Create the author archive page, then set hasArchive: true.
//   3. Set status: "active".
//   4. New articles pick it up automatically. Articles already published under
//      template_version = 2 keep the old byline until patched; they are
//      findable because the byline, role and bio sit in data-gtdb-slot
//      ="author.*" nodes, so a bulk pass rewrites exactly those. Version 1
//      articles are never touched.
// ============================================================================

export type AuthorStatus = "active" | "planned";

export type Author = {
  slug: string;
  name: string;
  /** Real role at GTD. Never a credential. Empty renders no role line. */
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
   * without giving away the whole Fitness hub.
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
    slug: "james-ruhle",
    name: "James Ruhle",
    role: "", // TODO confirm with James. A real role only, never a credential.
    bio: "", // TODO 25 to 40 words. What he actually works on: product selection,
             // the brands GTD is an authorized dealer for, how the catalogue is set up.
    initials: "JR",
    hubs: ["saunas", "recovery", "fitness"],
    // Fitness is owned at hub level, so cardio and strength both land here.
    // The topic list is kept as a safety net for articles tagged weight-lifting
    // that sit outside the Fitness hub or carry no hub at all.
    topics: ["weight-lifting", "strength", "strength-training", "free-weights", "racks", "benches"],
    hasArchive: false,
    status: "planned",
  },
  {
    slug: "ryan-oconnor",
    name: "Ryan O'Connor",
    // Confirmed by Ryan, Aug 2026. A real role, never a credential. Ultimate
    // guides are bylined to him through guideAuthor() in lib/guide-v2.ts; the
    // blog keeps the GTD team byline until status flips to active.
    role: "Co-Founder at GTD",
    bio:
      "Ryan co-founded Green Thumb Depot and works on the catalogue, the brands GTD is an authorized dealer for, and the guides that explain the equipment GTD sells, ships and supports.",
    initials: "RO",
    // Ownership is by FORMAT, not subject: the shopping-guide side of the
    // library, across every hub. Measured against the bulk-creation CSVs this
    // is roughly 22% of articles today (buyers-guide 14%, listicle 8%) and it
    // grows as gift and best-of guides ramp up.
    // NOTE: "gift-guide" is NOT yet a valid articleType in the pipeline. It has
    // to be added alongside buyers-guide/comparison/how-to/listicle before it
    // will ever match.
    articleTypes: ["buyers-guide", "listicle", "gift-guide"],
    hubs: [],
    topics: [],
    hasArchive: false,
    status: "planned",
  },
  {
    slug: "ops",
    name: "", // TODO the operations team member's name, once they agree to be named.
    role: "", // TODO e.g. their real operations or customer support role.
    bio: "", // TODO 25 to 40 words. The genuine angle here is daily contact with
             // buyers: what customers ask before and after purchase. Strongest
             // signal available on clinical, and entirely verifiable.
    initials: "",
    hubs: ["wellness", "clinical"],
    // Clinical stays with ops even for a buyer's guide. A clinical shopping
    // guide is more credible from the person who fields clinic buyers' calls
    // than from whoever owns the format. Delete this line to let format win.
    alwaysHubs: ["clinical"],
    hasArchive: false,
    status: "planned",
  },
  {
    slug: "gtd",
    name: "Green Thumb Depot",
    role: "",
    bio:
      "Green Thumb Depot is an authorized dealer for the brands on this page. We sell, ship and support this equipment, so the guides are written from what we handle day to day.",
    initials: "GTD",
    hubs: [], // catch-all
    hasArchive: false,
    status: "active",
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
