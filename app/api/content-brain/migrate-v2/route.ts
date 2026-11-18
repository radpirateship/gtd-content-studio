// app/api/content-brain/migrate-v2/route.ts
// Additive migration: extends content_brain with canvas/ahrefs-era columns,
// and creates a content_brain_pillars table for the mind-map hierarchy.
// Idempotent — safe to re-run.
import { NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

export async function POST() {
  const sql = getSQL()
  try {
    // 1. Extend content_brain with new fields
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS pillar_id INTEGER`
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS intent TEXT`
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS strategic_notes TEXT`
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS opportunity_score NUMERIC`
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS internal_link_targets JSONB`
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS ahrefs_last_enriched_at TIMESTAMPTZ`

    // 2. Pillars table — the mid-tier of the Hub → Pillar → Cluster → Article hierarchy
    await sql`
      CREATE TABLE IF NOT EXISTS content_brain_pillars (
        id         SERIAL PRIMARY KEY,
        hub        TEXT NOT NULL,
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL,
        cluster_slug TEXT,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(hub, slug)
      )
    `

    // 3. Helpful indexes for canvas queries
    await sql`CREATE INDEX IF NOT EXISTS idx_content_brain_hub ON content_brain(hub)`
    await sql`CREATE INDEX IF NOT EXISTS idx_content_brain_cluster ON content_brain(cluster_group)`
    await sql`CREATE INDEX IF NOT EXISTS idx_content_brain_status ON content_brain(status)`
    await sql`CREATE INDEX IF NOT EXISTS idx_content_brain_pillar ON content_brain(pillar_id)`

    const [{ count: ideas }] = await sql`SELECT COUNT(*)::int AS count FROM content_brain`
    const [{ count: pillars }] = await sql`SELECT COUNT(*)::int AS count FROM content_brain_pillars`

    return NextResponse.json({
      ok: true,
      migration: 'v2',
      added_columns: [
        'pillar_id',
        'intent',
        'strategic_notes',
        'opportunity_score',
        'internal_link_targets',
        'ahrefs_last_enriched_at',
      ],
      new_tables: ['content_brain_pillars'],
      counts: { ideas, pillars },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ hint: 'POST to run migration v2' })
}
