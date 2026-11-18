// app/api/collections/export/route.ts
//
// One endpoint, two jobs:
//   GET  /api/collections/export             -> CSV download of every collection
//   GET  /api/collections/export?format=json -> same rows as JSON
//
// This is the round-trip surface. Export, edit in Excel or Sheets, then POST the
// same file back to /api/collections/import. Column headers are the round-trip
// contract: the importer matches on them, so do not rename them.
//
// Filters mirror /api/collections so a filtered view exports what you see:
//   ?category=Clinical  ?type=brand  ?priority=P1  ?optimized=false
//   ?minVolume=500      ?hidden=false

import { type NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { ensureCollectionColumns } from '@/lib/ensureCollectionColumns'

export const maxDuration = 60

// Order matters — this is the exported column order and the import contract.
export const EXPORT_COLUMNS = [
  'slug',
  'url',
  'category',
  'collection_type',
  'tier',
  'status',
  'priority',
  'primary_keyword',
  'secondary_keywords',
  'search_volume',
  'kd',
  'title_tag',
  'meta_description',
  'current_position',
  'current_impressions',
  'estimated_impact',
  'is_optimized',
  'ultimate_guide_title',
  'ultimate_guide_url',
  'notes',
  // Synced from Shopify — informational, ignored on import
  'tags',
  'rule_summary',
  'product_count',
  'word_count',
  'score',
  'is_published',
  'is_hidden',
  'last_synced_at',
] as const

// Columns the importer will never write back. They are Shopify-owned or
// derived, so a stale spreadsheet value must not overwrite a fresh sync.
export const READ_ONLY_COLUMNS = new Set([
  'tags', 'rule_summary', 'product_count', 'word_count', 'score',
  'is_published', 'last_synced_at',
])

function toCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(' | ')
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  const escape = (s: string) =>
    /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  const lines = [EXPORT_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(EXPORT_COLUMNS.map((c) => escape(toCell(row[c]))).join(','))
  }
  // BOM so Excel opens UTF-8 correctly on Windows.
  return '﻿' + lines.join('\r\n')
}

export async function GET(req: NextRequest) {
  try {
    const sql = getSQL()
    await ensureCollectionColumns(sql)

    const { searchParams } = new URL(req.url)
    const format = (searchParams.get('format') || 'csv').toLowerCase()
    const category = searchParams.get('category') || ''
    const type = searchParams.get('type') || ''
    const priority = searchParams.get('priority') || ''
    const optimized = searchParams.get('optimized') || ''
    const hidden = searchParams.get('hidden') || ''
    const minVolume = Number(searchParams.get('minVolume') || '') || null

    const all = (await sql`
      SELECT * FROM gtd_collections
      ORDER BY search_volume DESC NULLS LAST, category, slug
    `) as Array<Record<string, unknown>>

    let rows = all
    if (category) rows = rows.filter((r) => r.category === category)
    if (type) rows = rows.filter((r) => r.collection_type === type)
    if (priority) rows = rows.filter((r) => String(r.priority) === priority)
    if (optimized) rows = rows.filter((r) => String(r.is_optimized === true) === optimized)
    if (hidden) rows = rows.filter((r) => String(r.is_hidden === true) === hidden)
    if (minVolume !== null) rows = rows.filter((r) => Number(r.search_volume || 0) >= minVolume)

    if (format === 'json') {
      return NextResponse.json({ collections: rows, total: rows.length })
    }

    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="gtd_collections_${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[collections/export] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    )
  }
}
