// app/api/content-brain/ahrefs/enrich-drafts/route.ts
// Enriches DRAFT ideas (not yet persisted) with Ahrefs keyword research.
//
// For each draft:
//   1. Start with the extracted keyword (if any) plus the title as seed.
//   2. Pull a single keywords-explorer/overview lookup for that seed — volume,
//      difficulty, traffic potential.
//   3. Return the draft + metrics.
//
// Changed 2026-08-27: this used to also call matching-terms per draft to
// discover higher-volume keyword candidates (~634 units/call vs ~50 for a plain
// overview lookup — it was the single largest source of Ahrefs usage across
// every PPW/NN app combined). Ryan already vets the keyword before ideas reach
// Content Brain, so that discovery pass was redundant spend. Now this only
// confirms volume/difficulty for the seed you already picked — no alternate
// keyword suggestions. If matching-terms-based discovery is needed again,
// see git history for the previous version.
//
// This is the "final review" step: the user sees already-enriched ideas with
// concrete volume / KD / opportunity numbers, picks which ones to push to the
// content queue.
//
// POST { drafts: DraftIdea[] }  → { enriched: EnrichedDraft[] }
import { NextRequest, NextResponse } from 'next/server'
import { keywordOverview, computeOpportunityScore } from '@/lib/ahrefs'

interface DraftIdea {
  title: string
  keyword?: string
  hub?: string
  cluster_group?: string
  [k: string]: unknown
}

interface AltKeyword {
  keyword: string
  volume: number | null
  difficulty: number | null
  traffic_potential: number | null
  opportunity_score: number
}

interface EnrichedDraft extends DraftIdea {
  primary_keyword: string | null
  kw_volume: number | null
  kw_difficulty: number | null
  traffic_potential: number | null
  opportunity_score: number | null
  alternate_keywords: AltKeyword[]
  ahrefs_error?: string
}

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { drafts: DraftIdea[] }
    const drafts = Array.isArray(body.drafts) ? body.drafts : []
    if (!drafts.length) {
      return NextResponse.json({ enriched: [] })
    }

    if (!process.env.AHREFS_API_KEY) {
      // Fail soft: return drafts unchanged so the user still gets the review step
      const fallback: EnrichedDraft[] = drafts.map((d) => ({
        ...d,
        primary_keyword: d.keyword || null,
        kw_volume: null,
        kw_difficulty: null,
        traffic_potential: null,
        opportunity_score: null,
        alternate_keywords: [],
        ahrefs_error: 'AHREFS_API_KEY not configured — add it in Vercel and redeploy.',
      }))
      return NextResponse.json({ enriched: fallback, ahrefs_available: false })
    }

    // Enrich drafts in parallel (bounded concurrency via Promise.all on small batches)
    const CONCURRENCY = 4
    const enriched: EnrichedDraft[] = []
    for (let i = 0; i < drafts.length; i += CONCURRENCY) {
      const batch = drafts.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map((d) => enrichOne(d)))
      enriched.push(...results)
    }

    return NextResponse.json({ enriched, ahrefs_available: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function enrichOne(d: DraftIdea): Promise<EnrichedDraft> {
  const base: EnrichedDraft = {
    ...d,
    primary_keyword: d.keyword || null,
    kw_volume: null,
    kw_difficulty: null,
    traffic_potential: null,
    opportunity_score: null,
    alternate_keywords: [],
  }

  // Seed: prefer the extracted/picked keyword, fall back to a cleaned title
  const seed =
    (d.keyword && d.keyword.trim()) ||
    d.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  if (!seed) return base

  try {
    // Single keyword-volume lookup on the seed — no matching-terms discovery pass.
    const ov = await keywordOverview(seed)
    if (ov.volume == null) return base

    return {
      ...base,
      primary_keyword: ov.keyword,
      kw_volume: ov.volume,
      kw_difficulty: ov.difficulty,
      traffic_potential: ov.traffic_potential,
      opportunity_score: computeOpportunityScore(ov),
    }
  } catch (err) {
    return {
      ...base,
      ahrefs_error: err instanceof Error ? err.message : 'Ahrefs call failed',
    }
  }
}
