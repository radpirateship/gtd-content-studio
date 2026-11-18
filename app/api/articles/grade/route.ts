// GET /api/articles/grade — SCOPED content quality grading.
// Grades on demand, never the whole catalog at once:
//   ?handle=<handle>  or  ?id=<id>   → grade ONE article (fast, accurate)
//   ?collection=<slug-or-label>      → grade one collection / brand group
// Each article is graded against:
//   1) Brand/writing rules via lib/brandRules.validateBrandRules — em-dashes,
//      banned phrases, naming violations (same engine enforced at generation).
//   2) Completeness — featured image, in-body images, internal links, featured
//      products, FAQ, meta description.
import { type NextRequest, NextResponse } from "next/server";
import { validateBrandRules } from "@/lib/brandRules";
import { CATEGORY_LABELS } from "@/lib/collections";
import {
  fetchAdminArticleByHandle,
  fetchAdminArticleById,
  searchAdminArticles,
  type AdminArticleResult,
} from "@/lib/shopify/blog-admin";

export const maxDuration = 120;

function gradeArticle(a: AdminArticleResult) {
  const body = a.body_html || "";
  const brand = validateBrandRules(body);

  const internalLinkCount = (body.match(/href=["'](?:https?:\/\/(?:www\.)?peakprimalwellness\.com)?\/blogs\/[^"']+/gi) || []).length;
  const missing = {
    featuredImage: !a.image?.src,
    contentImages: !/<img/i.test(body),
    internalLinks: internalLinkCount === 0,
    products: !/ppw-card|ppw-product|ppw-featured-products/i.test(body),
    faq: !/<details|ppw-faq/i.test(body),
    meta: !(a.summary_html && a.summary_html.trim().length > 0),
  };
  const missingCount = Object.values(missing).filter(Boolean).length;

  // Brand violations weigh heavier than missing enrichments.
  const severity =
    brand.emDashCount +
    brand.bannedPhrasesFound.length * 2 +
    brand.namingViolations.length * 2 +
    missingCount;

  return {
    id: a.legacy_id,
    title: a.title,
    handle: a.handle,
    url: a.online_store_url,
    tags: a.tags,
    severity,
    brand: {
      passed: brand.passed,
      emDashCount: brand.emDashCount,
      bannedPhrases: brand.bannedPhrasesFound,
      namingViolations: brand.namingViolations,
    },
    missing,
    missingCount,
  };
}

function buildSummary(graded: ReturnType<typeof gradeArticle>[]) {
  return {
    total: graded.length,
    flagged: graded.filter((g) => g.severity > 0).length,
    withEmDashes: graded.filter((g) => g.brand.emDashCount > 0).length,
    withBannedPhrases: graded.filter((g) => g.brand.bannedPhrases.length > 0).length,
    withNamingViolations: graded.filter((g) => g.brand.namingViolations.length > 0).length,
    missingImage: graded.filter((g) => g.missing.featuredImage).length,
    missingProducts: graded.filter((g) => g.missing.products).length,
    missingInternalLinks: graded.filter((g) => g.missing.internalLinks).length,
    missingFaq: graded.filter((g) => g.missing.faq).length,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const handle = searchParams.get("handle");
  const id = searchParams.get("id");
  const collectionParam = searchParams.get("collection") || searchParams.get("tag");

  try {
    // ── Single article ──────────────────────────────────────────────────────
    if (handle || id) {
      const art = id ? await fetchAdminArticleById(id) : await fetchAdminArticleByHandle(handle!);
      if (!art) return NextResponse.json({ error: "Article not found" }, { status: 404 });
      return NextResponse.json({ ok: true, mode: "article", article: gradeArticle(art) });
    }

    // ── One collection / brand group ────────────────────────────────────────
    if (collectionParam) {
      // Accept a slug ("saunas") or a label ("Saunas"); articles are tagged with
      // the label, so resolve a slug to its label for the tag filter.
      const tag = (CATEGORY_LABELS as Record<string, string>)[collectionParam] || collectionParam;
      const arts = await searchAdminArticles({ tag, limit: 250 });
      const graded = arts.map(gradeArticle).sort((a, b) => b.severity - a.severity);
      return NextResponse.json({
        ok: true,
        mode: "collection",
        collection: collectionParam,
        tag,
        summary: buildSummary(graded),
        articles: graded,
      });
    }

    return NextResponse.json(
      { error: "Provide a scope: ?handle=, ?id=, or ?collection=" },
      { status: 400 }
    );
  } catch (err) {
    console.error("[articles/grade]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grade failed" }, { status: 500 });
  }
}
