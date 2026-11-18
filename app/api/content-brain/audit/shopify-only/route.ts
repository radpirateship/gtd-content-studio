// app/api/content-brain/audit/shopify-only/route.ts
// Enriches the shopify_only list with:
//   - published_at date (from Shopify article API)
//   - derived seed keyword (from title heuristic)
//   - Ahrefs keyword data (volume, KD, opportunity score) — optional
//   - clash_type: 'exact' | 'fuzzy' | 'none' — collision with existing DB live content
//   - clash_title: the conflicting DB article if any
//   - quality_flag: 'review' for articles published before cutoff date
//
// POST { cutoff_date?: "2025-09-01", run_ahrefs?: boolean }
// Returns enriched list + CSV download path
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from '@/lib/shopifyAuth'
import { deriveSeedKeyword, matchingTerms, computeOpportunityScore } from '@/lib/ahrefs'
import redirects from '@/lib/shopifyRedirects.json'

export const maxDuration = 60

const API_VERSIONS = ['2024-10', '2024-07', '2024-04', '2024-01']
const REDIRECT_MAP: Record<string, string> = redirects as Record<string, string>

async function shopifyGet(path: string): Promise<{ data: Record<string, unknown>; nextPageInfo: string | null }> {
  const token = await getShopifyAccessToken()
  for (const v of API_VERSIONS) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/${path}`, {
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    })
    if (res.ok) {
      const data = await res.json()
      const link = res.headers.get('Link') || ''
      const nextMatch = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)
      return { data, nextPageInfo: nextMatch ? nextMatch[1] : null }
    }
    if (res.status === 404) continue
    const text = await res.text()
    throw new Error(`Shopify ${res.status}: ${text.slice(0, 200)}`)
  }
  throw new Error('All Shopify API versions failed')
}

// Fetch all published articles with dates, fully paginated.
// Excludes body_html to keep response sizes small — uses summary_html length
// as a proxy for word count instead (rough but good enough for filtering).
async function fetchAllWithDates(): Promise<Array<{
  id: number; title: string; handle: string; blog_handle: string
  published_at: string | null; word_count_approx: number
}>> {
  const { data: blogsData } = await shopifyGet('blogs.json')
  const blogs = (blogsData.blogs || []) as Array<{ id: number; handle: string }>
  const all: Array<{ id: number; title: string; handle: string; blog_handle: string; published_at: string | null; word_count_approx: number }> = []

  for (const blog of blogs) {
    // First page — lightweight fields only (no body_html so pagination works)
    let path: string | null =
      `blogs/${blog.id}/articles.json?limit=250&published_status=published&fields=id,title,handle,published_at,summary_html`
    while (path) {
      const { data, nextPageInfo } = await shopifyGet(path)
      const articles = (data.articles || []) as Array<{
        id: number; title: string; handle: string; published_at: string; summary_html?: string
      }>
      for (const a of articles) {
        // Rough word count from summary (summary is ~first 500 chars of article)
        // For a full estimate: summary length / 5 chars per word × 15 to project full article
        const summaryLen = (a.summary_html || '').length
        const wordCountApprox = summaryLen > 0 ? Math.round((summaryLen / 5) * 15) : 0
        all.push({
          id: a.id, title: a.title, handle: a.handle,
          blog_handle: blog.handle,
          published_at: a.published_at || null,
          word_count_approx: wordCountApprox,
        })
      }
      // Follow cursor for subsequent pages — can't combine with other filters
      path = nextPageInfo
        ? `blogs/${blog.id}/articles.json?limit=250&page_info=${nextPageInfo}`
        : null
    }
  }
  return all
}

const STOPWORDS = new Set(['a','an','the','and','or','of','to','for','in','on','at','is','are','vs','how','what','why','when','which','does','do','can','your','you','with','by','from','that','this'])
function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w => w.length > 1 && !STOPWORDS.has(w)))
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / new Set([...a, ...b]).size
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { cutoff_date?: string; run_ahrefs?: boolean }
    const cutoff = new Date(body.cutoff_date || '2025-10-01')
    const runAhrefs = body.run_ahrefs === true

    const sql = getSQL()

    // 1. Load all live DB articles for clash checking
    const dbLive = (await sql`
      SELECT id, title, keyword, hub, cluster_group, url_slug
      FROM content_brain
      WHERE status = 'live' AND (is_shopify_page IS NULL OR is_shopify_page = false)
    `) as unknown as Array<{ id: number; title: string; keyword: string|null; hub: string|null; cluster_group: string|null; url_slug: string|null }>

    // Build title + keyword lookup sets for clash detection
    const dbTitleTokens = dbLive.map(r => ({ r, tokens: tokenize(r.title) }))
    const dbKeywordSet = new Set(dbLive.map(r => (r.keyword||'').toLowerCase().trim()).filter(Boolean))
    const dbHandleSet = new Set(dbLive.map(r => (r.url_slug||'').replace(/^.*\//,'').toLowerCase().trim()).filter(Boolean))
    const redirectHandleSet = new Set(Object.values(REDIRECT_MAP))

    // 2. Fetch Shopify articles with dates
    const shopifyAll = await fetchAllWithDates()

    // 3. Determine shopify_only (same logic as main audit)
    const dbTitles = new Set(dbLive.map(r => r.title.toLowerCase().trim()))
    const dbSlugs = new Set(dbLive.map(r => (r.url_slug||'').replace(/^.*\//,'').toLowerCase().trim()).filter(Boolean))
    const dbRedirectTargets = new Set(Object.entries(REDIRECT_MAP)
      .filter(([k]) => dbSlugs.has(k))
      .map(([,v]) => v))

    const shopifyOnly = shopifyAll.filter(a => {
      if (dbTitles.has(a.title.toLowerCase().trim())) return false
      if (dbSlugs.has(a.handle.toLowerCase())) return false
      if (dbHandleSet.has(a.handle.toLowerCase())) return false
      if (redirectHandleSet.has(a.handle.toLowerCase()) && dbRedirectTargets.has(a.handle.toLowerCase())) return false
      return true
    })

    // 4. Enrich each shopify-only article
    const results = []
    for (const a of shopifyOnly) {
      const seed = deriveSeedKeyword(a.title)
      const publishedAt = a.published_at ? new Date(a.published_at) : null
      const isOld = publishedAt ? publishedAt < cutoff : false

      // Clash check
      let clashType: 'exact-keyword' | 'title-overlap' | 'none' = 'none'
      let clashWith = ''

      // Exact keyword clash
      const seedNorm = seed.toLowerCase().trim()
      if (seedNorm && dbKeywordSet.has(seedNorm)) {
        clashType = 'exact-keyword'
        const clashRow = dbLive.find(r => (r.keyword||'').toLowerCase().trim() === seedNorm)
        clashWith = clashRow ? `#${clashRow.id} "${clashRow.title}"` : 'unknown'
      }

      // Title token overlap
      if (clashType === 'none') {
        const aToks = tokenize(a.title)
        let best = 0; let bestRow = null
        for (const { r, tokens } of dbTitleTokens) {
          const s = jaccard(aToks, tokens)
          if (s > best) { best = s; bestRow = r }
        }
        if (best >= 0.65 && bestRow) {
          clashType = 'title-overlap'
          clashWith = `#${bestRow.id} "${bestRow.title}" (${Math.round(best*100)}%)`
        }
      }

      // Ahrefs enrichment (optional, costly)
      let kwVolume: number|null = null
      let kwDifficulty: number|null = null
      let oppScore: number|null = null
      let primaryKw = seed
      if (runAhrefs && seed) {
        try {
          const terms = await matchingTerms(seed, { limit: 5, minVolume: 20 })
          if (terms.length > 0) {
            const scored = terms.map(t => ({ ...t, opp: computeOpportunityScore(t) }))
            scored.sort((a, b) => b.opp - a.opp)
            const w = scored[0]
            primaryKw = w.keyword
            kwVolume = w.volume
            kwDifficulty = w.difficulty
            oppScore = w.opp
          }
        } catch { /* skip */ }
      }

      results.push({
        shopify_id: a.id,
        title: a.title,
        handle: a.handle,
        url: `https://peakprimalwellness.com/blogs/wellness/${a.handle}`,
        published_at: publishedAt ? publishedAt.toISOString().split('T')[0] : 'unknown',
        age_flag: isOld ? 'OLD (before cutoff)' : 'recent',
        word_count_approx: a.word_count_approx,
        derived_keyword: primaryKw,
        kw_volume: kwVolume,
        kw_difficulty: kwDifficulty,
        opportunity_score: oppScore,
        clash_type: clashType,
        clash_with: clashWith,
        recommendation: clashType === 'exact-keyword' ? 'DELETE — keyword already covered'
          : clashType === 'title-overlap' ? 'REVIEW — overlaps with existing article'
          : isOld ? 'REVIEW — old article, check quality'
          : 'KEEP — no clash, may need tagging',
      })
    }

    // Sort: old + clashes first
    results.sort((a, b) => {
      const score = (r: typeof a) =>
        (r.clash_type === 'exact-keyword' ? 3 : r.clash_type === 'title-overlap' ? 2 : 0) +
        (r.age_flag.startsWith('OLD') ? 1 : 0)
      return score(b) - score(a)
    })

    // Build CSV
    const headers = ['shopify_id','title','url','published_at','age_flag','word_count_approx','derived_keyword','kw_volume','kw_difficulty','opportunity_score','clash_type','clash_with','recommendation']
    const csvRows = [headers.join(','), ...results.map(r =>
      headers.map(h => {
        const v = (r as Record<string, unknown>)[h]
        const s = v == null ? '' : String(v)
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    )]
    const csv = csvRows.join('\n')

    const counts = {
      total: results.length,
      exact_keyword_clash: results.filter(r => r.clash_type === 'exact-keyword').length,
      title_overlap: results.filter(r => r.clash_type === 'title-overlap').length,
      old_no_clash: results.filter(r => r.age_flag.startsWith('OLD') && r.clash_type === 'none').length,
      recent_no_clash: results.filter(r => !r.age_flag.startsWith('OLD') && r.clash_type === 'none').length,
    }

    return NextResponse.json({ ok: true, counts, results, csv })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 })
  }
}
