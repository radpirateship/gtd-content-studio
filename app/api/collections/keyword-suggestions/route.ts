// POST /api/collections/keyword-suggestions
// Scan Ahrefs for SECONDARY keyword opportunities to add to a collection.
// Pulls "matching terms" for the seed (usually the collection's primary
// keyword), drops anything already covered, and ranks by opportunity score.
//
// Body: { seed: string, exclude?: string[], limit?: number, minVolume?: number }
import { type NextRequest, NextResponse } from 'next/server'
import { matchingTerms, computeOpportunityScore } from '@/lib/ahrefs'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      seed?: string
      exclude?: string[]
      limit?: number
      minVolume?: number
    }
    const seed = (body.seed || '').trim()
    if (!seed) {
      return NextResponse.json({ error: 'seed keyword is required' }, { status: 400 })
    }
    if (!process.env.AHREFS_API_KEY) {
      return NextResponse.json(
        { error: 'AHREFS_API_KEY not configured — add it in Vercel and redeploy.' },
        { status: 400 }
      )
    }

    // Exclude the seed and anything already on the collection (case-insensitive).
    const exclude = new Set((body.exclude || []).map((k) => k.toLowerCase().trim()).filter(Boolean))
    exclude.add(seed.toLowerCase())

    const terms = await matchingTerms(seed, {
      limit: body.limit ?? 50,
      minVolume: body.minVolume ?? 50,
    })

    const suggestions = terms
      .filter((t) => !exclude.has(t.keyword.toLowerCase().trim()))
      .map((t) => ({
        keyword: t.keyword,
        volume: t.volume,
        difficulty: t.difficulty,
        traffic_potential: t.traffic_potential,
        opportunity: computeOpportunityScore(t),
      }))
      .sort((a, b) => b.opportunity - a.opportunity)

    return NextResponse.json({ ok: true, seed, count: suggestions.length, suggestions })
  } catch (err) {
    console.error('[collections/keyword-suggestions]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Keyword scan failed' },
      { status: 500 }
    )
  }
}
