// app/api/content-brain/ideas/batch-to-review/route.ts
// Takes an array of existing content_brain row ids (already in DB, status='planned'
// or 'idea') and promotes them into the Review Queue by:
//   1. Flipping status → 'review'
//   2. Running Ahrefs enrichment: derive seed keyword from title if none set,
//      pull matching-terms, pick winning primary keyword, write volume/KD/TP/opp score
//   3. Running cannibalization vet: tag each row green/yellow/red + reasoning
//
// This is the same pipeline as bulk-review (for new drafts from Capture) but
// operates on rows already persisted in the DB rather than drafts from chat.
//
// POST { ids: number[], hub?: string, cluster_group?: string }
//   - ids: explicit list (from Article Database multi-select)
//   - hub / cluster_group: optional extra filters (safety check — only promote
//     rows matching these if supplied)
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import {
  keywordOverview,
  matchingTerms,
  computeOpportunityScore,
  deriveSeedKeyword,
} from '@/lib/ahrefs'

export const maxDuration = 60

// Re-use the same cannibalization vet logic as bulk-review
const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','for','in','on','at',
  'is','are','was','were','be','been','with','by','from','how','what',
  'why','when','where','your','you','guide','best','top','ultimate','complete','everything',
])
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(t => t.length>2 && !STOPWORDS.has(t)))
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / new Set([...a, ...b]).size
}

type SqlFn = ReturnType<typeof getSQL>
type Verdict = { light: 'green'|'yellow'|'red'; reasoning: string }

async function vetRow(sql: SqlFn, id: number, title: string, keyword: string|null, cluster: string|null): Promise<Verdict> {
  const nTokens = tokens(title)
  const nKw = (keyword||'').toLowerCase().trim()

  // Global keyword collision
  if (nKw) {
    const hits = await sql`
      SELECT id, title FROM content_brain
      WHERE status='live' AND LOWER(keyword)=${nKw} AND id<>${id}
      LIMIT 1
    ` as unknown as Array<{id:number;title:string}>
    if (hits.length > 0) return {
      light: 'red',
      reasoning: `Red — exact keyword collision with live article: "${hits[0].title}" (#${hits[0].id}).`,
    }
  }

  // Title overlap within same cluster
  if (cluster) {
    const peers = await sql`
      SELECT id, title FROM content_brain
      WHERE status='live' AND cluster_group=${cluster} AND id<>${id}
    ` as unknown as Array<{id:number;title:string}>
    let best = 0, bestTitle = '', bestId = 0
    for (const p of peers) {
      const s = jaccard(nTokens, tokens(p.title))
      if (s > best) { best=s; bestTitle=p.title; bestId=p.id }
    }
    if (best >= 0.8) return {
      light: 'red',
      reasoning: `Red — ${Math.round(best*100)}% title overlap with live article "${bestTitle}" (#${bestId}). Near-duplicate.`,
    }
    if (best >= 0.6) return {
      light: 'yellow',
      reasoning: `Yellow — ${Math.round(best*100)}% title overlap with live article "${bestTitle}" (#${bestId}). Check angle differentiation.`,
    }
  }

  return { light: 'green', reasoning: 'Green — no keyword collisions or near-duplicates found.' }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      ids: number[]
      hub?: string
      cluster_group?: string
    }
    const ids = Array.isArray(body.ids) ? body.ids : []
    if (!ids.length) return NextResponse.json({ error: 'ids required' }, { status: 400 })

    const sql = getSQL()
    const hasAhrefs = !!process.env.AHREFS_API_KEY

    // Load the target rows
    let rows = (await sql`
      SELECT id, title, keyword, hub, cluster_group, status
      FROM content_brain
      WHERE id = ANY(${ids})
    `) as unknown as Array<{
      id: number; title: string; keyword: string|null
      hub: string|null; cluster_group: string|null; status: string
    }>

    // Optional safety filter
    if (body.hub) rows = rows.filter(r => r.hub === body.hub)
    if (body.cluster_group) rows = rows.filter(r => r.cluster_group === body.cluster_group)

    let promoted = 0; let enriched = 0
    const errors: string[] = []
    const vetResults: Record<number, Verdict> = {}

    for (const row of rows) {
      // 1. Promote to review
      await sql`UPDATE content_brain SET status='review', updated_at=NOW() WHERE id=${row.id}`
      promoted++

      // 2. Ahrefs enrichment
      if (hasAhrefs) {
        const rawKw = (row.keyword||'').trim()
        const seed = rawKw && rawKw.split(/\s+/).length <= 6
          ? rawKw
          : deriveSeedKeyword(row.title)

        if (seed) {
          try {
            const [ov, candidates] = await Promise.all([
              keywordOverview(seed).catch((e: Error) => { errors.push(`#${row.id} overview: ${e.message}`); return null }),
              matchingTerms(seed, { limit: 20, minVolume: 20 }).catch((e: Error) => { errors.push(`#${row.id} matching-terms: ${e.message}`); return [] }),
            ])
            const scored = candidates.map(c => ({
              keyword: c.keyword, volume: c.volume, difficulty: c.difficulty,
              traffic_potential: c.traffic_potential,
              opportunity_score: computeOpportunityScore(c),
            }))
            if (ov?.volume != null) scored.push({
              keyword: ov.keyword, volume: ov.volume, difficulty: ov.difficulty,
              traffic_potential: ov.traffic_potential,
              opportunity_score: computeOpportunityScore(ov),
            })
            if (scored.length > 0) {
              scored.sort((a,b) => b.opportunity_score - a.opportunity_score)
              const w = scored[0]
              await sql`
                UPDATE content_brain
                SET keyword=${w.keyword}, kw_volume=${w.volume}, kw_difficulty=${w.difficulty},
                    traffic_potential=${w.traffic_potential}, opportunity_score=${w.opportunity_score},
                    ahrefs_last_enriched_at=NOW(), updated_at=NOW()
                WHERE id=${row.id}
              `
              // Update local row for vet step
              row.keyword = w.keyword
              enriched++
            } else {
              errors.push(`#${row.id}: Ahrefs returned no data for seed "${seed}"`)
            }
          } catch(e) {
            errors.push(`#${row.id}: ${e instanceof Error ? e.message : 'Ahrefs error'}`)
          }
        }
      } else {
        errors.push('AHREFS_API_KEY not configured — keyword enrichment skipped')
      }

      // 3. Cannibalization vet
      const verdict = await vetRow(sql, row.id, row.title, row.keyword, row.cluster_group)
      vetResults[row.id] = verdict
      await sql`
        UPDATE content_brain
        SET traffic_light=${verdict.light}, ai_reasoning=${verdict.reasoning}, updated_at=NOW()
        WHERE id=${row.id}
      `
    }

    return NextResponse.json({
      ok: true,
      promoted,
      enriched,
      vetted: Object.keys(vetResults).length,
      ahrefs_available: hasAhrefs,
      errors: errors.slice(0, 20),
      error_count: errors.length,
    })
  } catch(err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 })
  }
}
