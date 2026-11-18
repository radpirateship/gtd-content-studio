// app/api/content-brain/seed/route.ts
// Ingests the baked-in seed JSON (lib/contentBrainSeed.json — 543 rows parsed
// from Ryan's 3 master xlsx planning files) into the content_brain table.
//
// Idempotent by (title, cluster_group): if a row with the same title+cluster
// already exists, it is skipped. POST {force:true} to wipe all source='tap-import'
// rows first and re-seed from scratch.
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import seed from '@/lib/contentBrainSeed.json'

interface SeedRow {
  title: string
  keyword: string | null
  hub: string | null
  cluster_group: string | null
  collection: string | null
  collection_slug: string | null
  content_type: string
  article_type: string | null
  audience: string | null
  tone: string | null
  word_count: number | null
  intent: string | null
  priority: string | null
  status: string
  traffic_light: string
  source: string
  strategic_notes: string | null
  kw_volume: number | null
  kw_difficulty: number | null
  traffic_potential: number | null
  url_slug: string | null
  special_instructions: string | null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { force?: boolean }
    const sql = getSQL()

    if (body.force) {
      await sql`DELETE FROM content_brain WHERE source = 'tap-import'`
    }

    // Build a set of existing (title|cluster) keys so we can skip dupes
    const existing = (await sql`
      SELECT title, cluster_group FROM content_brain
    `) as unknown as Array<{ title: string; cluster_group: string | null }>
    const existingKeys = new Set(
      existing.map((r) => `${r.title}||${r.cluster_group || ''}`)
    )

    const rows = seed as SeedRow[]
    let inserted = 0
    let skipped = 0
    const errors: string[] = []

    for (const r of rows) {
      const key = `${r.title}||${r.cluster_group || ''}`
      if (existingKeys.has(key)) {
        skipped++
        continue
      }
      try {
        await sql`
          INSERT INTO content_brain (
            title, keyword, hub, cluster_group, collection, collection_slug,
            content_type, article_type, audience, tone, word_count,
            intent, strategic_notes, priority, status, traffic_light, source,
            kw_volume, kw_difficulty, traffic_potential, url_slug, special_instructions
          ) VALUES (
            ${r.title}, ${r.keyword}, ${r.hub}, ${r.cluster_group},
            ${r.collection}, ${r.collection_slug}, ${r.content_type}, ${r.article_type},
            ${r.audience}, ${r.tone}, ${r.word_count || 2500},
            ${r.intent}, ${r.strategic_notes}, ${r.priority}, ${r.status}, ${r.traffic_light},
            ${r.source}, ${r.kw_volume}, ${r.kw_difficulty}, ${r.traffic_potential},
            ${r.url_slug}, ${r.special_instructions}
          )
        `
        existingKeys.add(key)
        inserted++
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown'
        errors.push(`${r.title}: ${msg}`)
      }
    }

    // Summary counts by hub / status for verification
    const byHub = (await sql`
      SELECT hub, COUNT(*)::int AS count
      FROM content_brain
      GROUP BY hub
      ORDER BY count DESC
    `) as unknown as Array<{ hub: string; count: number }>

    return NextResponse.json({
      ok: true,
      total_in_seed: rows.length,
      inserted,
      skipped,
      error_count: errors.length,
      errors: errors.slice(0, 10),
      by_hub: byHub,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    hint: 'POST to ingest lib/contentBrainSeed.json. POST {"force":true} to wipe tap-import rows and re-seed.',
    seed_row_count: (seed as SeedRow[]).length,
  })
}
