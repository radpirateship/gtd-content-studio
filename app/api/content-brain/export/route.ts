// app/api/content-brain/export/route.ts
// Export selected content_brain rows as the 10-column PPW bulk-upload CSV.
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

const COLUMNS = [
  'title',
  'keyword',
  'collection',
  'articleType',
  'audience',
  'tone',
  'wordCount',
  'includeComparisonTable',
  'specialInstructions',
  'priority',
] as const

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export async function POST(req: NextRequest) {
  const sql = getSQL()
  const body = await req.json()
  const ids: number[] = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : []

  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 })
  }

  const rows = (await sql`
    SELECT * FROM content_brain WHERE id = ANY(${ids})
    ORDER BY hub, cluster_group, title
  `) as unknown as Record<string, unknown>[]

  const header = COLUMNS.join(',')
  const lines = rows.map((r) =>
    [
      csvEscape(r.title),
      csvEscape(r.keyword),
      csvEscape(r.collection),
      csvEscape(r.article_type),
      csvEscape(r.audience),
      csvEscape(r.tone),
      csvEscape(r.word_count ?? 2500),
      csvEscape(r.include_comparison_table ? 'true' : 'false'),
      csvEscape(r.special_instructions),
      csvEscape(r.priority),
    ].join(',')
  )
  const csv = [header, ...lines].join('\n')

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ppw-content-queue-${timestamp}.csv"`,
    },
  })
}
