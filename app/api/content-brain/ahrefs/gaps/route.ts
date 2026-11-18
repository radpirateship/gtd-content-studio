// app/api/content-brain/ahrefs/gaps/route.ts
// Finds keyword gaps for a cluster: pulls matching terms from Ahrefs for a
// seed keyword, filters out anything we already cover in content_brain, and
// returns the remaining opportunities ranked by opportunity_score.
//
// POST { seed: "infrared sauna", cluster_group?: "Infrared Saunas", limit?: 50 }
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { matchingTerms, computeOpportunityScore } from '@/lib/ahrefs'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      seed?: string
      cluster_group?: string
      hub?: string
      limit?: number
      min_volume?: number
    }
    if (!body.seed) {
      return NextResponse.json({ error: 'seed keyword is required' }, { status: 400 })
    }

    const sql = getSQL()

    // Load keywords we already cover, scoped to cluster/hub if provided
    const existing = body.cluster_group
      ? ((await sql`
          SELECT LOWER(keyword) AS keyword, LOWER(title) AS title
          FROM content_brain
          WHERE cluster_group = ${body.cluster_group}
            AND (keyword IS NOT NULL OR title IS NOT NULL)
        `) as unknown as Array<{ keyword: string | null; title: string }>)
      : body.hub
      ? ((await sql`
          SELECT LOWER(keyword) AS keyword, LOWER(title) AS title
          FROM content_brain
          WHERE hub = ${body.hub}
        `) as unknown as Array<{ keyword: string | null; title: string }>)
      : ((await sql`
          SELECT LOWER(keyword) AS keyword, LOWER(title) AS title
          FROM content_brain
        `) as unknown as Array<{ keyword: string | null; title: string }>)

    const covered = new Set<string>()
    for (const r of existing) {
      if (r.keyword) covered.add(r.keyword.trim())
      if (r.title) covered.add(r.title.trim())
    }

    const terms = await matchingTerms(body.seed, {
      limit: body.limit ?? 50,
      minVolume: body.min_volume ?? 100,
    })

    const gaps = terms
      .filter((t) => {
        const kw = t.keyword.toLowerCase().trim()
        if (covered.has(kw)) return false
        // Also skip if any covered title contains this keyword as a substring
        for (const c of covered) {
          if (c.includes(kw) || kw.includes(c)) return false
        }
        return true
      })
      .map((t) => ({
        ...t,
        opportunity_score: computeOpportunityScore(t),
      }))
      .sort((a, b) => b.opportunity_score - a.opportunity_score)

    return NextResponse.json({
      ok: true,
      seed: body.seed,
      scope: body.cluster_group || body.hub || 'all',
      total_terms: terms.length,
      covered_count: existing.length,
      gaps_count: gaps.length,
      gaps,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
