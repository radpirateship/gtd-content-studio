import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

// POST /api/revamp/migrate — idempotent. Creates the full revamp backlog schema:
//   - blog_post_tracking  (per-post triage/state for the revamp backlog)
//   - blog_posts          (GSC metrics, joined into the backlog view)
//   - revamp_sources      (revamp run tracking) + missing columns backfilled
//   - activity_log        (in-app activity feed)
//   - articles            revamp columns
// Safe to run multiple times.
export async function POST() {
  try {
    const sql = getSQL();

    // --- blog_post_tracking: the core backlog table the revamp UI reads/writes.
    // import-shopify upserts ON CONFLICT (slug), so slug must be unique.
    await sql`
      CREATE TABLE IF NOT EXISTS blog_post_tracking (
        slug                     TEXT PRIMARY KEY,
        source_url               TEXT,
        current_title            TEXT,
        category                 TEXT,
        shopify_article_id       BIGINT,
        shopify_published_at     TIMESTAMPTZ,
        shopify_updated_at       TIMESTAMPTZ,
        has_image                BOOLEAN DEFAULT FALSE,
        has_content_images       BOOLEAN DEFAULT FALSE,
        has_internal_links       BOOLEAN DEFAULT FALSE,
        has_products             BOOLEAN DEFAULT FALSE,
        has_faq                  BOOLEAN DEFAULT FALSE,
        status                   TEXT,
        priority                 TEXT,
        revamp_reason            TEXT,
        notes                    TEXT,
        last_reviewed_at         TIMESTAMPTZ,
        last_imported_at         TIMESTAMPTZ,
        last_shopify_sync_at     TIMESTAMPTZ,
        opened_for_revamp_at     TIMESTAMPTZ,
        published_at             TIMESTAMPTZ,
        latest_revamp_article_id TEXT,
        created_at               TIMESTAMPTZ DEFAULT now(),
        updated_at               TIMESTAMPTZ DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_bpt_status ON blog_post_tracking (status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_bpt_category ON blog_post_tracking (category)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_bpt_shopify_article_id ON blog_post_tracking (shopify_article_id)`;

    // --- blog_posts: GSC metrics, FULL OUTER JOINed into the backlog view.
    await sql`
      CREATE TABLE IF NOT EXISTS blog_posts (
        slug        TEXT PRIMARY KEY,
        url         TEXT,
        category    TEXT,
        clicks      INTEGER DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        ctr         DOUBLE PRECISION DEFAULT 0,
        position    DOUBLE PRECISION DEFAULT 0,
        created_at  TIMESTAMPTZ DEFAULT now()
      )`;

    // --- revamp_sources: run tracking.
    await sql`
      CREATE TABLE IF NOT EXISTS revamp_sources (
        id                   SERIAL PRIMARY KEY,
        original_shopify_id  BIGINT,
        original_handle      TEXT,
        original_title       TEXT,
        original_url         TEXT,
        category             TEXT,
        keyword              TEXT,
        status               TEXT DEFAULT 'new',
        revamp_reason        TEXT,
        priority             TEXT,
        new_article_id       TEXT,
        published            BOOLEAN DEFAULT FALSE,
        analysis             JSONB,
        metadata             JSONB DEFAULT '{}'::jsonb,
        created_at           TIMESTAMPTZ DEFAULT now(),
        updated_at           TIMESTAMPTZ DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_revamp_original_shopify_id ON revamp_sources (original_shopify_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_revamp_status ON revamp_sources (status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_revamp_category ON revamp_sources (category)`;

    // Columns the analyze route writes that the original CREATE missed.
    await sql`ALTER TABLE revamp_sources ADD COLUMN IF NOT EXISTS original_slug TEXT`;
    await sql`ALTER TABLE revamp_sources ADD COLUMN IF NOT EXISTS original_content TEXT`;
    await sql`ALTER TABLE revamp_sources ADD COLUMN IF NOT EXISTS original_published_at TIMESTAMPTZ`;
    await sql`ALTER TABLE revamp_sources ADD COLUMN IF NOT EXISTS revamp_started_at TIMESTAMPTZ`;
    await sql`ALTER TABLE revamp_sources ADD COLUMN IF NOT EXISTS revamp_completed_at TIMESTAMPTZ`;

    // --- articles revamp columns.
    await sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS source_type TEXT`;
    await sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS original_shopify_id BIGINT`;
    await sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS shopify_blog_tag TEXT`;

    // --- activity_log: in-app activity feed.
    await sql`
      CREATE TABLE IF NOT EXISTS activity_log (
        id          SERIAL PRIMARY KEY,
        action      TEXT NOT NULL,
        category    TEXT,
        detail      TEXT,
        status      TEXT,
        duration_ms INTEGER,
        metadata    JSONB,
        created_at  TIMESTAMPTZ DEFAULT now()
      )`;

    return NextResponse.json({
      ok: true,
      message:
        "Revamp schema ready (blog_post_tracking, blog_posts, revamp_sources + backfilled columns, activity_log, article columns).",
    });
  } catch (err) {
    console.error("[revamp/migrate]", err);
    return NextResponse.json({ ok: false, error: "Migration failed (see logs)" }, { status: 500 });
  }
}
