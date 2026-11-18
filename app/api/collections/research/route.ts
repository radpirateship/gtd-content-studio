// app/api/collections/research/route.ts
//
// POST /api/collections/research   body: { slug: string }
//
// Runs the same Ahrefs research the Revamp Tool uses, but for one row of the
// collections repository, and saves the result onto that row:
//
//   1. Pick the seed: the row's primary_keyword if it has one; otherwise the
//      brand name (for brand collections) or the collection name from the slug.
//   2. Ahrefs keyword overview  -> search_volume + kd for the seed
//   3. Ahrefs matching terms    -> top related keywords, ranked by opportunity
//   4. Save: primary_keyword (if it was empty), search_volume, kd, and the top
//      5 suggestions as secondary_keywords (only if secondaries were empty).
//
// Returns the full suggestion list so the UI can offer better primaries, e.g.
// when "heat therapy" turns out weaker than "moist heat pack".

import { type NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { ensureCollectionColumns } from '@/lib/ensureCollectionColumns'
import { keywordOverview, matchingTerms, computeOpportunityScore } from '@/lib/ahrefs'

export const maxDuration = 60

function seedFromSlug(slug: string): string {
  return slug
    .replace(/-\d+$/, '')          // gym-accessories-1 -> gym-accessories
    .split('-')
    .filter(Boolean)
    .join(' ')
    .trim()
}

// GET /api/collections/research?keyword=kettlebells
// Diagnostic: shows the raw Ahrefs responses for one keyword so silent
// failures (auth, units, shape changes) are visible instead of saving blanks.
export async function GET(req: NextRequest) {
  const keyword = new URL(req.url).searchParams.get('keyword') || 'kettlebells'
  const key = process.env.AHREFS_API_KEY
  if (!key) return NextResponse.json({ error: 'AHREFS_API_KEY not configured' }, { status: 400 })
  const call = async (path: string, params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString()
    const res = await fetch(`https://api.ahrefs.com/v3${path}?${qs}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    })
    const body = await res.text()
    return { path, status: res.status, body: body.slice(0, 1500) }
  }
  const overview = await call('/keywords-explorer/overview', {
    keywords: keyword, country: 'us', select: 'keyword,volume,difficulty,cpc,traffic_potential',
  })
  const matching = await call('/keywords-explorer/matching-terms', {
    keywords: keyword, country: 'us', limit: '5',
    select: 'keyword,volume,difficulty,traffic_potential', order_by: 'volume:desc',
  })
  return NextResponse.json({ keyword, keyPresent: true, keyPrefix: key.slice(0, 6) + '…', overview, matching })
}

export async function POST(req: NextRequest) {
  try {
    const { slug } = (await req.json()) as { slug?: string }
    if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 })
    if (!process.env.AHREFS_API_KEY) {
      return NextResponse.json(
        { error: 'AHREFS_API_KEY not configured — add it in Vercel and redeploy.' },
        { status: 400 }
      )
    }

    const sql = getSQL()
    await ensureCollectionColumns(sql)

    const rows = (await sql`
      SELECT slug, collection_type, primary_keyword, secondary_keywords
      FROM ppw_collections WHERE slug = ${slug}
    `) as Array<{
      slug: string
      collection_type: string | null
      primary_keyword: string | null
      secondary_keywords: string[] | null
    }>
    if (!rows.length) return NextResponse.json({ error: `Unknown collection: ${slug}` }, { status: 404 })
    const row = rows[0]

    const seed = (row.primary_keyword || '').trim() || seedFromSlug(slug)
    const seedWasEmpty = !(row.primary_keyword || '').trim()

    // Volume + KD for the seed itself, and related terms, in parallel.
    const [overview, terms] = await Promise.all([
      keywordOverview(seed),
      matchingTerms(seed, { limit: 40, minVolume: 30 }).catch(() => []),
    ])

    const isBrand = row.collection_type === 'brand'
    const seedLower = seed.toLowerCase()

    let suggestions = terms
      .filter((t) => t.keyword.toLowerCase() !== seedLower)
      .map((t) => ({
        keyword: t.keyword,
        volume: t.volume,
        difficulty: t.difficulty,
        opportunity: computeOpportunityScore(t),
      }))
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))

    // Brand pages: only keep terms that contain the full brand name, so a
    // brand like Game Ready gets "game ready ice machine", never loose junk.
    if (isBrand) {
      suggestions = suggestions.filter((t) => t.keyword.toLowerCase().includes(seedLower))
    }

    // Save. Never overwrite research a human already entered:
    // primary only fills if it was blank, secondaries only fill if empty.
    // Brand pages take at most 2 secondaries, category pages up to 5, and we
    // never pad to reach the cap: if only one clean term exists we save one,
    // and if none exist we save none.
    const maxSecondaries = isBrand ? 2 : 5
    const newSecondaries =
      row.secondary_keywords && row.secondary_keywords.length > 0
        ? row.secondary_keywords
        : suggestions.slice(0, maxSecondaries).map((s) => s.keyword)

    await sql`
      UPDATE ppw_collections SET
        primary_keyword     = ${seedWasEmpty ? seed : row.primary_keyword},
        search_volume       = ${overview.volume},
        kd                  = ${overview.difficulty},
        secondary_keywords  = ${newSecondaries},
        keywords_updated_at = NOW()
      WHERE slug = ${slug}
    `

    return NextResponse.json({
      ok: true,
      slug,
      seed,
      seedWasEmpty,
      volume: overview.volume,
      kd: overview.difficulty,
      savedSecondaries: newSecondaries,
      // Top 15 alternatives so the UI can show "consider these instead"
      suggestions: suggestions.slice(0, 15),
    })
  } catch (err) {
    console.error('[collections/research]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Research failed' },
      { status: 500 }
    )
  }
}
