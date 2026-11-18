// app/api/collections/analyze/route.ts
// POST — Claude-powered keyword gap analysis for a collection page
// Given body_html + missing keywords, Claude identifies the optimal insertion point
// for each keyword and returns structured surgical suggestions.
import { NextRequest, NextResponse } from 'next/server'
import { callAI } from '@/lib/ai'

export const maxDuration = 120

interface AnalyzeRequest {
  body_html: string
  collection_title: string
  primary_keyword: string
  missing_keywords: string[]
  present_keywords: string[]
}

export interface KeywordSuggestion {
  keyword: string
  location: string          // human-readable location in the doc
  type: 'modify_sentence' | 'new_sentence' | 'new_paragraph' | 'modify_heading'
  original_text: string     // the existing text to replace (empty for new_paragraph)
  suggested_text: string    // the replacement / new text
  rationale: string         // why this location is optimal
}

export async function POST(req: NextRequest) {
  const body = await req.json() as AnalyzeRequest
  const { body_html, collection_title, primary_keyword, missing_keywords, present_keywords } = body

  if (!body_html || !missing_keywords?.length) {
    return NextResponse.json({ error: 'body_html and missing_keywords are required' }, { status: 400 })
  }

  // Remove <style>/<script> blocks FIRST so their CSS/JS text is never seen as
  // prose. (Stripping tags alone leaves the CSS text between <style>…</style>,
  // which the AI then treats as "sentences" to modify.)
  const cleanedBodyHtml = body_html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim()

  // Strip HTML for readability in prompt, keep structure visible
  const structuredContent = cleanedBodyHtml
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) =>
      `\n[H${level}] ${text.replace(/<[^>]*>/g, '').trim()}\n`
    )
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) =>
      `\n[P] ${text.replace(/<[^>]*>/g, '').trim()}\n`
    )
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) =>
      `[LI] ${text.replace(/<[^>]*>/g, '').trim()}\n`
    )
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 12000) // cap to keep within token budget

  const systemPrompt = `You are an expert SEO content editor for Green Thumb Depot, a premium wellness and fitness equipment retailer. Your job is to surgically insert missing keywords into existing collection page content in a way that reads naturally and adds genuine value.

RULES:
- Never keyword-stuff. Each insertion must read naturally and add meaning.
- Prefer modifying existing sentences over adding new ones when natural.
- For new sentences, they must flow logically from surrounding context.
- New paragraphs are a last resort — only when there is genuinely no good insertion point.
- The brand voice is expert, direct, and specific. No filler phrases.
- If no modifiable text sentences exist in the provided content (e.g. it is only structural markup, headings, or product lists with no visible prose), do NOT generate a "modify_sentence" or "modify_heading" suggestion against non-prose. In that case only generate "new_sentence" / "new_paragraph" suggestions that add keyword-rich prose at an appropriate location. Never treat CSS, code, or attribute values as editable text.
- You must return ONLY valid JSON — no markdown, no explanation outside the JSON.`

  const userPrompt = `Collection page: "${collection_title}"
Primary keyword: "${primary_keyword}"
Already present keywords: ${present_keywords.join(', ')}
Missing keywords to insert: ${missing_keywords.join(', ')}

Here is the structured content of the collection page:
---
${structuredContent}
---

For each missing keyword, find the optimal place in the content to insert it naturally. Return a JSON array with one object per missing keyword:

[
  {
    "keyword": "the missing keyword",
    "location": "brief description of where in the page (e.g., 'Opening paragraph', 'H2 heading about soft shell chambers', 'Buying guide pricing paragraph')",
    "type": "modify_sentence | new_sentence | new_paragraph | modify_heading",
    "original_text": "the exact existing text that will be modified (empty string if adding a new paragraph with no replacement)",
    "suggested_text": "the new version of that text, or the new sentence/paragraph to add",
    "rationale": "one sentence explaining why this location is optimal for this keyword"
  }
]

Only return the JSON array. No other text.`

  try {
    const raw = await callAI(systemPrompt, userPrompt, {
      maxTokens: 4096,
      timeoutMs: 90000,
    })

    // Extract JSON from response
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'AI returned unexpected format', raw: raw.slice(0, 500) }, { status: 500 })
    }

    const suggestions: KeywordSuggestion[] = JSON.parse(jsonMatch[0])

    return NextResponse.json({
      suggestions,
      keywords_analyzed: missing_keywords.length,
      suggestions_returned: suggestions.length,
    })
  } catch (err) {
    console.error('[collections/analyze] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 }
    )
  }
}
