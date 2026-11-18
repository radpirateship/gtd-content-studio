import { NextRequest } from "next/server";
import { getSQL } from "@/lib/db";
import { ensureGradeColumns } from "@/lib/ensureGradeColumns";
import { apiError, apiList, apiSuccess } from "@/lib/api-response";
import { revampBacklogPatchSchema } from "@/lib/api-schemas";
import { parseAndValidateJson } from "@/lib/api-utils";
import { reportError } from "@/lib/reportError";

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function asTimestamp(value: unknown) {
  return typeof value === "string" ? value : null;
}

export async function GET(request: NextRequest) {
  try {
    const sql = getSQL();
    await ensureGradeColumns();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const priority = searchParams.get("priority");
    const revampReason = searchParams.get("revampReason");
    const search = searchParams.get("search")?.trim().toLowerCase() || "";
    const sort = searchParams.get("sort") || "clicks";
    const excludeCompleted = searchParams.get("excludeCompleted") === "true";
    const gradeIssue = searchParams.get("gradeIssue"); // failure id, "low-score", or "no-collection-links"
    const segment = searchParams.get("segment"); // content_health audit segment (A-protect, B-refresh, ...)
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "200", 10) || 200, 1), 1000);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);
    // Unpublished Shopify drafts are never revamp candidates: they are not on the site,
    // so rewriting them burns a generation and marks tracking "revamped" for a dead URL.
    // Pass includeUnpublished=true to see them deliberately (audit views).
    const includeUnpublished = searchParams.get("includeUnpublished") === "true";

    const rows = await sql`
      SELECT
        COALESCE(tr.slug, bp.slug) AS slug,
        bp.url,
        bp.category AS imported_category,
        bp.clicks,
        bp.impressions,
        bp.ctr,
        bp.position,
        bp.created_at AS blog_post_created_at,
        tr.source_url,
        tr.current_title,
        tr.category AS tracked_category,
        tr.shopify_article_id,
        tr.shopify_published_at,
        tr.shopify_updated_at,
        tr.has_image,
        tr.has_content_images,
        tr.has_internal_links,
        tr.has_products,
        tr.has_faq,
        tr.status,
        tr.priority,
        tr.revamp_reason,
        tr.notes,
        tr.last_reviewed_at,
        tr.last_imported_at,
        tr.last_shopify_sync_at,
        tr.opened_for_revamp_at,
        tr.published_at,
        tr.latest_revamp_article_id,
        tr.updated_at,
        tr.grade_score,
        tr.grade_failures,
        tr.collection_links,
        tr.voice_score,
        tr.graded_at
      FROM blog_post_tracking tr
      LEFT JOIN blog_posts bp ON tr.slug = bp.slug
    `;

    // Audit layer: content_health is the per-slug home of the corpus audit
    // (segment, cannibalization, index status, AI-tell metrics). It may not
    // exist on a fresh database, so its absence degrades to empty data.
    type HealthRow = {
      slug: string; segment: string | null; era: string | null;
      em_dashes: number | null; ai_tells: number | null;
      images_keepable: boolean | null; cluster_id: number | null;
      cannibal_queries: number | null; cannibal_imp_at_stake: number | null;
      cannibal_partners: string | null; index_status: string | null;
      flag: string | null; flag_reason: string | null;
    };
    const healthBySlug = new Map<string, HealthRow>();
    try {
      const healthRows = (await sql`
        SELECT slug, segment, era, em_dashes, ai_tells, images_keepable, cluster_id,
               cannibal_queries, cannibal_imp_at_stake, cannibal_partners, index_status,
               flag, flag_reason
        FROM content_health
      `) as HealthRow[];
      for (const h of healthRows) healthBySlug.set(String(h.slug), h);
    } catch {
      /* table not created yet; every post reports empty health */
    }

    const filtered = rows
      .map((row) => {
        const slug = String(row.slug || "");
        const title = String(row.current_title || "") || slugToTitle(slug);
        const effectiveCategory = String(row.tracked_category || row.imported_category || "");
        return {
          slug,
          title,
          sourceUrl: String(row.source_url || row.url || ""),
          category: effectiveCategory,
          clicks: asNumber(row.clicks),
          impressions: asNumber(row.impressions),
          ctr: asNumber(row.ctr),
          position: asNumber(row.position),
          status: String(row.status || "new"),
          priority: String(row.priority || "normal"),
          revampReason: row.revamp_reason ? String(row.revamp_reason) : null,
          notes: row.notes ? String(row.notes) : null,
          lastReviewedAt: asTimestamp(row.last_reviewed_at),
          lastImportedAt: asTimestamp(row.last_imported_at || row.blog_post_created_at),
          lastShopifySyncAt: asTimestamp(row.last_shopify_sync_at),
          openedForRevampAt: asTimestamp(row.opened_for_revamp_at),
          publishedAt: asTimestamp(row.published_at),
          latestRevampArticleId: row.latest_revamp_article_id ? String(row.latest_revamp_article_id) : null,
          shopifyArticleId: row.shopify_article_id ? asNumber(row.shopify_article_id) : null,
          shopifyPublishedAt: asTimestamp(row.shopify_published_at),
          shopifyUpdatedAt: asTimestamp(row.shopify_updated_at),
          hasImage: asBoolean(row.has_image),
          hasContentImages: asBoolean(row.has_content_images),
          hasInternalLinks: asBoolean(row.has_internal_links),
          hasProducts: asBoolean(row.has_products),
          hasFaq: asBoolean(row.has_faq),
          updatedAt: asTimestamp(row.updated_at),
          gradeScore: row.grade_score === null || row.grade_score === undefined ? null : asNumber(row.grade_score),
          gradeFailures: row.grade_failures ? String(row.grade_failures).split(",").filter(Boolean) : [],
          collectionLinks: row.collection_links === null || row.collection_links === undefined ? null : asNumber(row.collection_links),
          voiceScore: row.voice_score === null || row.voice_score === undefined ? null : asNumber(row.voice_score),
          gradedAt: asTimestamp(row.graded_at),
          ...(function healthOf() {
            const h = healthBySlug.get(slug);
            return {
              segment: h?.segment || null,
              era: h?.era || null,
              emDashes: h?.em_dashes ?? null,
              aiTells: h?.ai_tells ?? null,
              imagesKeepable: h?.images_keepable ?? null,
              clusterId: h?.cluster_id ?? null,
              cannibalQueries: h?.cannibal_queries ?? 0,
              cannibalImpAtStake: h?.cannibal_imp_at_stake ?? 0,
              cannibalPartners: h?.cannibal_partners || null,
              indexStatus: h?.index_status || null,
              healthFlag: h?.flag || null,
              healthFlagReason: h?.flag_reason || null,
            };
          })(),
        };
      })
      .filter((item) => {
        if (!includeUnpublished && !item.shopifyPublishedAt) return false;
        if (status && item.status !== status) return false;
        if (category && item.category !== category) return false;
        if (priority && item.priority !== priority) return false;
        if (revampReason && (item.revampReason || "") !== revampReason) return false;
        if (excludeCompleted && (item.status === "revamped" || item.status === "published")) return false;
        if (segment && item.segment !== segment) return false;
        if (gradeIssue) {
          if (gradeIssue === "low-score") {
            if (item.gradeScore === null || item.gradeScore >= 70) return false;
          } else if (gradeIssue === "no-collection-links") {
            if (item.collectionLinks === null || item.collectionLinks > 0) return false;
          } else if (!item.gradeFailures.includes(gradeIssue)) {
            return false;
          }
        }
        if (search) {
          const haystack = `${item.title} ${item.slug} ${item.sourceUrl} ${item.notes || ""} ${item.revampReason || ""}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      });

    filtered.sort((a, b) => {
      switch (sort) {
        case "grade":
          return (a.gradeScore ?? 101) - (b.gradeScore ?? 101);
        case "impressions":
          return b.impressions - a.impressions;
        case "ctr":
          return b.ctr - a.ctr;
        case "position":
          return a.position - b.position;
        case "updated": {
          const aTime = new Date(a.lastShopifySyncAt || a.lastReviewedAt || a.updatedAt || a.lastImportedAt || 0).getTime();
          const bTime = new Date(b.lastShopifySyncAt || b.lastReviewedAt || b.updatedAt || b.lastImportedAt || 0).getTime();
          return bTime - aTime;
        }
        default:
          return b.clicks - a.clicks;
      }
    });

    return apiList(filtered.slice(offset, offset + limit), filtered.length);
  } catch (error) {
    reportError(error, { route: "//api/revamp/backlog", method: "GET" });
    console.error("GET /api/revamp/backlog error:", error);
    return apiError("Failed to fetch revamp backlog", 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const parsed = await parseAndValidateJson(request, revampBacklogPatchSchema);
    if (!parsed.success) return parsed.response;

    const sql = getSQL();
    const {
      slug,
      status,
      priority,
      notes,
      revampReason,
      lastReviewedAt,
      openedForRevampAt,
      latestRevampArticleId,
      publishedAt,
    } = parsed.data;

    const existingRows = await sql`SELECT * FROM blog_post_tracking WHERE slug = ${slug} LIMIT 1`;
    const existing = existingRows[0] || null;

    const nextStatus = status ?? existing?.status ?? "new";
    const nextPriority = priority ?? existing?.priority ?? "normal";
    const nextNotes = notes !== undefined ? notes : existing?.notes ?? null;
    const nextReason = revampReason !== undefined ? revampReason : existing?.revamp_reason ?? null;
    const nextLastReviewedAt = lastReviewedAt !== undefined ? lastReviewedAt || null : existing?.last_reviewed_at ?? null;
    const nextOpenedForRevampAt = openedForRevampAt !== undefined ? openedForRevampAt || null : existing?.opened_for_revamp_at ?? null;
    const nextLatestRevampArticleId =
      latestRevampArticleId !== undefined ? latestRevampArticleId : existing?.latest_revamp_article_id ?? null;
    const nextPublishedAt = publishedAt !== undefined ? publishedAt || null : existing?.published_at ?? null;

    const [saved] = await sql`
      INSERT INTO blog_post_tracking (
        slug,
        status,
        priority,
        notes,
        revamp_reason,
        last_reviewed_at,
        opened_for_revamp_at,
        latest_revamp_article_id,
        published_at,
        updated_at
      ) VALUES (
        ${slug},
        ${nextStatus},
        ${nextPriority},
        ${nextNotes},
        ${nextReason},
        ${nextLastReviewedAt},
        ${nextOpenedForRevampAt},
        ${nextLatestRevampArticleId},
        ${nextPublishedAt},
        NOW()
      )
      ON CONFLICT (slug) DO UPDATE SET
        status = EXCLUDED.status,
        priority = EXCLUDED.priority,
        notes = EXCLUDED.notes,
        revamp_reason = EXCLUDED.revamp_reason,
        last_reviewed_at = EXCLUDED.last_reviewed_at,
        opened_for_revamp_at = EXCLUDED.opened_for_revamp_at,
        latest_revamp_article_id = EXCLUDED.latest_revamp_article_id,
        published_at = EXCLUDED.published_at,
        updated_at = NOW()
      RETURNING *
    `;

    return apiSuccess({ item: saved });
  } catch (error) {
    reportError(error, { route: "//api/revamp/backlog", method: "PATCH" });
    console.error("PATCH /api/revamp/backlog error:", error);
    return apiError("Failed to update revamp backlog item", 500);
  }
}
