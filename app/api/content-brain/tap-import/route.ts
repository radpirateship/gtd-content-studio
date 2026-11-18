// app/api/content-brain/tap-import/route.ts
// Normalize raw TAP CSV rows (v18 or Cardio format) into content_brain schema.
// Two-step: POST with `preview: true` returns normalized rows without saving;
// POST with `commit: true` + rows saves them.
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

type TapFormat = 'v18' | 'cardio'

interface NormalizedRow {
  title: string
  keyword: string | null
  hub: string | null
  cluster_group: string | null
  collection: string | null
  collection_slug: string | null
  content_type: string
  article_type: string | null
  audience: string | null
  tone: string | null
  word_count: number
  priority: string | null
  kw_volume: number | null
  kw_difficulty: number | null
  traffic_potential: number | null
  url_slug: string | null
  notes: string | null
  status: string
  source: string
  special_instructions: string | null
}

// ---------------------------------------------------------------------------
// CSV parser — handles quoted fields and commas inside quotes
// ---------------------------------------------------------------------------
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        cur.push(field)
        field = ''
      } else if (c === '\n' || c === '\r') {
        if (field !== '' || cur.length > 0) {
          cur.push(field)
          rows.push(cur)
          cur = []
          field = ''
        }
        if (c === '\r' && text[i + 1] === '\n') i++
      } else {
        field += c
      }
    }
  }
  if (field !== '' || cur.length > 0) {
    cur.push(field)
    rows.push(cur)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

// ---------------------------------------------------------------------------
// Field normalizers
// ---------------------------------------------------------------------------
function mapContentType(type: string): string {
  const t = (type || '').toLowerCase().trim()
  if (t.includes('pillar')) return 'pillar'
  return 'cluster'
}

function mapArticleType(raw: string): string | null {
  const t = (raw || '').toLowerCase().trim()
  if (!t) return null
  if (t.includes('buyer')) return 'buyers-guide'
  if (t.includes('comparison') || t.includes(' vs ') || t === 'vs') return 'comparison'
  if (t.includes('how') || t.includes('guide to')) return 'how-to'
  if (t.includes('list') || t.includes('best ') || /^\d+\s/.test(t)) return 'listicle'
  if (t.includes('benefit')) return 'benefit-deep-dive'
  if (t.includes('review') || t.includes('brand')) return 'brand-review'
  if (t.includes('ultimate')) return 'ultimate-guide'
  if (t.includes('faq')) return 'faq'
  if (t.includes('celebrity')) return 'celebrity'
  if (t.includes('science') || t.includes('exercise')) return 'exercise-science'
  return 'listicle'
}

function mapAudience(intent: string): string {
  const t = (intent || '').toLowerCase().trim()
  if (t.includes('first') || t.includes('beginner') || t.includes('new')) return 'first-time'
  if (t.includes('athlete') || t.includes('performance')) return 'athlete'
  if (t.includes('enthusiast') || t.includes('advanced')) return 'enthusiast'
  if (t.includes('professional') || t.includes('commercial') || t.includes('pro')) return 'professional'
  return 'general'
}

function mapPriority(raw: string): string | null {
  const t = (raw || '').toUpperCase().trim()
  if (t === 'P1' || t === '1' || t.includes('HIGH')) return 'P1'
  if (t === 'P2' || t === '2' || t.includes('MED')) return 'P2'
  if (t === 'P3' || t === '3' || t.includes('LOW')) return 'P3'
  return null
}

function toInt(raw: string): number | null {
  if (!raw) return null
  const cleaned = String(raw).replace(/[,\s]/g, '')
  const n = parseInt(cleaned, 10)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Per-format row normalization
// ---------------------------------------------------------------------------
function normalizeRow(
  format: TapFormat,
  headers: string[],
  row: string[],
  ctx: { hub: string; cluster_group: string; collection: string; collection_slug: string }
): NormalizedRow | null {
  const get = (name: string) => {
    const idx = headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
    return idx >= 0 ? (row[idx] || '').trim() : ''
  }

  const title = get('Title')
  if (!title) return null

  const keyword = get('Primary Keyword') || null
  const type = get('Type')
  const priority = get('Priority')
  const wordCountRaw = get('Word Count')
  const word_count = toInt(wordCountRaw) || 2500

  if (format === 'cardio') {
    return {
      title,
      keyword,
      hub: ctx.hub || null,
      cluster_group: ctx.cluster_group || null,
      collection: ctx.collection || ctx.cluster_group || null,
      collection_slug: ctx.collection_slug || null,
      content_type: mapContentType(type),
      article_type: mapArticleType(get('Article Type')),
      audience: mapAudience(get('Intent')),
      tone: 'educational',
      word_count,
      priority: mapPriority(priority),
      kw_volume: toInt(get('KW Volume')),
      kw_difficulty: toInt(get('KD')),
      traffic_potential: toInt(get('Traffic Potential')),
      url_slug: get('URL Slug') || null,
      notes: get('Notes') || null,
      status: 'planned',
      source: 'tap-import',
      special_instructions: [get('Title Tag'), get('Meta Description'), get('Existing URL'), get('Action')]
        .filter(Boolean)
        .join(' | ') || null,
    }
  }

  // v18
  return {
    title,
    keyword,
    hub: ctx.hub || null,
    cluster_group: ctx.cluster_group || null,
    collection: ctx.collection || ctx.cluster_group || null,
    collection_slug: ctx.collection_slug || null,
    content_type: mapContentType(type),
    article_type: mapArticleType(get('Format')),
    audience: mapAudience(get('Intent')),
    tone: 'educational',
    word_count,
    priority: mapPriority(priority),
    kw_volume: toInt(get('KW Search Volume')),
    kw_difficulty: null,
    traffic_potential: null,
    url_slug: get('URL') || null,
    notes: null,
    status: 'planned',
    source: 'tap-import',
    special_instructions: [get('Title Tag'), get('Meta Description')].filter(Boolean).join(' | ') || null,
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { csv, format, hub, cluster_group, collection, collection_slug, preview, commit, rows: committedRows } =
      body as {
        csv?: string
        format?: TapFormat
        hub?: string
        cluster_group?: string
        collection?: string
        collection_slug?: string
        preview?: boolean
        commit?: boolean
        rows?: NormalizedRow[]
      }

    // Commit step: save pre-normalized rows from the preview
    if (commit && Array.isArray(committedRows)) {
      const sql = getSQL()
      const saved: unknown[] = []
      for (const r of committedRows) {
        const [row] = await sql`
          INSERT INTO content_brain (
            title, keyword, hub, cluster_group, collection, collection_slug,
            content_type, article_type, audience, tone, word_count,
            special_instructions, priority, status, traffic_light, source,
            kw_volume, kw_difficulty, traffic_potential, url_slug, notes
          ) VALUES (
            ${r.title}, ${r.keyword}, ${r.hub}, ${r.cluster_group},
            ${r.collection}, ${r.collection_slug}, ${r.content_type}, ${r.article_type},
            ${r.audience}, ${r.tone}, ${r.word_count}, ${r.special_instructions},
            ${r.priority}, ${r.status}, 'unvetted', ${r.source},
            ${r.kw_volume}, ${r.kw_difficulty}, ${r.traffic_potential},
            ${r.url_slug}, ${r.notes}
          )
          RETURNING *
        `
        saved.push(row)
      }
      return NextResponse.json({ imported: saved.length, rows: saved })
    }

    // Preview step: parse CSV and normalize
    if (!csv || !format) {
      return NextResponse.json({ error: 'csv and format are required' }, { status: 400 })
    }

    const parsed = parseCSV(csv)
    if (parsed.length < 2) {
      return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 })
    }

    const headers = parsed[0]
    const dataRows = parsed.slice(1)

    const ctx = {
      hub: hub || '',
      cluster_group: cluster_group || '',
      collection: collection || cluster_group || '',
      collection_slug: collection_slug || '',
    }

    const normalized: NormalizedRow[] = []
    for (const row of dataRows) {
      const n = normalizeRow(format, headers, row, ctx)
      if (n) normalized.push(n)
    }

    if (preview) {
      return NextResponse.json({ rows: normalized, count: normalized.length })
    }

    // Fallback: if no preview flag, also just return normalized
    return NextResponse.json({ rows: normalized, count: normalized.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
