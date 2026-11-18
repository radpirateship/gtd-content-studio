// POST /api/collections/seo-suggestions
// Generates TWO title-tag options and TWO meta-description options for a
// collection, built from all of its target keywords.
// Body: { collection_title, keywords: string[], current_title?, current_description? }
import { type NextRequest, NextResponse } from 'next/server'
import { callAI } from '@/lib/ai'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      collection_title?: string
      keywords?: string[]
      current_title?: string
      current_description?: string
    }
    const keywords = (body.keywords || []).map((k) => (k || '').trim()).filter(Boolean)
    const collectionTitle = (body.collection_title || '').trim()
    if (!collectionTitle && keywords.length === 0) {
      return NextResponse.json({ error: 'collection_title or keywords are required' }, { status: 400 })
    }

    const system = `You are an SEO specialist for Green Thumb Depot, a premium wellness and fitness equipment retailer. You write collection-page SEO title tags and meta descriptions that maximize click-through and rank for the target keywords.

RULES:
- Title tags: 50-60 characters. Lead with the most important keyword. Add "Green Thumb Depot" only if it fits the length.
- Meta descriptions: 150-160 characters. Benefit-driven and specific, weave the keywords in naturally, end with a soft call to action.
- Never keyword-stuff; every option must read naturally.
- The two title options should take genuinely different angles (e.g. one keyword-led, one benefit-led). Same for the descriptions.
- Return ONLY valid JSON, no markdown.`

    const user = `Collection: "${collectionTitle}"
Target keywords (primary first): ${keywords.join(', ') || '(none)'}
Current title tag: ${body.current_title || '(none)'}
Current meta description: ${body.current_description || '(none)'}

Write TWO distinct title-tag options and TWO distinct meta-description options that together cover the keywords above. Return JSON exactly:
{ "titles": ["option 1", "option 2"], "descriptions": ["option 1", "option 2"] }`

    let raw = await callAI(system, user, { maxTokens: 1000, timeoutMs: 90000 })
    raw = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()

    let parsed: { titles?: string[]; descriptions?: string[] } = {}
    try {
      parsed = JSON.parse(raw)
    } catch {
      const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
      if (s >= 0 && e > s) {
        try { parsed = JSON.parse(raw.slice(s, e + 1)) } catch { /* leave empty */ }
      }
    }

    const titles = (parsed.titles || []).filter(Boolean).slice(0, 2)
    const descriptions = (parsed.descriptions || []).filter(Boolean).slice(0, 2)
    if (titles.length === 0 && descriptions.length === 0) {
      return NextResponse.json({ error: 'Could not parse AI output' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, titles, descriptions })
  } catch (err) {
    console.error('[collections/seo-suggestions]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Generation failed' }, { status: 500 })
  }
}
