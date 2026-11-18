// app/api/content-brain/audit/shopify/route.ts
// One-time audit: compares content_brain rows marked status='live' against
// every published article on Shopify. Returns:
//   - confirmed_live:   in DB as live AND found on Shopify
//   - ghost_live:       in DB as live BUT not found on Shopify (status wrong)
//   - shopify_only:     on Shopify but not in DB at all (missing from brain)
//
// Matching is done by title (case-insensitive, trimmed). No changes are made
// to the DB — this is read-only. Use the results to decide which ghost_live
// rows to flip to status='planned' via the Settings maintenance buttons.
//
// POST { fix: true }             — flips ghost_live → planned AND updates DB titles
//                                  to match Shopify (Shopify is source of truth)
// POST { fix: true, ghost_only }  — only flip ghost rows, skip title updates
// GET                             — audit only, no changes
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from '@/lib/shopifyAuth'
import redirects from '@/lib/shopifyRedirects.json'

// redirects: old_handle → new_handle (158 blog article redirects)
const REDIRECT_MAP: Record<string, string> = redirects as Record<string, string>

export const maxDuration = 60

const API_VERSIONS = ['2024-10', '2024-07', '2024-04', '2024-01']

async function shopifyFetch(path: string): Promise<{ data: Record<string, unknown>; nextPageInfo: string | null }> {
  const token = await getShopifyAccessToken()
  let lastStatus = 0
  let lastBody = ''
  for (const v of API_VERSIONS) {
    const url = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/${path}`
    try {
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
      })
      lastStatus = res.status
      if (res.ok) {
        const data = await res.json()
        // Extract cursor for next page from Link header
        const link = res.headers.get('Link') || ''
        const nextMatch = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)
        return { data, nextPageInfo: nextMatch ? nextMatch[1] : null }
      }
      lastBody = await res.text()
      if (res.status === 404) continue
      throw new Error(`Shopify ${res.status} on ${path}: ${lastBody.slice(0, 300)}`)
    } catch (err) {
      if (v === API_VERSIONS[API_VERSIONS.length - 1]) throw err
    }
  }
  throw new Error(`Shopify API failed. Last status: ${lastStatus}. Body: ${lastBody.slice(0, 300)}`)
}

// Fetch every published article across all blogs using cursor-based pagination
async function fetchAllShopifyArticles(): Promise<Array<{ id: number; title: string; handle: string; blog_id: number; blog_handle: string; published_at: string | null }>> {
  const { data: blogsData } = await shopifyFetch('blogs.json')
  const blogs = (blogsData.blogs || []) as Array<{ id: number; handle: string }>
  const all: Array<{ id: number; title: string; handle: string; blog_id: number; blog_handle: string; published_at: string | null }> = []

  for (const blog of blogs) {
    // First page — use published_status filter
    let path: string | null = `blogs/${blog.id}/articles.json?limit=250&published_status=published`
    while (path) {
      const { data, nextPageInfo } = await shopifyFetch(path)
      const articles = (data.articles || []) as Array<{ id: number; title: string; handle: string; published_at: string | null }>
      for (const a of articles) {
        all.push({ ...a, blog_id: blog.id, blog_handle: blog.handle })
      }
      // Subsequent pages: use page_info cursor — can't combine with other filters
      path = nextPageInfo
        ? `blogs/${blog.id}/articles.json?limit=250&page_info=${nextPageInfo}`
        : null
    }
  }
  return all
}

export async function GET(req: NextRequest) {
  return runAudit(req, false)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { fix?: boolean; ghost_only?: boolean }
  return runAudit(req, body.fix === true, body.ghost_only === true)
}

async function runAudit(_req: NextRequest, fix: boolean, ghostOnly = false) {
  try {
    const sql = getSQL()

    // Load live blog-article rows — exclude Shopify Pages (never appear in
    // blog article API responses so they always show as ghost if included)
    const dbLive = (await sql`
      SELECT id, title, keyword, hub, cluster_group, status, url_slug
      FROM content_brain
      WHERE status = 'live'
        AND (is_shopify_page IS NULL OR is_shopify_page = false)
      ORDER BY hub, cluster_group, title
    `) as unknown as Array<{
      id: number
      title: string
      keyword: string | null
      hub: string | null
      cluster_group: string | null
      status: string
      url_slug: string | null
    }>

    // Fetch all published Shopify articles
    const shopifyArticles = await fetchAllShopifyArticles()

    // Count Shopify Pages separately — these are excluded from blog audit
    const shopifyPagesResult = (await sql`
      SELECT COUNT(*)::int AS count FROM content_brain
      WHERE status = 'live' AND is_shopify_page = true
    `) as unknown as Array<{ count: number }>
    const shopify_pages_count = shopifyPagesResult[0]?.count ?? 0

    // Build lookups: normalised title AND handle → shopify article
    const shopifyByTitle = new Map<string, typeof shopifyArticles[0]>()
    const shopifyByHandle = new Map<string, typeof shopifyArticles[0]>()
    for (const a of shopifyArticles) {
      shopifyByTitle.set(normalise(a.title), a)
      shopifyByHandle.set(a.handle.toLowerCase().trim(), a)
    }

    // Build lookup: normalised title → db row
    const dbByTitle = new Map<string, typeof dbLive[0]>()
    for (const r of dbLive) {
      dbByTitle.set(normalise(r.title), r)
    }

    // Pre-compute fuzzy tokens for all Shopify articles (for mismatch detection)
    const shopifyFuzzy = shopifyArticles.map((a) => ({
      ...a,
      tokens: fuzzyTokens(a.title),
    }))

    // Categorise
    const confirmed_live: Array<{ db_id: number; title: string; hub: string | null; cluster: string | null; shopify_handle: string }> = []
    const title_mismatch: Array<{ db_id: number; title: string; shopify_title: string; shopify_handle: string; hub: string | null; cluster: string | null; score: number }> = []
    const ghost_live: Array<{ db_id: number; title: string; hub: string | null; cluster: string | null }> = []
    const shopify_only: Array<{ shopify_id: number; title: string; blog: string; handle: string }> = []

    for (const r of dbLive) {
      // 1. Exact title match
      const exactMatch = shopifyByTitle.get(normalise(r.title))
      if (exactMatch) {
        confirmed_live.push({
          db_id: r.id,
          title: r.title,
          hub: r.hub,
          cluster: r.cluster_group,
          shopify_handle: exactMatch.handle,
        })
        continue
      }

      // 1b. Handle/slug match — catches articles where the title changed but
      //     the URL stayed the same (Shopify rewrites, subtitle additions, etc.)
      //     url_slug in DB may be stored as "/blogs/guides/slug" or just "slug"
      const rawSlug = (r.url_slug || '').replace(/^.*\//, '').toLowerCase().trim()
      if (rawSlug) {
        const handleMatch = shopifyByHandle.get(rawSlug)
        if (handleMatch) {
          confirmed_live.push({
            db_id: r.id,
            title: r.title,
            hub: r.hub,
            cluster: r.cluster_group,
            shopify_handle: handleMatch.handle,
          })
          continue
        }

        // 1c. Redirect match — DB slug was the old handle, now lives at a new handle
        const redirectTarget = REDIRECT_MAP[rawSlug]
        if (redirectTarget) {
          const redirectMatch = shopifyByHandle.get(redirectTarget)
          if (redirectMatch) {
            confirmed_live.push({
              db_id: r.id,
              title: r.title,
              hub: r.hub,
              cluster: r.cluster_group,
              shopify_handle: redirectMatch.handle,
            })
            continue
          }
        }
      }

      // 2. Fuzzy match — if score ≥ 0.35 treat as title mismatch (article IS live, titles just differ)
      const dbTokens = fuzzyTokens(r.title)
      let bestScore = 0
      let bestShopify: typeof shopifyFuzzy[0] | null = null
      for (const sa of shopifyFuzzy) {
        const score = jaccardScore(dbTokens, sa.tokens)
        if (score > bestScore) { bestScore = score; bestShopify = sa }
      }

      if (bestScore >= 0.60 && bestShopify) {
        title_mismatch.push({
          db_id: r.id,
          title: r.title,                          // current DB title (will be replaced)
          shopify_title: bestShopify.title,         // Shopify title — source of truth
          shopify_handle: bestShopify.handle,
          hub: r.hub,
          cluster: r.cluster_group,
          score: Math.round(bestScore * 100) / 100,
        })
      } else {
        ghost_live.push({
          db_id: r.id,
          title: r.title,
          hub: r.hub,
          cluster: r.cluster_group,
        })
      }
    }

    for (const a of shopifyArticles) {
      if (!dbByTitle.has(normalise(a.title))) {
        // Also skip if it matched a title_mismatch row
        const aToks = fuzzyTokens(a.title)
        const matchedMismatch = title_mismatch.some((m) => jaccardScore(fuzzyTokens(m.title), aToks) >= 0.60)
        if (!matchedMismatch) {
          shopify_only.push({
            shopify_id: a.id,
            title: a.title,
            blog: a.blog_handle,
            handle: a.handle,
          })
        }
      }
    }

    // Auto-fix step 1: flip ghost_live rows to planned (they don't exist on Shopify)
    let fixed_ghost = 0
    if (fix && ghost_live.length > 0) {
      const ids = ghost_live.map((r) => r.db_id)
      await sql`
        UPDATE content_brain
        SET status = 'planned', traffic_light = 'unvetted', updated_at = NOW()
        WHERE id = ANY(${ids})
      `
      fixed_ghost = ids.length
    }

    // Auto-fix step 2: update DB titles to match Shopify (Shopify is source of truth)
    // Skipped if ghost_only=true
    let fixed_titles = 0
    if (fix && !ghostOnly && title_mismatch.length > 0) {
      for (const m of title_mismatch) {
        await sql`
          UPDATE content_brain
          SET title = ${m.shopify_title},
              url_slug = ${m.shopify_handle},
              updated_at = NOW()
          WHERE id = ${m.db_id}
        `
        fixed_titles++
      }
    }

    return NextResponse.json({
      ok: true,
      shopify_article_count: shopifyArticles.length,
      db_live_count: dbLive.length,
      confirmed_live_count: confirmed_live.length,
      title_mismatch_count: title_mismatch.length,
      ghost_live_count: ghost_live.length,
      shopify_only_count: shopify_only.length,
      fixed_ghost_count: fixed_ghost,
      fixed_titles_count: fixed_titles,
      shopify_pages_excluded: shopify_pages_count,
      fix_applied: fix,
      // Only include the full arrays for ghost/mismatch/shopify-only to keep the response readable
      title_mismatch,
      ghost_live,
      shopify_only,
      confirmed_live_sample: confirmed_live.slice(0, 5),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

function normalise(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const FUZZY_STOPWORDS = new Set([
  'a','an','the','and','or','of','to','for','in','on','at','is','are',
  'vs','how','what','why','when','which','does','do','can','your','you',
  'with','by','from','that','this',
])

function fuzzyTokens(s: string): Set<string> {
  return new Set(
    normalise(s).split(' ').filter((w) => w.length > 1 && !FUZZY_STOPWORDS.has(w))
  )
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / new Set([...a, ...b]).size
}
