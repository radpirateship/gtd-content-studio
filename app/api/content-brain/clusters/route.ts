// app/api/content-brain/clusters/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

const VALID_HUBS = new Set(['Saunas', 'Recovery', 'Wellness', 'Cardio', 'Cross-Topic'])
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function GET(req: NextRequest) {
  const sql = getSQL()
  const { searchParams } = new URL(req.url)
  const hub = searchParams.get('hub') || ''

  const all = await sql`SELECT * FROM content_brain_clusters ORDER BY hub, name`
  let rows = Array.from(all) as Record<string, unknown>[]
  if (hub) rows = rows.filter((r) => r.hub === hub)

  return NextResponse.json({ clusters: rows, total: rows.length })
}

export async function PATCH(req: NextRequest) {
  const sql = getSQL()
  try {
    const body = (await req.json()) as { id: number; hub?: string; name?: string; slug?: string }
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (body.hub && !VALID_HUBS.has(body.hub))
      return NextResponse.json({ error: 'invalid hub' }, { status: 400 })
    if (body.slug && !SLUG_REGEX.test(body.slug))
      return NextResponse.json({ error: 'slug must be kebab-case' }, { status: 400 })

    if (body.hub !== undefined) await sql`UPDATE content_brain_clusters SET hub = ${body.hub} WHERE id = ${body.id}`
    if (body.name !== undefined) await sql`UPDATE content_brain_clusters SET name = ${body.name} WHERE id = ${body.id}`
    if (body.slug !== undefined) await sql`UPDATE content_brain_clusters SET slug = ${body.slug} WHERE id = ${body.id}`
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const sql = getSQL()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await sql`DELETE FROM content_brain_clusters WHERE id = ${Number(id)}`
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const sql = getSQL()
  const body = await req.json()
  const { hub, name, slug } = body as { hub?: string; name?: string; slug?: string }

  if (!hub || !name || !slug) {
    return NextResponse.json({ error: 'hub, name, and slug are required' }, { status: 400 })
  }
  if (!VALID_HUBS.has(hub)) {
    return NextResponse.json(
      { error: `hub must be one of: ${Array.from(VALID_HUBS).join(', ')}` },
      { status: 400 }
    )
  }
  if (!SLUG_REGEX.test(slug)) {
    return NextResponse.json({ error: 'slug must be kebab-case (lowercase, hyphens)' }, { status: 400 })
  }

  try {
    const [row] = await sql`
      INSERT INTO content_brain_clusters (hub, name, slug)
      VALUES (${hub}, ${name}, ${slug})
      ON CONFLICT (hub, slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING *
    `
    return NextResponse.json({ cluster: row }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
