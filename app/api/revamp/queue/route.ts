// POST /api/revamp/queue
// Bulk queue actions for the revamp backlog. The backlog view sends the
// slugs currently selected (typically "select all" over a filtered segment)
// and one action; every effect is idempotent so re-queueing the same set is
// harmless.
//
// Actions:
//   queue    - mark ready for revamp: tracking status 'ready', priority and
//              reason set, opened_for_revamp_at stamped, revamp mode stored
//              on content_health. Optionally creates content_brain rows for
//              slugs that have none, so the batch generator has inputs.
//   unqueue  - back to 'triaged', clears opened_for_revamp_at.
//   skip     - status 'skipped' (out of the queue, stays in the corpus).
//
// Body: {
//   slugs: string[],                       // required, max 500
//   action?: "queue" | "unqueue" | "skip", // default "queue"
//   priority?: "low" | "normal" | "high",
//   revampReason?: string,
//   mode?: "keep-images" | "full-regen" | "combine" | "delete",
//   ensureBrainRows?: boolean              // default true on "queue"
// }
import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { reportError } from "@/lib/reportError";

export const runtime = "nodejs";
export const maxDuration = 120;

const ACTIONS = new Set(["queue", "unqueue", "skip"]);
const PRIORITIES = new Set(["low", "normal", "high"]);
const MODES = new Set(["keep-images", "full-regen", "combine", "delete"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawSlugs: string[] = Array.isArray(body.slugs)
      ? body.slugs.map((s: unknown) => String(s || "").trim()).filter((s: string) => s.length > 0)
      : [];
    const slugs: string[] = Array.from(new Set(rawSlugs));
    if (!slugs.length) {
      return NextResponse.json({ error: "slugs is required" }, { status: 400 });
    }
    if (slugs.length > 500) {
      return NextResponse.json({ error: "Too many slugs in one call (max 500)" }, { status: 400 });
    }

    const action = ACTIONS.has(body.action) ? String(body.action) : "queue";
    const priority = PRIORITIES.has(body.priority) ? String(body.priority) : null;
    const mode = MODES.has(body.mode) ? String(body.mode) : null;
    const revampReason = typeof body.revampReason === "string" && body.revampReason.trim()
      ? body.revampReason.trim()
      : null;
    const ensureBrainRows = action === "queue" && body.ensureBrainRows !== false;
    // Timestamps must be values, never SQL text in a parameter slot.
    const openedAt = action === "queue" ? new Date().toISOString() : null;

    const sql = getSQL();
    const nextStatus = action === "queue" ? "ready" : action === "skip" ? "skipped" : "triaged";

    // Done is done: a post already revamped or published is never pulled back
    // into the queue by a bulk select, because select-all on a filtered view
    // includes rows that have already been through the pipeline. Re-running one
    // has to be deliberate, which is what force is for.
    let alreadyDone: string[] = [];
    let unpublished: string[] = [];
    let targetSlugs = slugs;

    // A Shopify draft is not a revamp candidate. It is not on the site, so
    // rewriting it burns a generation and leaves tracking claiming "revamped"
    // for a URL that 404s. 36 hydrogen-water drafts went through the pipeline
    // this way before this guard existed. force bypasses it deliberately.
    if (action === "queue" && body.force !== true) {
      const drafts = (await sql`
        SELECT slug FROM blog_post_tracking
        WHERE slug = ANY(${slugs}::text[]) AND shopify_published_at IS NULL
      `) as { slug: string }[];
      unpublished = drafts.map((d) => String(d.slug));
      if (unpublished.length) {
        const skip = new Set(unpublished);
        targetSlugs = targetSlugs.filter((s) => !skip.has(s));
      }
      if (!targetSlugs.length) {
        return NextResponse.json({
          ok: true,
          action,
          requested: slugs.length,
          updated: 0,
          alreadyDone: 0,
          unpublished: unpublished.length,
          modeApplied: 0,
          brainRowsCreated: 0,
          status: nextStatus,
          message: "Every selected post is an unpublished Shopify draft, so none were queued.",
        });
      }
    }
    if (action === "queue" && body.force !== true) {
      const done = (await sql`
        SELECT slug FROM blog_post_tracking
        WHERE slug = ANY(${slugs}::text[]) AND status IN ('revamped', 'published')
      `) as { slug: string }[];
      alreadyDone = done.map((d) => String(d.slug));
      if (alreadyDone.length) {
        const skip = new Set(alreadyDone);
        targetSlugs = targetSlugs.filter((s) => !skip.has(s));
      }
      if (!targetSlugs.length) {
        return NextResponse.json({
          ok: true,
          action,
          requested: slugs.length,
          updated: 0,
          alreadyDone: alreadyDone.length,
          modeApplied: 0,
          brainRowsCreated: 0,
          status: nextStatus,
          message: "Every selected post has already been revamped or published.",
        });
      }
    }

    // Tracking rows: the queue itself. A slug with no tracking row gets one,
    // so a post discovered outside the importer can still be queued.
    const updated = await sql`
      INSERT INTO blog_post_tracking (slug, status, priority, revamp_reason, opened_for_revamp_at, updated_at)
      SELECT s, ${nextStatus}::text,
             COALESCE(${priority}::text, 'normal'),
             ${revampReason}::text,
             ${openedAt}::timestamptz,
             NOW()
      FROM unnest(${targetSlugs}::text[]) AS s
      ON CONFLICT (slug) DO UPDATE SET
        status = EXCLUDED.status,
        priority = COALESCE(${priority}::text, blog_post_tracking.priority),
        revamp_reason = COALESCE(${revampReason}::text, blog_post_tracking.revamp_reason),
        opened_for_revamp_at = ${openedAt}::timestamptz,
        updated_at = NOW()
      RETURNING slug
    `;

    // Revamp mode lives on the health row, because it is an audit decision
    // ("keep this post's images") rather than a workflow state.
    let modeApplied = 0;
    if (mode) {
      try {
        await sql`ALTER TABLE content_health ADD COLUMN IF NOT EXISTS revamp_mode TEXT`;
        const r = await sql`
          UPDATE content_health
          SET revamp_mode = ${mode}::text, reviewed_at = NOW(), updated_at = NOW()
          WHERE slug = ANY(${targetSlugs}::text[])
          RETURNING slug
        `;
        modeApplied = r.length;
      } catch (modeErr) {
        console.warn("[revamp/queue] mode write failed:", modeErr);
      }
    }

    // Content brain rows: the generator's inputs. Most tracked slugs already
    // have one from the Shopify import; only the orphans need creating, and
    // an existing row is never overwritten (its brief may be hand-edited).
    let brainRowsCreated = 0;
    if (ensureBrainRows) {
      try {
        const created = await sql`
          INSERT INTO content_brain (title, keyword, collection, collection_slug, url_slug, status, traffic_light, source, notes)
          SELECT
            COALESCE(NULLIF(tr.current_title, ''), initcap(replace(tr.slug, '-', ' '))),
            NULLIF(replace(tr.slug, '-', ' '), ''),
            NULLIF(tr.category, ''),
            NULLIF(tr.category, ''),
            tr.slug,
            'in-queue',
            'unvetted',
            'revamp-queue',
            'Created by the revamp queue for an existing published post. Slug must not change.'
          FROM blog_post_tracking tr
          WHERE tr.slug = ANY(${targetSlugs}::text[])
            AND NOT EXISTS (SELECT 1 FROM content_brain cb WHERE cb.url_slug = tr.slug)
          RETURNING id
        `;
        brainRowsCreated = created.length;
      } catch (brainErr) {
        console.warn("[revamp/queue] brain row creation failed:", brainErr);
      }
    }

    return NextResponse.json({
      ok: true,
      action,
      requested: slugs.length,
      updated: updated.length,
      alreadyDone: alreadyDone.length,
      unpublished: unpublished.length,
      modeApplied,
      brainRowsCreated,
      status: nextStatus,
    });
  } catch (error) {
    reportError(error, { route: "//api/revamp/queue", method: "POST" });
    console.error("[revamp/queue]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Queue update failed" },
      { status: 500 }
    );
  }
}
