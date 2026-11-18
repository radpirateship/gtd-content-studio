// app/api/collections/import/route.ts
//
// POST /api/collections/import
//   body: raw CSV text, or { csv: "..." }, or { rows: [{...}] }
//   query: ?dryRun=true  -> parse, validate and report, write nothing
//
// The other half of the export round-trip. Match on `slug`. Only columns
// actually present in the uploaded file are written, so a trimmed spreadsheet
// with three columns updates exactly those three and leaves everything else
// alone. Shopify-owned columns are ignored even if present.
//
// Always run with ?dryRun=true first. It reports unknown slugs and bad values
// without touching the table.

import { type NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { ensureCollectionColumns } from '@/lib/ensureCollectionColumns'
import { READ_ONLY_COLUMNS } from '../export/route'

export const maxDuration = 120

const WRITABLE = [
  'url', 'category', 'collection_type', 'tier', 'status', 'priority',
  'primary_keyword', 'secondary_keywords', 'search_volume', 'kd',
  'title_tag', 'meta_description', 'current_position', 'current_impressions',
  'estimated_impact', 'is_optimized', 'ultimate_guide_title',
  'ultimate_guide_url', 'notes', 'is_hidden', 'rule_summary', 'tags',
] as const
type Writable = (typeof WRITABLE)[number]

const ARRAY_COLUMNS = new Set(['secondary_keywords', 'tags'])
const INT_COLUMNS = new Set(['search_volume', 'kd', 'current_impressions'])
const BOOL_COLUMNS = new Set(['is_optimized', 'is_hidden'])

/** RFC4180 parser. Handles quoted fields, embedded commas, newlines and "". */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++ } else { quoted = false }
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\r') { /* handled by \n */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function coerce(column: string, raw: string): unknown {
  const v = raw.trim()
  if (v === '') return null
  if (ARRAY_COLUMNS.has(column)) {
    return v.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean)
  }
  if (INT_COLUMNS.has(column)) {
    const n = Number(v.replace(/[, ]/g, ''))
    return Number.isFinite(n) ? Math.round(n) : null
  }
  if (BOOL_COLUMNS.has(column)) {
    return /^(true|yes|y|1)$/i.test(v)
  }
  return v
}

export async function POST(req: NextRequest) {
  try {
    const sql = getSQL()
    await ensureCollectionColumns(sql)
    const dryRun = new URL(req.url).searchParams.get('dryRun') === 'true'

    // Accept raw CSV, { csv }, or { rows }
    const contentType = req.headers.get('content-type') || ''
    let records: Array<Record<string, string>> = []
    if (contentType.includes('application/json')) {
      const body = await req.json()
      if (Array.isArray(body.rows)) {
        records = body.rows.map((r: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)]))
        )
      } else if (typeof body.csv === 'string') {
        const [header, ...rest] = parseCsv(body.csv)
        records = rest.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])))
      }
    } else {
      const [header, ...rest] = parseCsv(await req.text())
      records = rest.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])))
    }

    if (!records.length) {
      return NextResponse.json({ error: 'No rows found. Expected a CSV with a header row including "slug".' }, { status: 400 })
    }
    if (!('slug' in records[0])) {
      return NextResponse.json({ error: 'Missing required "slug" column.' }, { status: 400 })
    }

    const present = Object.keys(records[0]).map((h) => h.trim())
    const columns = present.filter((h) => (WRITABLE as readonly string[]).includes(h)) as Writable[]
    const ignored = present.filter((h) => h !== 'slug' && !columns.includes(h as Writable))

    const existing = (await sql`SELECT slug FROM ppw_collections`) as Array<{ slug: string }>
    const known = new Set(existing.map((r) => r.slug))

    const updated: string[] = []
    const created: string[] = []
    const unknown: string[] = []
    const skipped: Array<{ slug: string; reason: string }> = []

    for (const rec of records) {
      const slug = (rec.slug || '').trim()
      if (!slug) { skipped.push({ slug: '(blank)', reason: 'no slug' }); continue }

      const patch: Record<string, unknown> = {}
      for (const col of columns) patch[col] = coerce(col, rec[col] ?? '')
      // Drop keys the caller left blank so a sparse sheet never nulls good data.
      for (const k of Object.keys(patch)) if (patch[k] === null) delete patch[k]
      if (!Object.keys(patch).length) { skipped.push({ slug, reason: 'no writable values' }); continue }

      if (!known.has(slug)) {
        unknown.push(slug)
        if (dryRun) continue
        await sql`INSERT INTO ppw_collections (slug, url) VALUES (${slug}, ${'https://peakprimalwellness.com/collections/' + slug}) ON CONFLICT (slug) DO NOTHING`
        created.push(slug)
      } else {
        updated.push(slug)
      }
      if (dryRun) continue

      // Build the SET clause from only the columns supplied.
      const sets = Object.entries(patch)
        .map(([k, v]) => sql`${sql.unsafe(k)} = ${v as never}`)
      await sql`
        UPDATE ppw_collections
        SET ${sets.reduce((acc, cur) => sql`${acc}, ${cur}`)},
            keywords_updated_at = NOW()
        WHERE slug = ${slug}
      `
    }

    return NextResponse.json({
      dryRun,
      rowsRead: records.length,
      columnsApplied: columns,
      columnsIgnored: ignored,
      readOnlyIgnored: ignored.filter((c) => READ_ONLY_COLUMNS.has(c)),
      wouldUpdate: dryRun ? updated.length : undefined,
      updated: dryRun ? undefined : updated.length,
      created: dryRun ? undefined : created.length,
      unknownSlugs: unknown,
      skipped,
    })
  } catch (error) {
    console.error('[collections/import] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    )
  }
}
