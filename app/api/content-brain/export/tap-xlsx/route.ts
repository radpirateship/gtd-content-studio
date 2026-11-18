// app/api/content-brain/export/tap-xlsx/route.ts
// Dynamic Topical Authority Plan exporter — pulls the current state of the
// content_brain table and emits a multi-sheet .xlsx matching the v19 schema,
// one sheet per cluster, live numbers baked in.
//
// Unlike the static v19 file, this exporter reflects every manual edit,
// new article added via Content Brain, status change, and Ahrefs refresh.
//
// GET → binary xlsx download
import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getSQL } from '@/lib/db'

export const maxDuration = 60

const TARGET_HEADERS = [
  'Type', 'Article Type', 'Title', 'Primary Keyword', 'Intent',
  'Word Count', 'Priority', 'Action', 'Existing URL', 'Notes',
  'KW Volume', 'KD', 'Traffic Potential', 'Title Tag',
  'Meta Description', 'URL Slug',
]

const HUB_ORDER = ['Saunas', 'Recovery', 'Wellness', 'Cardio', 'Cross-Topic']

interface Row {
  id: number
  title: string
  keyword: string | null
  hub: string | null
  cluster_group: string | null
  content_type: string | null
  article_type: string | null
  intent: string | null
  word_count: number | null
  priority: string | null
  status: string | null
  strategic_notes: string | null
  special_instructions: string | null
  kw_volume: number | null
  kw_difficulty: number | null
  traffic_potential: number | null
  url_slug: string | null
  ai_reasoning: string | null
}

export async function GET() {
  try {
    const sql = getSQL()
    const rows = (await sql`
      SELECT
        id, title, keyword, hub, cluster_group, content_type, article_type,
        intent, word_count, priority, status, strategic_notes, special_instructions,
        kw_volume, kw_difficulty, traffic_potential, url_slug, ai_reasoning
      FROM content_brain
      ORDER BY hub, cluster_group, content_type DESC, title
    `) as unknown as Row[]

    const wb = new ExcelJS.Workbook()
    wb.creator = 'PPW Content Brain'
    wb.created = new Date()

    // Summary sheet first — snapshot of state
    const summary = wb.addWorksheet('Summary', {
      views: [{ state: 'frozen', ySplit: 1 }],
    })
    summary.columns = [
      { header: 'Hub', key: 'hub', width: 16 },
      { header: 'Cluster', key: 'cluster', width: 28 },
      { header: 'Total', key: 'total', width: 9 },
      { header: 'Live', key: 'live', width: 9 },
      { header: 'Planned', key: 'planned', width: 10 },
      { header: 'In-Queue', key: 'inqueue', width: 10 },
      { header: 'Ideas', key: 'ideas', width: 9 },
      { header: 'Pillars', key: 'pillars', width: 9 },
    ]
    styleHeaderRow(summary)

    // Group by hub → cluster
    const grouped = new Map<string, Map<string, Row[]>>()
    for (const r of rows) {
      const hub = r.hub || 'Unassigned'
      const cluster = r.cluster_group || 'General'
      if (!grouped.has(hub)) grouped.set(hub, new Map())
      const m = grouped.get(hub)!
      if (!m.has(cluster)) m.set(cluster, [])
      m.get(cluster)!.push(r)
    }

    // Summary rows in hub order
    const orderedHubs = [
      ...HUB_ORDER.filter((h) => grouped.has(h)),
      ...[...grouped.keys()].filter((h) => !HUB_ORDER.includes(h)),
    ]
    for (const hub of orderedHubs) {
      const clusters = grouped.get(hub)!
      for (const [cluster, items] of clusters.entries()) {
        summary.addRow({
          hub,
          cluster,
          total: items.length,
          live: items.filter((i) => i.status === 'live').length,
          planned: items.filter((i) => i.status === 'planned').length,
          inqueue: items.filter((i) => i.status === 'in-queue').length,
          ideas: items.filter((i) => i.status === 'idea' || i.status === 'review').length,
          pillars: items.filter((i) => i.content_type === 'pillar').length,
        })
      }
    }
    // Total row
    const totalRow = summary.addRow({
      hub: 'TOTAL',
      cluster: `${[...grouped.values()].reduce((a, m) => a + m.size, 0)} clusters`,
      total: rows.length,
      live: rows.filter((r) => r.status === 'live').length,
      planned: rows.filter((r) => r.status === 'planned').length,
      inqueue: rows.filter((r) => r.status === 'in-queue').length,
      ideas: rows.filter((r) => r.status === 'idea' || r.status === 'review').length,
      pillars: rows.filter((r) => r.content_type === 'pillar').length,
    })
    totalRow.font = { bold: true }
    totalRow.getCell(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' },
    } as ExcelJS.Fill

    // One sheet per cluster, grouped by hub
    for (const hub of orderedHubs) {
      const clusters = grouped.get(hub)!
      for (const [cluster, items] of clusters.entries()) {
        const sheetName = safeSheetName(cluster)
        if (wb.getWorksheet(sheetName)) continue // unlikely, but safe
        const ws = wb.addWorksheet(sheetName, {
          views: [{ state: 'frozen', ySplit: 1 }],
        })
        ws.columns = TARGET_HEADERS.map((h) => ({
          header: h,
          key: h,
          width: headerWidth(h),
        }))
        styleHeaderRow(ws)
        for (const r of items) {
          const actionLabel =
            r.status === 'live' ? 'Keep'
              : r.status === 'planned' ? 'New'
              : r.status === 'in-queue' ? 'Generate'
              : r.status === 'review' ? 'Review'
              : r.status === 'idea' ? 'Idea'
              : ''
          const row = ws.addRow({
            Type: r.content_type === 'pillar' ? 'Pillar' : 'Cluster',
            'Article Type': r.article_type || '',
            Title: r.title,
            'Primary Keyword': r.keyword || '',
            Intent: r.intent || '',
            'Word Count': r.word_count || '',
            Priority: r.priority || '',
            Action: actionLabel,
            'Existing URL': r.url_slug?.startsWith('/') ? r.url_slug : (r.url_slug ? `/${r.url_slug}` : ''),
            Notes: r.strategic_notes || r.ai_reasoning || '',
            'KW Volume': r.kw_volume ?? '',
            KD: r.kw_difficulty ?? '',
            'Traffic Potential': r.traffic_potential ?? '',
            'Title Tag': '',
            'Meta Description': r.special_instructions || '',
            'URL Slug': r.url_slug || '',
          })
          // Color code Action column by status
          const actionCell = row.getCell(8)
          if (r.status === 'live') actionCell.font = { color: { argb: 'FF1A7A54' } }
          else if (r.status === 'planned') actionCell.font = { color: { argb: 'FFC05621' } }
          else if (r.status === 'in-queue') actionCell.font = { color: { argb: 'FF0066CC' } }
          else if (r.status === 'review') actionCell.font = { color: { argb: 'FFD69E2E' } }
        }
      }
    }

    const buffer = await wb.xlsx.writeBuffer()
    const filename = `PPW_Topical_Authority_${new Date().toISOString().slice(0, 10)}.xlsx`
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function styleHeaderRow(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1)
  row.font = { bold: true, color: { argb: 'FF003366' } }
  row.fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' },
  } as ExcelJS.Fill
  row.alignment = { horizontal: 'left', vertical: 'middle' }
  row.height = 22
}

function headerWidth(h: string): number {
  switch (h) {
    case 'Title': return 50
    case 'Primary Keyword': return 30
    case 'Notes': return 40
    case 'Title Tag': return 40
    case 'Meta Description': return 50
    case 'URL Slug':
    case 'Existing URL': return 32
    case 'Word Count': return 12
    default: return 16
  }
}

function safeSheetName(name: string): string {
  // Excel: max 31 chars, no : \ / ? * [ ]
  return name.replace(/[\\/?*\[\]:]/g, '').slice(0, 31) || 'Sheet'
}
