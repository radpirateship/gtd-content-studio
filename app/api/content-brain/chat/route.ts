// app/api/content-brain/chat/route.ts
// Conversational idea-capture endpoint.
//
// Two modes, auto-detected from input length:
//   - "voice-note" (<600 chars): one-off quick idea, expect 1-3 ideas out
//   - "brainstorm" (>=600 chars): long strategic doc, expect 5-20 ideas out
//
// Uses Anthropic tool_use so the model MUST return structured JSON — this
// eliminates the free-form-prose-breaks-JSON-parse class of failures. Falls
// back to forgiving substring extraction if tool_use isn't returned.
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const HUB_MAP = `
Saunas:
  Infrared Saunas (slug: infrared-saunas)
  Barrel Saunas (slug: barrel-saunas)
  Traditional Saunas (slug: traditional-saunas)
  Sauna Heaters (slug: sauna-heaters)
  Sauna Accessories (slug: sauna-accessories)
  Sauna Kits (slug: sauna-kits)
  Steam (slug: steam)

Recovery:
  Cold Plunges (slug: cold-plunges)
  Red Light Therapy (slug: red-light-therapy)
  Hyperbaric Chambers (slug: hyperbaric-chambers)
  Sensory Deprivation Tanks (slug: sensory-deprivation-tanks)
  Massage Equipment (slug: massage-equipment)
  Compression Boots (slug: compression-boots)

Wellness:
  Hydrogen Water (slug: hydrogen-water)
  Water Ionizers (slug: water-ionizers)
  Air Purifiers (slug: air-purifiers)

Cardio:
  Treadmills (slug: treadmills)
  Elliptical Machines (slug: elliptical-machines)
  Exercise Bikes (slug: exercise-bikes)
  Stair Climbers (slug: stair-climbers)
  Vertical Climbers (slug: vertical-climbers)
  Pilates (slug: pilates)
`.trim()

const SYSTEM_PROMPT = `
You are the Content Brain for Peak Primal Wellness (PPW), a premium wellness-equipment retailer.
Your job: take the user's input (voice notes, pasted brainstorms, strategic memos, competitor research,
anything) and extract every discrete article idea implied by it, each mapped to PPW's taxonomy.

CANONICAL NAMING — NEVER violate:
- "Sensory Deprivation Tanks" (never "Float Tanks")
- "Cold Plunges" / slug "cold-plunges" (always plural)
- "Massage Equipment" / slug "massage-equipment" (never "Massage Chairs")

HUB MAP (authoritative — cluster_group and collection_slug MUST match exactly):
${HUB_MAP}

KEYWORD RULE — CRITICAL:
Every idea MUST include a primary keyword. The keyword is what a searcher
actually types into Google — NOT the full article title. It should be:
- 2 to 5 words long
- A real search phrase (e.g. "hyperbaric chamber benefits", "best compression boots",
  "red light therapy belly fat")
- Lowercase
- NOT a sentence, question, or the article title repeated

Good keywords for sample titles:
  "Best Hyperbaric Chambers for Med Spas and Wellness Clinics" → "hyperbaric chamber med spa"
  "How to Equalize Ear Pressure in a Home Hyperbaric Chamber" → "hyperbaric chamber ear pressure"
  "Home Hyperbaric Chamber Electrical Requirements" → "hyperbaric chamber electrical requirements"

EXTRACTION RULES:
1. When the input contains explicit "New Topic:", "Article Idea:", or bullet-listed titles,
   create ONE idea per line — do not merge them.
2. When the input contains strategic themes or "Strategy:" notes, attach that context to the
   special_instructions of every article that falls under the theme.
3. Preserve the user's reasoning in special_instructions so the writer knows WHY this article
   matters (ROI play, pre-purchase objection, CRO lift, etc.).
4. For pure strategic/CRO advice that isn't itself an article (e.g. "push financing harder in
   existing articles"), do NOT invent an article — mention it in the clarification field.
5. Infer the correct hub and cluster_group from the topic. If the input is about hyperbaric
   chambers, every idea goes in Recovery → Hyperbaric Chambers unless stated otherwise.
6. If the input is ambiguous, still extract what you can and use clarification for follow-ups.

You will be given a submit_ideas tool — call it exactly once with all extracted ideas.
`.trim()

const TOOL = {
  name: 'submit_ideas',
  description: 'Submit the extracted article ideas and any clarifying follow-up question.',
  input_schema: {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            keyword: { type: 'string' },
            hub: {
              type: 'string',
              enum: ['Saunas', 'Recovery', 'Wellness', 'Cardio'],
            },
            cluster_group: { type: 'string' },
            collection: { type: 'string' },
            collection_slug: { type: 'string' },
            content_type: { type: 'string', enum: ['pillar', 'cluster'] },
            article_type: {
              type: 'string',
              enum: [
                'buyers-guide',
                'comparison',
                'how-to',
                'listicle',
                'benefit-deep-dive',
                'brand-review',
                'ultimate-guide',
                'faq',
                'celebrity',
                'exercise-science',
              ],
            },
            audience: {
              type: 'string',
              enum: ['general', 'enthusiast', 'athlete', 'first-time', 'professional'],
            },
            tone: { type: 'string', enum: ['educational', 'authoritative', 'comparison'] },
            word_count: { type: 'integer' },
            special_instructions: { type: 'string' },
            reasoning: { type: 'string' },
          },
          required: [
            'title',
            'keyword',
            'hub',
            'cluster_group',
            'collection_slug',
            'content_type',
            'article_type',
          ],
        },
      },
      clarification: {
        type: 'string',
        description:
          'Optional follow-up question, or strategic advice that did not map to a specific article. Empty string if none.',
      },
    },
    required: ['ideas', 'clarification'],
  },
}

type Msg = { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  try {
    const { message, conversationHistory = [] } = (await req.json()) as {
      message: string
      conversationHistory?: Msg[]
    }

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    // Size budget scales with input length — long brainstorms need lots of room.
    const isBrainstorm = message.length >= 600
    const maxTokens = isBrainstorm ? 8000 : 2000

    const messages = [
      ...conversationHistory
        .filter((m) => m && m.role && m.content)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message },
    ]

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'submit_ideas' },
        messages,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: 'Claude API error', detail: err }, { status: 502 })
    }

    const data = await response.json()

    // Preferred path: tool_use block with structured input
    const toolBlock = (data.content || []).find(
      (b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'submit_ideas'
    ) as { input?: { ideas?: unknown[]; clarification?: string } } | undefined

    if (toolBlock?.input) {
      return NextResponse.json({
        ideas: Array.isArray(toolBlock.input.ideas) ? toolBlock.input.ideas : [],
        clarification: toolBlock.input.clarification || '',
        mode: isBrainstorm ? 'brainstorm' : 'voice-note',
      })
    }

    // Fallback: forgiving JSON extraction from a text block
    const textBlock = (data.content || []).find((b: { type: string }) => b.type === 'text') as
      | { text?: string }
      | undefined
    const raw = textBlock?.text || ''
    const extracted = extractJson(raw)
    if (extracted) {
      return NextResponse.json({
        ideas: Array.isArray(extracted.ideas) ? extracted.ideas : [],
        clarification: extracted.clarification || '',
        mode: isBrainstorm ? 'brainstorm' : 'voice-note',
        fallback: 'text-extract',
      })
    }

    return NextResponse.json({
      ideas: [],
      clarification:
        'I could not extract ideas from that input. Try a shorter, more focused brainstorm or paste one theme at a time.',
      raw: raw.slice(0, 500),
      stop_reason: data.stop_reason,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Find the outermost {...} in a string and try to parse it. Handles cases
// where the model wraps JSON in prose or trailing commentary.
function extractJson(s: string): { ideas?: unknown[]; clarification?: string } | null {
  if (!s) return null
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const slice = s.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch {
    // Try stripping trailing commas
    try {
      return JSON.parse(slice.replace(/,(\s*[}\]])/g, '$1'))
    } catch {
      return null
    }
  }
}
