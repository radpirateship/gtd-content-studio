// lib/seoGrade.ts
// THE single collection score, used by BOTH the Revamp tool (/api/collections/grade)
// and the catalog Audit Queue (/api/collections/grade-all), so the number you see
// after improving a collection is exactly the number the queue shows.
//
// Scores ONLY what is editable from this app (keywords, title tag, meta description,
// on-page copy, internal blog links). Theme-handled structure (FAQ/ItemList/
// Breadcrumb schema, product-card markup) is intentionally NOT scored — Shopify
// renders that, the app can't change it, so counting it would be a false negative.
//
// Rubric (100 pts):
//   Primary keyword zones   40  (title 10, meta 10, H1/opening 10, an H2 10)
//   Secondary keyword cover 30  (linear: present / total)
//   Technical compliance    15  (title length 5, meta length 5, copy length 5)
//   Internal blog links     15  (any blog link 8, + a hub/DB article link 7)

export interface SeoGradeInput {
  body_html: string
  seo_title: string
  seo_description: string
  primary_keyword: string
  keywords: string[]          // full list incl. primary
  article_urls?: string[]     // known DB article urls — for hub-link credit
}

export interface SeoGradeResult {
  total: number
  breakdown: {
    primary: { score: number; max: 40; inTitle: boolean; inMeta: boolean; inH1orOpening: boolean; inH2: boolean }
    coverage: { score: number; max: 30; present: number; total: number }
    technical: { score: number; max: 15; titleLen: number; titleOk: boolean; metaLen: number; metaOk: boolean; wordCount: number; contentOk: boolean }
    links: { score: number; max: 15; hasAnyArticleLink: boolean; hasHubArticleLink: boolean }
  }
  topIssues: string[]
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function extractH1(html: string) { const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); return m ? stripHtml(m[1]) : '' }
function extractH2s(html: string) { return [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => stripHtml(m[1])) }
function extractLinks(html: string) { return [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]) }
function firstNWords(html: string, n = 80) { return stripHtml(html).split(/\s+/).slice(0, n).join(' ').toLowerCase() }
// Plural/singular-tolerant keyword match: "sauna heater" matches "sauna
// heaters", "exercise bikes" matches "exercise bike". The research doc and
// live Shopify copy drift on pluralization; exact substring caused false
// "keyword missing" failures.
function kwPattern(kw: string): string {
  return kw.toLowerCase().trim().split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, "").replace(/([^s])s$/, "$1") + "s?")
    .filter((w) => w.length > 2)
    .join("[\\s-]+")
}
function has(text: string, kw: string) {
  if (!kw) return false
  try { return new RegExp(kwPattern(kw), "i").test(text) } catch { return text.toLowerCase().includes(kw.toLowerCase()) }
}

export function computeSeoGrade(input: SeoGradeInput): SeoGradeResult {
  const { body_html, seo_title, seo_description, primary_keyword } = input
  const keywords = (input.keywords || []).map((k) => (k || '').trim()).filter(Boolean)
  const article_urls = input.article_urls || []

  const fullText = stripHtml(body_html || '').toLowerCase()
  const h1 = extractH1(body_html || '').toLowerCase()
  const h2s = extractH2s(body_html || '')
  const opening = firstNWords(body_html || '', 80)
  const links = extractLinks(body_html || '').map((l) => l.toLowerCase())
  const wordCount = fullText.split(/\s+/).filter(Boolean).length

  const pk = (primary_keyword || '').toLowerCase()
  const inTitle = has(seo_title || '', pk)
  const inMeta = has(seo_description || '', pk)
  const inH1orOpening = has(h1, pk) || has(opening, pk)
  const inH2 = h2s.some((h) => has(h, pk))
  const primaryScore = (inTitle ? 10 : 0) + (inMeta ? 10 : 0) + (inH1orOpening ? 10 : 0) + (inH2 ? 10 : 0)

  const totalKws = keywords.length
  const presentCount = keywords.filter((kw) => has(fullText, kw)).length
  const coverageScore = totalKws > 0 ? Math.round((presentCount / totalKws) * 30) : 0

  const titleLen = (seo_title || '').length
  const metaLen = (seo_description || '').length
  const titleOk = titleLen >= 40 && titleLen <= 70
  const metaOk = metaLen >= 100 && metaLen <= 165
  const contentOk = wordCount >= 350
  const technicalScore = (titleOk ? 5 : titleLen > 0 ? 2 : 0) + (metaOk ? 5 : metaLen > 0 ? 2 : 0) + (contentOk ? 5 : wordCount > 150 ? 2 : 0)

  const ppwDomain = 'peakprimalwellness.com'
  const hasAnyArticleLink = links.some((l) => l.includes(`${ppwDomain}/blogs/`) || l.startsWith('/blogs/'))
  const hasHubArticleLink = article_urls.length > 0
    ? article_urls.some((u) => links.some((l) => l.includes(u.toLowerCase().replace(/^https?:\/\//, ''))))
    : false
  const linkScore = hasAnyArticleLink ? (hasHubArticleLink || article_urls.length === 0 ? 15 : 8) : 0

  const total = primaryScore + coverageScore + technicalScore + linkScore

  const topIssues: string[] = []
  if (!inTitle) topIssues.push('Keyword not in title tag')
  if (totalKws > 0 && presentCount < totalKws) topIssues.push(`${presentCount}/${totalKws} keywords in copy`)
  if (!inMeta) topIssues.push('Keyword not in meta description')
  if (!inH1orOpening) topIssues.push('Keyword not in H1 / opening')
  if (!inH2) topIssues.push('Keyword not in any H2')
  if (!hasAnyArticleLink) topIssues.push('No internal blog link')
  if (!titleOk) topIssues.push(`Title length ${titleLen} (want 40-70)`)
  if (!metaOk) topIssues.push(`Meta length ${metaLen} (want ~150-160)`)
  if (!contentOk) topIssues.push(`Thin copy (${wordCount} words)`)

  return {
    total,
    breakdown: {
      primary: { score: primaryScore, max: 40, inTitle, inMeta, inH1orOpening, inH2 },
      coverage: { score: coverageScore, max: 30, present: presentCount, total: totalKws },
      technical: { score: technicalScore, max: 15, titleLen, titleOk, metaLen, metaOk, wordCount, contentOk },
      links: { score: linkScore, max: 15, hasAnyArticleLink, hasHubArticleLink },
    },
    topIssues,
  }
}
