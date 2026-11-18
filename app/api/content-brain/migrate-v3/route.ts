// app/api/content-brain/migrate-v3/route.ts
// Adds content_brain_docs table for storing uploaded reference documents
// (brand guidelines, TAP xlsx, voice notes, strategy memos, etc.) that
// Claude can reference when brainstorming. Idempotent.
import { NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

export async function POST() {
  const sql = getSQL()
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS content_brain_docs (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'reference',
        mime        TEXT,
        size_bytes  INTEGER,
        content     TEXT,
        notes       TEXT,
        tags        TEXT[],
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_content_brain_docs_kind ON content_brain_docs(kind)`

    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM content_brain_docs`
    return NextResponse.json({ ok: true, migration: 'v3', table: 'content_brain_docs', count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ hint: 'POST to run migration v3' })
}
