/**
 * Vendors the generator does not feature on GENERAL articles. Still sold,
 * still linkable by hand, and still picked when the article is actually
 * about them: a brand review that names the vendor in targetBrand, or a
 * title, keyword or sub-collection that names their product type.
 *
 * Why: BenchK wall bars carry "home gym" and "fitness" in every title, so
 * keyword scoring put two of them in nearly every home gym article. On a
 * "how to build a home gym" piece GTD wants the higher-end machines on the
 * cards. On a Swedish ladder article BenchK is the subject and belongs.
 *
 * Extend in Vercel without a code change:
 *   PRODUCT_PICK_EXCLUDE_VENDORS="Vendor A:term one|term two,Vendor B"
 * Terms after the colon lift the exclusion when they appear in the article
 * context; a vendor with no terms is lifted only by its own name.
 */
type Exclusion = { vendor: string; unless: string[] };

// Empty by default since the picker moved to one product per vendor, which
// solved the four-Swedish-ladders problem without banning anyone. The
// mechanism stays for the env var below.
const BUILT_IN: Exclusion[] = [];

function parseEnv(raw: string): Exclusion[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [vendor, terms = ""] = entry.split(":");
      return { vendor: vendor.trim(), unless: terms.split("|").map((t) => t.trim()).filter(Boolean) };
    })
    .filter((e) => e.vendor);
}

export const EXCLUSIONS: readonly Exclusion[] = [
  ...BUILT_IN,
  ...parseEnv(String(process.env.PRODUCT_PICK_EXCLUDE_VENDORS || "")),
].map((e) => ({ vendor: e.vendor.toLowerCase(), unless: e.unless.map((t) => t.toLowerCase()) }));

export const EXCLUDED_VENDORS: ReadonlySet<string> = new Set(EXCLUSIONS.map((e) => e.vendor));

const norm = (s: string) => String(s || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

/** Vendors whose exclusion is lifted by this article's context (title, keyword, brand, sub-collection, instructions). */
export function liftedVendors(context: { title?: string | null; keyword?: string | null; brand?: string | null; subcollection?: string | null; collection?: string | null; instructions?: string | null }): Set<string> {
  const text = norm(
    [context.title, context.keyword, context.brand, context.subcollection, context.collection, context.instructions]
      .filter(Boolean)
      .join(" \n "),
  );
  const lifted = new Set<string>();
  if (!text) return lifted;
  for (const e of EXCLUSIONS) {
    if (text.includes(e.vendor)) { lifted.add(e.vendor); continue; }
    // "swedish ladder" should also match "swedish ladders"; test the
    // singular stem of the last word.
    if (e.unless.some((t) => text.includes(t) || text.includes(t.replace(/s?$/, "")))) lifted.add(e.vendor);
  }
  return lifted;
}

/** Case-insensitive on vendor, and on the start of the title for imports with no vendor column. */
export function isExcludedVendor(
  p: { vendor?: string | null; title?: string | null },
  lifted: ReadonlySet<string> = new Set(),
): boolean {
  const vendor = norm(p.vendor || "");
  const title = norm(p.title || "");
  for (const v of EXCLUDED_VENDORS) {
    if (lifted.has(v)) continue;
    if (vendor === v || vendor.startsWith(v + " ") || title.startsWith(v + " ")) return true;
  }
  return false;
}
