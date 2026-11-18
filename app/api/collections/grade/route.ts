// app/api/collections/grade/route.ts
// POST — grade a collection page's SEO health
// Scoring rubric (100 pts total):
//   Primary keyword zones   40 pts  (title tag 10, meta 10, H1/opening 10, H2 10)
//   Secondary keyword cover 30 pts  (linear, based on n present / total)
//   Technical compliance    15 pts  (title length 5, meta length 5, content length 5)
//   Internal article links  15 pts  (any linked article 8, linked to hub article 7)
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

interface GradeRequest {
  body_html: string
  seo_title: string
  seo_description: string
  primary_keyword: string
  keywords: string[]          // full list including primary
  article_urls?: string[]     // urls of articles in the gtd DB — for link detection
}

function stripHtml(html: string) {
  // Drop <style>/<script> blocks first so their CSS/JS text doesn't leak into
  // the keyword-presence text and cause false positives.
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractH1(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  return m ? stripHtml(m[1]) : ''
}

function extractH2s(html: string): string[] {
  const matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
  return matches.map(m => stripHtml(m[1]))
}

function extractLinks(html: string): string[] {
  const matches = [...html.matchAll(/href=["']([^"']+)["']/gi)]
  return matches.map(m => m[1])
}

function firstNWords(html: string, n = 80): string {
  return stripHtml(html).split(/\s+/).slice(0, n).join(' ').toLowerCase()
}

function containsKeyword(text: string, kw: string): boolean {
  return text.toLowerCase().includes(kw.toLowerCase())
}

export async function POST(req: NextRequest) {
  const body = await req.json() as GradeRequest
  const { body_html, seo_title, seo_description, primary_keyword, keywords, article_urls = [] } = body

  if (!primary_keyword || !body_html) {
    return NextResponse.json({ error: 'body_html and primary_keyword are required' }, { status: 400 })
  }

  const fullText = stripHtml(body_html).toLowerCase()
  const h1 = extractH1(body_html).toLowerCase()
  const h2s = extractH2s(body_html)
  const opening = firstNWords(body_html, 80)
  const links = extractLinks(body_html)
  const wordCount = fullText.split(/\s+/).filter(Boolean).length

  // ── Primary keyword zones (40 pts) ──────────────────────────────────────
  const pk = primary_keyword.toLowerCase()

  const inTitle = containsKeyword(seo_title, pk)
  const inMeta = containsKeyword(seo_description, pk)
  const inH1orOpening = containsKeyword(h1, pk) || containsKeyword(opening, pk)
  const inH2 = h2s.some(h => containsKeyword(h, pk))

  const primaryScore = (inTitle ? 10 : 0) + (inMeta ? 10 : 0) + (inH1orOpening ? 10 : 0) + (inH2 ? 10 : 0)

  // ── Secondary keyword coverage (30 pts) ─────────────────────────────────
  const secondaryKws = keywords.filter(k => k.toLowerCase() !== pk)
  const kwResults = keywords.map(kw => {
    const present = containsKeyword(fullText, kw)
    const inH2kw = h2s.some(h => containsKeyword(h, kw))
    return { keyword: kw, present, inH2: inH2kw }
  })
  const presentCount = kwResults.filter(k => k.present).length
  const totalKws = keywords.length
  const coveragePct = totalKws > 0 ? presentCount / totalKws : 0
  const secondaryScore = Math.round(coveragePct * 30)

  // ── Technical compliance (15 pts) ───────────────────────────────────────
  const titleLen = seo_title.length
  const metaLen = seo_description.length
  const titleOk = titleLen >= 40 && titleLen <= 70
  const metaOk = metaLen >= 100 && metaLen <= 165
  const contentOk = wordCount >= 350

  const technicalScore = (titleOk ? 5 : titleLen > 0 ? 2 : 0) +
                         (metaOk ? 5 : metaLen > 0 ? 2 : 0) +
                         (contentOk ? 5 : wordCount > 150 ? 2 : 0)

  // ── Internal article links (15 pts) ─────────────────────────────────────
  // Check if any of the site's known article URLs appear in the collection body links
  const gtdDomain = 'greenthumbdepot.com'
  const allLinks = links.map(l => l.toLowerCase())

  // Any internal link to a blog article
  const hasAnyArticleLink = allLinks.some(l =>
    l.includes(`${gtdDomain}/blogs/`) || l.startsWith('/blogs/')
  )

  // Hub article = an article from the DB whose URL appears in the body
  const hasHubArticleLink = article_urls.length > 0
    ? article_urls.some(url => allLinks.some(l => l.includes(url.toLowerCase().replace(/^https?:\/\//, ''))))
    : false

  // If no article_urls were passed, give partial credit if any /blogs/ link exists
  const linkScore = hasAnyArticleLink
    ? (hasHubArticleLink || article_urls.length === 0 ? 15 : 8)
    : 0

  // ── Total ────────────────────────────────────────────────────────────────
  const total = primaryScore + secondaryScore + technicalScore + linkScore

  return NextResponse.json({
    total,
    breakdown: {
      primary_keyword: {
        score: primaryScore,
        max: 40,
        detail: { inTitle, inMeta, inH1orOpening, inH2 },
      },
      keyword_coverage: {
        score: secondaryScore,
        max: 30,
        present: presentCount,
        total: totalKws,
        keywords: kwResults,
      },
      technical: {
        score: technicalScore,
        max: 15,
        detail: {
          title_length: titleLen,
          title_ok: titleOk,
          meta_length: metaLen,
          meta_ok: metaOk,
          word_count: wordCount,
          content_ok: contentOk,
        },
      },
      article_links: {
        score: linkScore,
        max: 15,
        has_any_article_link: hasAnyArticleLink,
        has_hub_article_link: hasHubArticleLink,
      },
    },
    meta: {
      h1,
      h2_count: h2s.length,
      h2s,
      word_count: wordCount,
      secondary_keyword_count: secondaryKws.length,
    },
  })
}
