// app/api/content-brain/docs/route.ts
// CRUD for uploaded reference documents that the Content Brain uses as
// context (brand voice docs, strategy memos, TAP plans, etc.).
//
// GET                  — list all docs (without content body)
// POST {title, kind, content, notes, tags, mime, size_bytes}  — create
// PATCH {id, ...}      — update fields
// DELETE ?id=n         — delete
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

const ALLOWED = new Set(['title', 'kind', 'content', 'notes', 'tags', 'mime', 'size_bytes'])

export async function GET(req: NextRequest) {
  const sql = getSQL()
  const withBody = req.nextUrl.searchParams.get('include_content') === '1'
  const id = req.nextUrl.searchParams.get('id')

  if (id) {
    const rows = (await sql`SELECT * FROM content_brain_docs WHERE id = ${Number(id)}`) as unknown as Array<Record<string, unknown>>
    return NextResponse.json(rows[0] || null)
  }

  const rows = withBody
    ? ((await sql`SELECT * FROM content_brain_docs ORDER BY created_at DESC`) as unknown as Array<Record<string, unknown>>)
    : ((await sql`
        SELECT id, title, kind, mime, size_bytes, notes, tags, created_at, updated_at,
               LENGTH(content) AS content_length
        FROM content_brain_docs
        ORDER BY created_at DESC
      `) as unknown as Array<Record<string, unknown>>)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const sql = getSQL()
  try {
    const body = (await req.json()) as {
      title: string
      kind?: string
      content?: string
      notes?: string
      tags?: string[]
      mime?: string
      size_bytes?: number
    }
    if (!body.title) return NextResponse.json({ error: 'title required' }, { status: 400 })
    const rows = (await sql`
      INSERT INTO content_brain_docs (title, kind, content, notes, tags, mime, size_bytes)
      VALUES (
        ${body.title},
        ${body.kind || 'reference'},
        ${body.content || null},
        ${body.notes || null},
        ${body.tags || null},
        ${body.mime || null},
        ${body.size_bytes || null}
      )
      RETURNING id, title, kind, created_at
    `) as unknown as Array<Record<string, unknown>>
    return NextResponse.json(rows[0])
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const sql = getSQL()
  try {
    const body = (await req.json()) as { id: number } & Record<string, unknown>
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const entries = Object.entries(updates).filter(([k]) => ALLOWED.has(k))
    for (const [field, value] of entries) {
      // Per-field update via dynamic tagged template fallback
      const safeField = field.replace(/[^a-z_]/g, '')
      if (!safeField) continue
      const queryText = `UPDATE content_brain_docs SET ${safeField} = $1, updated_at = NOW() WHERE id = $2`
      const anySql = sql as unknown as { query?: (t: string, p: unknown[]) => Promise<unknown> }
      if (anySql.query) await anySql.query(queryText, [value, id])
    }
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const sql = getSQL()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await sql`DELETE FROM content_brain_docs WHERE id = ${Number(id)}`
  return NextResponse.json({ ok: true })
}
