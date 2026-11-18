// app/api/content-brain/ideas/bulk-review/route.ts
// Takes approved draft ideas from the Capture view and:
//   1. Inserts them with status = 'review' (so they show up only in the
//      dedicated Review Queue tab, NOT in All Articles with the 500+ existing
//      rows).
//   2. Synchronously runs Ahrefs enrichment on each row — picks the best
//      primary keyword, populates volume/KD/TP/opportunity_score.
//
// POST { drafts: DraftIdea[] } → { inserted, enriched, ids, errors }
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { keywordOverview, matchingTerms, computeOpportunityScore, deriveSeedKeyword } from '@/lib/ahrefs'

export const maxDuration = 60

interface DraftIdea {
  title: string
  keyword?: string
  hub?: string
  cluster_group?: string
  collection?: string
  collection_slug?: string
  content_type?: string
  article_type?: string
  audience?: string
  tone?: string
  word_count?: number
  special_instructions?: string
  reasoning?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { drafts: DraftIdea[] }
    const drafts = Array.isArray(body.drafts) ? body.drafts : []
    if (!drafts.length) return NextResponse.json({ inserted: 0, enriched: 0, ids: [] })

    const sql = getSQL()
    const hasAhrefs = !!process.env.AHREFS_API_KEY

    const ids: number[] = []
    const errors: string[] = []
    let enrichedCount = 0

    for (const d of drafts) {
      // 1. Insert with status='review' — include whatever we have, Ahrefs fields null for now
      let inserted: { id: number } | null = null
      try {
        const rows = (await sql`
          INSERT INTO content_brain (
            title, keyword, hub, cluster_group, collection, collection_slug,
            content_type, article_type, audience, tone, word_count,
            special_instructions, strategic_notes, ai_reasoning,
            status, traffic_light, source
          ) VALUES (
            ${d.title}, ${d.keyword || null}, ${d.hub || null}, ${d.cluster_group || null},
            ${d.collection || d.cluster_group || null}, ${d.collection_slug || null},
            ${d.content_type || 'cluster'}, ${d.article_type || null},
            ${d.audience || null}, ${d.tone || null}, ${d.word_count || 2500},
            ${d.special_instructions || null}, ${d.reasoning || null}, ${d.reasoning || null},
            'review', 'unvetted', 'chat'
          )
          RETURNING id
        `) as unknown as Array<{ id: number }>
        inserted = rows[0]
        if (inserted) ids.push(inserted.id)
      } catch (e) {
        errors.push(`${d.title}: ${e instanceof Error ? e.message : 'insert failed'}`)
        continue
      }

      if (!inserted) continue
      if (!hasAhrefs) {
        errors.push(`#${inserted.id}: AHREFS_API_KEY missing — keyword data not populated`)
        continue
      }

      // 2. Enrich synchronously via Ahrefs
      try {
        const rawKw = (d.keyword || '').trim()
        const kwLooksLikeTitle = rawKw.split(/\s+/).length > 6
        const seed = rawKw && !kwLooksLikeTitle ? rawKw : deriveSeedKeyword(d.title)
        if (!seed) {
          errors.push(`#${inserted.id}: no seed keyword derivable from title`)
          continue
        }

        // Always run both — overview validates the seed, matching-terms
        // surfaces higher-opportunity alternatives. Don't swallow errors
        // silently anymore — collect them so the UI can show the real cause.
        const overviewPromise = keywordOverview(seed).catch((e: Error) => {
          errors.push(`#${inserted!.id} overview: ${e.message}`)
          return null
        })
        const matchingPromise = matchingTerms(seed, { limit: 20, minVolume: 20 }).catch((e: Error) => {
          errors.push(`#${inserted!.id} matching-terms: ${e.message}`)
          return []
        })
        const [initial, candidates] = await Promise.all([overviewPromise, matchingPromise])

        const scored = candidates.map((c) => ({
          keyword: c.keyword,
          volume: c.volume,
          difficulty: c.difficulty,
          traffic_potential: c.traffic_potential,
          opportunity_score: computeOpportunityScore(c),
        }))
        if (initial && initial.volume != null) {
          scored.push({
            keyword: initial.keyword,
            volume: initial.volume,
            difficulty: initial.difficulty,
            traffic_potential: initial.traffic_potential,
            opportunity_score: computeOpportunityScore(initial),
          })
        }
        if (scored.length === 0) {
          errors.push(`#${inserted.id}: Ahrefs returned no keyword data for seed "${seed}"`)
          continue
        }

        scored.sort((a, b) => b.opportunity_score - a.opportunity_score)
        const winner = scored[0]

        await sql`
          UPDATE content_brain
          SET keyword = ${winner.keyword},
              kw_volume = ${winner.volume},
              kw_difficulty = ${winner.difficulty},
              traffic_potential = ${winner.traffic_potential},
              opportunity_score = ${winner.opportunity_score},
              ahrefs_last_enriched_at = NOW(),
              updated_at = NOW()
          WHERE id = ${inserted.id}
        `
        enrichedCount++
      } catch (e) {
        errors.push(`#${inserted.id} enrich: ${e instanceof Error ? e.message : 'Ahrefs failed'}`)
      }
    }

    // 3. Cannibalization vet — compare each inserted row against live DB content
    // Deterministic rules (no LLM):
    //   RED    = exact keyword match with any live row (any hub)
    //          OR ≥80% title token overlap with a live row in same cluster
    //   YELLOW = 60–80% title token overlap with a live row in same cluster
    //          OR intra-batch ≥60% title overlap with another just-inserted row
    //   GREEN  = everything else (default — "proceed unless flagged")
    const vetResults = await vetCannibalization(sql, ids)
    for (const [id, verdict] of Object.entries(vetResults)) {
      await sql`
        UPDATE content_brain
        SET traffic_light = ${verdict.light},
            ai_reasoning = ${verdict.reasoning},
            updated_at = NOW()
        WHERE id = ${Number(id)}
      `
    }

    return NextResponse.json({
      ok: true,
      inserted: ids.length,
      enriched: enrichedCount,
      vetted: Object.keys(vetResults).length,
      ids,
      ahrefs_available: hasAhrefs,
      errors,
      error_count: errors.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Cannibalization vet — deterministic SQL-based checks
// ---------------------------------------------------------------------------
type SqlFn = ReturnType<typeof getSQL>
type Verdict = { light: 'green' | 'yellow' | 'red'; reasoning: string }

async function vetCannibalization(sql: SqlFn, ids: number[]): Promise<Record<number, Verdict>> {
  if (ids.length === 0) return {}

  // Load the just-inserted rows (for their keyword/title/cluster/hub)
  const newRows = (await sql`
    SELECT id, title, keyword, hub, cluster_group
    FROM content_brain
    WHERE id = ANY(${ids})
  `) as unknown as Array<{ id: number; title: string; keyword: string | null; hub: string | null; cluster_group: string | null }>

  // Load every live row in any cluster hit by the new batch
  const clusters = Array.from(new Set(newRows.map((r) => r.cluster_group).filter(Boolean))) as string[]
  const existing = clusters.length
    ? ((await sql`
        SELECT id, title, keyword, hub, cluster_group
        FROM content_brain
        WHERE status = 'live'
          AND cluster_group = ANY(${clusters})
      `) as unknown as Array<{ id: number; title: string; keyword: string | null; hub: string | null; cluster_group: string | null }>)
    : []

  // Also global exact-keyword index across all live rows
  const liveKwMap = new Map<string, { id: number; title: string }>()
  const allLiveKw = (await sql`
    SELECT id, title, keyword FROM content_brain
    WHERE status = 'live' AND keyword IS NOT NULL AND keyword <> ''
  `) as unknown as Array<{ id: number; title: string; keyword: string }>
  for (const r of allLiveKw) {
    liveKwMap.set(r.keyword.toLowerCase().trim(), { id: r.id, title: r.title })
  }

  const verdicts: Record<number, Verdict> = {}

  for (const n of newRows) {
    const nTokens = tokens(n.title)
    const nKw = (n.keyword || '').toLowerCase().trim()

    // Exact keyword collision → RED (but skip if collision is this same row)
    if (nKw) {
      const hit = liveKwMap.get(nKw)
      if (hit && hit.id !== n.id) {
        verdicts[n.id] = {
          light: 'red',
          reasoning: `Red — exact keyword collision with live article: "${hit.title}" (#${hit.id}). Either repurpose this keyword or merge into that article.`,
        }
        continue
      }
    }

    // Title overlap with live rows in same cluster
    let bestOverlap = 0
    let bestMatch: { id: number; title: string } | null = null
    for (const e of existing) {
      if (e.id === n.id) continue
      if (e.cluster_group !== n.cluster_group) continue
      const overlap = jaccard(nTokens, tokens(e.title))
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestMatch = { id: e.id, title: e.title }
      }
    }

    // Intra-batch overlap (another just-inserted idea from the same brainstorm)
    let bestBatchOverlap = 0
    let bestBatchMatch: { id: number; title: string } | null = null
    for (const other of newRows) {
      if (other.id === n.id) continue
      if (other.cluster_group !== n.cluster_group) continue
      const overlap = jaccard(nTokens, tokens(other.title))
      if (overlap > bestBatchOverlap) {
        bestBatchOverlap = overlap
        bestBatchMatch = { id: other.id, title: other.title }
      }
    }

    if (bestOverlap >= 0.8 && bestMatch) {
      verdicts[n.id] = {
        light: 'red',
        reasoning: `Red — ${Math.round(bestOverlap * 100)}% title overlap with live article "${bestMatch.title}" (#${bestMatch.id}) in same cluster. Near-duplicate.`,
      }
    } else if (bestOverlap >= 0.6 && bestMatch) {
      verdicts[n.id] = {
        light: 'yellow',
        reasoning: `Yellow — ${Math.round(bestOverlap * 100)}% title overlap with live article "${bestMatch.title}" (#${bestMatch.id}). Tweak angle or title before publishing.`,
      }
    } else if (bestBatchOverlap >= 0.6 && bestBatchMatch) {
      verdicts[n.id] = {
        light: 'yellow',
        reasoning: `Yellow — ${Math.round(bestBatchOverlap * 100)}% overlap with another idea in this batch: "${bestBatchMatch.title}". Consider merging.`,
      }
    } else {
      verdicts[n.id] = {
        light: 'green',
        reasoning: 'Green — no keyword collisions or near-duplicate titles. Proceed.',
      }
    }
  }

  return verdicts
}

// Token helper — lowercase, strip punctuation, drop stopwords
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'for', 'in', 'on', 'at',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'with', 'by', 'from',
  'how', 'what', 'why', 'when', 'where', 'which', 'who', 'your', 'you',
  'guide', 'best', 'top', 'ultimate', 'complete', 'everything',
])

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersect = 0
  for (const x of a) if (b.has(x)) intersect++
  return intersect / new Set([...a, ...b]).size
}
