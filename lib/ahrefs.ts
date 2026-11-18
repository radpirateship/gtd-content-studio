/**
 * Ahrefs API v3 wrapper — thin, typed, cache-free.
 *
 * Reads AHREFS_API_KEY from env. All calls hit https://api.ahrefs.com/v3.
 * Only exposes the handful of endpoints the Content Brain actually uses:
 *   - keywordsExplorerOverview: volume + KD for a single keyword
 *   - keywordsExplorerMatchingTerms: discover related / gap keywords
 *   - siteExplorerOrganicKeywords: what a URL/domain already ranks for
 *
 * Each helper returns a narrow, serializable shape that the API routes can
 * forward to the browser without further shaping.
 */

const AHREFS_BASE = 'https://api.ahrefs.com/v3'

function getKey(): string {
  const key = process.env.AHREFS_API_KEY
  if (!key) throw new Error('AHREFS_API_KEY not configured')
  return key
}

async function ahrefsGet<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v))
  }
  const url = `${AHREFS_BASE}${path}?${search.toString()}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${getKey()}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Ahrefs ${path} ${res.status}: ${detail.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Keywords Explorer — overview (volume + difficulty for a keyword)
// ---------------------------------------------------------------------------
export interface KeywordOverview {
  keyword: string
  volume: number | null
  difficulty: number | null
  cpc: number | null
  traffic_potential: number | null
  country: string
}

export async function keywordOverview(
  keyword: string,
  country = 'us'
): Promise<KeywordOverview> {
  const data = await ahrefsGet<{
    keywords?: Array<{
      keyword: string
      volume?: number
      difficulty?: number
      cpc?: number
      traffic_potential?: number
    }>
  }>('/keywords-explorer/overview', {
    keywords: keyword,
    country,
    select: 'keyword,volume,difficulty,cpc,traffic_potential',
  })
  const row = data.keywords?.[0]
  return {
    keyword,
    volume: row?.volume ?? null,
    difficulty: row?.difficulty ?? null,
    cpc: row?.cpc ?? null,
    traffic_potential: row?.traffic_potential ?? null,
    country,
  }
}

// ---------------------------------------------------------------------------
// Keywords Explorer — matching terms (gap discovery)
// ---------------------------------------------------------------------------
export interface MatchingTerm {
  keyword: string
  volume: number | null
  difficulty: number | null
  traffic_potential: number | null
}

export async function matchingTerms(
  seed: string,
  opts: { country?: string; limit?: number; minVolume?: number } = {}
): Promise<MatchingTerm[]> {
  const { country = 'us', limit = 50, minVolume = 50 } = opts
  const data = await ahrefsGet<{
    keywords?: Array<{
      keyword: string
      volume?: number
      difficulty?: number
      traffic_potential?: number
    }>
  }>('/keywords-explorer/matching-terms', {
    keywords: seed,
    country,
    limit,
    // NOTE: Ahrefs API v3 uses a `where` clause (not `volume_from`) for filtering.
    // Passing `volume_from` returns 400. We filter client-side below to keep
    // the code simple and avoid Ahrefs' bracket-expression quoting.
    select: 'keyword,volume,difficulty,traffic_potential',
    order_by: 'volume:desc',
  })
  return (data.keywords || [])
    .filter((k) => (k.volume ?? 0) >= minVolume)
    .map((k) => ({
      keyword: k.keyword,
      volume: k.volume ?? null,
      difficulty: k.difficulty ?? null,
      traffic_potential: k.traffic_potential ?? null,
    }))
}

// ---------------------------------------------------------------------------
// Site Explorer — organic keywords a target URL already ranks for
// ---------------------------------------------------------------------------
export interface OrganicKeyword {
  keyword: string
  position: number | null
  volume: number | null
  url: string
}

export async function organicKeywordsForUrl(
  target: string,
  opts: { country?: string; limit?: number } = {}
): Promise<OrganicKeyword[]> {
  const { country = 'us', limit = 100 } = opts
  const data = await ahrefsGet<{
    keywords?: Array<{
      keyword: string
      position?: number
      volume?: number
      url?: string
    }>
  }>('/site-explorer/organic-keywords', {
    target,
    country,
    mode: 'exact',
    limit,
    select: 'keyword,position,volume,url',
    order_by: 'volume:desc',
  })
  return (data.keywords || []).map((k) => ({
    keyword: k.keyword,
    position: k.position ?? null,
    volume: k.volume ?? null,
    url: k.url || target,
  }))
}

// ---------------------------------------------------------------------------
// Opportunity score — single place where the "is this worth writing?" math lives
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Title → seed keyword heuristic — rescues rows that came through without a
// keyword from the chat extractor. Strips common title openers, drops stop
// words, takes the first few content words. Ahrefs' matching-terms needs a
// short 2–4 word search phrase, not a full article title.
// ---------------------------------------------------------------------------
const TITLE_OPENERS = /^(the\s+ultimate\s+guide\s+to\s+|ultimate\s+guide\s+to\s+|a\s+(beginners?\s+)?guide\s+to\s+|how\s+much\s+(does|do|is)\s+(a\s+|an\s+)?|how\s+to\s+|how\s+do\s+(you\s+|i\s+)?|how\s+does\s+(a\s+|an\s+)?|what\s+to\s+(wear|avoid|do|expect)\s*(and\s+what\s+to\s+avoid\s+)?|what\s+(is|are)\s+(a\s+|an\s+|the\s+)?|why\s+(do|does|is|are)\s+|best\s+|top\s+\d*\s*|complete\s+guide\s+(to\s+)?)/i

const SEED_STOPWORDS = new Set([
  'for', 'and', 'or', 'the', 'to', 'of', 'in', 'on', 'at', 'a', 'an',
  'your', 'you', 'with', 'from', 'by', 'is', 'are', 'that', 'this',
  'any', 'all', 'some', 'every', 'my', 'actually', 'really',
])

export function deriveSeedKeyword(title: string): string {
  if (!title) return ''
  let s = title.toLowerCase()
  // Strip content in parens first so we don't lose the rest of the title
  s = s.replace(/\([^)]*\)/g, ' ')
  s = s.replace(TITLE_OPENERS, '')
  // Cut at colon / em-dash (they mark subtitles); keep the main clause
  s = s.split(/[:–—]/)[0]
  s = s.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = s.split(' ').filter((w) => w.length > 1 && !SEED_STOPWORDS.has(w))
  // Take the first 4 content words — this is what Ahrefs' matching-terms
  // needs as a seed (short, search-phrase-like, not a full sentence)
  return words.slice(0, 4).join(' ').trim() || title
}

export function computeOpportunityScore(input: {
  volume: number | null
  difficulty: number | null
  traffic_potential: number | null
}): number {
  const vol = input.volume ?? 0
  const tp = input.traffic_potential ?? vol
  const kd = input.difficulty ?? 30
  // Reward traffic, punish difficulty. Scaled 0-100.
  const raw = (Math.log10(Math.max(tp, 1)) * 25) - (kd * 0.4)
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10))
}

// ── SERP overview (Generate mode step 1b) ────────────────────────────────────
export interface SerpEntry {
  url: string
  title: string | null
  position: number
  domainRating: number | null
}

/** Top-10 organic results for a keyword, with DR — competitor phrasing +
 *  whether PPW already ranks. Returns [] on any failure. */
export async function serpOverview(keyword: string, country = 'us'): Promise<SerpEntry[]> {
  try {
    const data = await ahrefsGet<{ positions?: Array<Record<string, any>> }>('/serp-overview/serp-overview', {
      keyword,
      country,
      select: 'url,title,position,domain_rating',
      top_positions: '10',
    })
    return (data.positions || [])
      .filter((p) => p.url && p.position)
      .slice(0, 10)
      .map((p) => ({
        url: String(p.url),
        title: p.title ? String(p.title) : null,
        position: Number(p.position),
        domainRating: p.domain_rating != null ? Number(p.domain_rating) : null,
      }))
  } catch (err) {
    console.warn('[ahrefs] serpOverview failed:', err)
    return []
  }
}
