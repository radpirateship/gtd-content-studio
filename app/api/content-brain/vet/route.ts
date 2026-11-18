// app/api/content-brain/vet/route.ts
// AI vetting: assess a content_brain row against keyword collisions, strategic
// fit for GTD, and brief completeness. Returns a traffic_light + reasoning.
// Does NOT save — the front end persists after the user confirms or overrides.
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

const SYSTEM_PROMPT = `
You are the Content Brain vetting assistant for Green Thumb Depot (GTD), a wellness equipment retailer
with topical authority clusters across Saunas, Recovery, Wellness, and Cardio.

Your job: given a candidate article and the list of titles + keywords already in the content brain,
assign a traffic light and explain your reasoning.

TRAFFIC LIGHT GUIDANCE:
- green  → clear strategic fit, no keyword collision, brief is reasonably complete, ready to queue
- yellow → plausible fit but concerns (weak brief, missing article_type/audience, adjacent keyword, niche angle)
- red    → strong keyword collision with an existing row, off-brand topic (e.g. not wellness equipment),
           or the brief is too vague to action

Assess:
1. KEYWORD COLLISION (case-insensitive, fuzzy): does this target the same search intent as an existing row?
2. STRATEGIC FIT: does it fit one of GTD's hubs and advance topical authority?
3. BRIEF COMPLETENESS: does it have a clear article_type, audience, and cluster mapping?

OUTPUT FORMAT — CRITICAL:
Return ONLY valid JSON, no preamble, no markdown fences:
{
  "traffic_light": "green" | "yellow" | "red",
  "reasoning": "2-4 sentences explaining the call, citing any colliding row by title"
}
`.trim()

export async function POST(req: NextRequest) {
  try {
    const { id } = (await req.json()) as { id?: number }
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const sql = getSQL()
    const [candidate] = (await sql`SELECT * FROM content_brain WHERE id = ${id}`) as unknown as Array<
      Record<string, unknown>
    >
    if (!candidate) return NextResponse.json({ error: 'Row not found' }, { status: 404 })

    const others = (await sql`
      SELECT id, title, keyword, hub, cluster_group, status
      FROM content_brain
      WHERE id <> ${id}
      ORDER BY updated_at DESC
      LIMIT 500
    `) as unknown as Array<{
      id: number
      title: string
      keyword: string | null
      hub: string | null
      cluster_group: string | null
      status: string
    }>

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

    const candidateSummary = {
      title: candidate.title,
      keyword: candidate.keyword,
      hub: candidate.hub,
      cluster_group: candidate.cluster_group,
      content_type: candidate.content_type,
      article_type: candidate.article_type,
      audience: candidate.audience,
      special_instructions: candidate.special_instructions,
    }

    const existingList = others
      .map((o) => `- [${o.status}] ${o.title}${o.keyword ? ` (kw: ${o.keyword})` : ''} — ${o.hub || '?'} / ${o.cluster_group || '?'}`)
      .join('\n')

    const userMessage = `CANDIDATE ARTICLE:
${JSON.stringify(candidateSummary, null, 2)}

EXISTING CONTENT BRAIN (${others.length} rows):
${existingList || '(empty)'}

Assess and return JSON only.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: 'Claude API error', detail: err }, { status: 502 })
    }

    const data = await response.json()
    const textBlock = (data.content || []).find((b: { type: string }) => b.type === 'text')
    const rawText: string = textBlock?.text || ''

    let parsed: { traffic_light?: string; reasoning?: string } = {}
    try {
      const cleaned = rawText
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim()
      parsed = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({
        traffic_light: 'yellow',
        reasoning: `Could not parse AI response. Raw: ${rawText.slice(0, 300)}`,
      })
    }

    const light = ['green', 'yellow', 'red'].includes(parsed.traffic_light || '')
      ? parsed.traffic_light
      : 'yellow'

    return NextResponse.json({
      traffic_light: light,
      reasoning: parsed.reasoning || 'No reasoning returned.',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
