// lib/ensureCollectionColumns.ts
// Idempotent, self-healing schema guard for gtd_collections. Cheap to call
// (ADD COLUMN IF NOT EXISTS is a no-op once columns exist) and guarantees the
// ultimate-guide + audit-score columns are present, so PATCH saves and the
// catalog audit can never fail on a missing column.
//
// 2026-08-11: added the research + sync columns that previously only existed in
// GTD_Complete_Collection_Optimization.xlsx, plus the Shopify-synced facts
// (tags, product_count, rule_summary, is_published) needed for the collection
// detail panel and the CSV round-trip.
import { getSQL } from './db'

let ensured = false

export async function ensureCollectionColumns(sql: ReturnType<typeof getSQL>) {
  if (ensured) return // once per warm lambda is enough
  await sql`
    ALTER TABLE gtd_collections
      ADD COLUMN IF NOT EXISTS ultimate_guide_title TEXT,
      ADD COLUMN IF NOT EXISTS ultimate_guide_url   TEXT,
      ADD COLUMN IF NOT EXISTS score                INTEGER,
      ADD COLUMN IF NOT EXISTS audit_fail_count     INTEGER,
      ADD COLUMN IF NOT EXISTS audit_warn_count     INTEGER,
      ADD COLUMN IF NOT EXISTS audit_top_issues     JSONB,
      ADD COLUMN IF NOT EXISTS audited_at           TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS word_count           INTEGER,
      ADD COLUMN IF NOT EXISTS improve_notes        JSONB,
      ADD COLUMN IF NOT EXISTS is_hidden            BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS featured_handles     TEXT[],

      -- Keyword research (previously spreadsheet-only)
      ADD COLUMN IF NOT EXISTS current_position     TEXT,
      ADD COLUMN IF NOT EXISTS current_impressions  INTEGER,
      ADD COLUMN IF NOT EXISTS estimated_impact     TEXT,
      ADD COLUMN IF NOT EXISTS status               TEXT,
      ADD COLUMN IF NOT EXISTS keywords_updated_at  TIMESTAMPTZ,

      -- Synced from Shopify so the detail panel can show routing without a live call
      ADD COLUMN IF NOT EXISTS tags                 TEXT[],
      ADD COLUMN IF NOT EXISTS rule_summary         TEXT,
      ADD COLUMN IF NOT EXISTS product_count        INTEGER,
      ADD COLUMN IF NOT EXISTS is_published         BOOLEAN,
      ADD COLUMN IF NOT EXISTS last_synced_at       TIMESTAMPTZ
  `
  // Filter and sort the queue without a full table scan at 270+ rows.
  await sql`CREATE INDEX IF NOT EXISTS gtd_collections_category_idx ON gtd_collections (category)`
  await sql`CREATE INDEX IF NOT EXISTS gtd_collections_volume_idx   ON gtd_collections (search_volume DESC NULLS LAST)`
  ensured = true
}
