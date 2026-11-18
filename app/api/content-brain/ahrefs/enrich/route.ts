// app/api/content-brain/ahrefs/enrich/route.ts
// Enriches content_brain rows with live Ahrefs data: volume, difficulty,
// traffic potential, and a computed opportunity_score.
//
// POST { ids?: number[] }  — enrich only these ids
// POST { hub?: string }    — enrich all rows in a hub that have a keyword
// POST { stale_hours?: 168 } — only enrich rows not enriched in the last N hours
//
// Changed 2026-08-27: dropped the matching-terms discovery call. It used to pull
// candidate keywords per row and pick the best-scoring one (~634 units/call vs
// ~50 for a plain overview lookup) — across the account this was the single
// largest source of Ahrefs usage of any endpoint, anywhere. Ryan already vets
// the keyword before rows reach Content Brain, so this now just confirms
// volume/difficulty for the seed already on the row (or derived from the
// title) via one overview call. No more "better keyword" auto-swap.
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { keywordOverview, computeOpportunityScore, deriveSeedKeyword } from '@/lib/ahrefs'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      ids?: number[]
      hub?: string
      stale_hours?: number
      limit?: number
    }
    const sql = getSQL()

    const limit = Math.min(body.limit ?? 50, 200)

    let targets: Array<{ id: number; keyword: string | null; title: string }> = []
    if (body.ids && body.ids.length) {
      targets = (await sql`
        SELECT id, keyword, title FROM content_brain
        WHERE id = ANY(${body.ids})
      `) as unknown as typeof targets
    } else if (body.hub) {
      targets = (await sql`
        SELECT id, keyword, title FROM content_brain
        WHERE hub = ${body.hub}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `) as unknown as typeof targets
    } else {
      const staleHours = body.stale_hours ?? 168
      targets = (await sql`
        SELECT id, keyword, title FROM content_brain
        WHERE (ahrefs_last_enriched_at IS NULL
               OR ahrefs_last_enriched_at < NOW() - (${staleHours} || ' hours')::interval)
        ORDER BY ahrefs_last_enriched_at NULLS FIRST
        LIMIT ${limit}
      `) as unknown as typeof targets
    }

    let enriched = 0
    const errors: string[] = []

    for (const row of targets) {
      // Seed derivation: prefer an existing short keyword (<=6 words, typical
      // real search phrase). If it's empty or looks like a full title, fall
      // back to deriveSeedKeyword(title) which strips openers + stopwords.
      const rawKw = (row.keyword || '').trim()
      const kwLooksLikeTitle = rawKw.split(/\s+/).length > 6
      const seed = rawKw && !kwLooksLikeTitle ? rawKw : deriveSeedKeyword(row.title)
      if (!seed) {
        errors.push(`#${row.id}: no seed derivable`)
        continue
      }

      try {
        // Single keyword-volume lookup on the seed — no matching-terms discovery pass.
        const ov = await keywordOverview(seed)
        if (ov.volume == null) {
          errors.push(`#${row.id}: Ahrefs returned nothing for "${seed}"`)
          continue
        }

        const opportunity_score = computeOpportunityScore(ov)

        await sql`
          UPDATE content_brain
          SET keyword = ${ov.keyword},
              kw_volume = ${ov.volume},
              kw_difficulty = ${ov.difficulty},
              traffic_potential = ${ov.traffic_potential},
              opportunity_score = ${opportunity_score},
              ahrefs_last_enriched_at = NOW(),
              updated_at = NOW()
          WHERE id = ${row.id}
        `
        enriched++
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown'
        errors.push(`#${row.id} ${row.title}: ${msg}`)
      }
    }

    return NextResponse.json({
      ok: true,
      enriched,
      attempted: targets.length,
      error_count: errors.length,
      errors: errors.slice(0, 10),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
