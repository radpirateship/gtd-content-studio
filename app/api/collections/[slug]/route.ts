// app/api/collections/[slug]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { ensureCollectionColumns } from '@/lib/ensureCollectionColumns'

export async function GET(_req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const sql = getSQL()
  const { slug } = await context.params
  const [row] = await sql`SELECT * FROM gtd_collections WHERE slug = ${slug}`
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ collection: row })
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const sql = getSQL()
  const { slug } = await context.params
  const body = await req.json()

  const allowed = [
    'url', 'category', 'collection_type', 'primary_keyword', 'secondary_keywords',
    'title_tag', 'meta_description', 'priority', 'search_volume', 'kd',
    'tier', 'is_optimized', 'is_hidden', 'notes', 'shopify_collection_id',
    'ultimate_guide_title', 'ultimate_guide_url', 'featured_handles',
  ]

  const fields = allowed.filter(k => k in body)
  if (fields.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  try {
    // Make sure newer columns (ultimate_guide_*, score, audit_*) exist before
    // we try to write to them, otherwise the UPDATE 500s and the UI shows a
    // silent "didn't save".
    await ensureCollectionColumns(sql)

    // NOTE: with @neondatabase/serverless, sql.unsafe() does NOT execute — it
    // builds a raw fragment for embedding in tagged templates. The previous
    // positional-parameter UPDATE here never ran (silent no-op, 404 every
    // time). Each whitelisted column now has its own static tagged template,
    // the driver's native execution path.
    const setters: Record<string, (v: any) => Promise<any[]>> = {
      url: (v) => sql`UPDATE gtd_collections SET url = ${v} WHERE slug = ${slug} RETURNING slug`,
      category: (v) => sql`UPDATE gtd_collections SET category = ${v} WHERE slug = ${slug} RETURNING slug`,
      collection_type: (v) => sql`UPDATE gtd_collections SET collection_type = ${v} WHERE slug = ${slug} RETURNING slug`,
      primary_keyword: (v) => sql`UPDATE gtd_collections SET primary_keyword = ${v} WHERE slug = ${slug} RETURNING slug`,
      secondary_keywords: (v) => sql`UPDATE gtd_collections SET secondary_keywords = ${v} WHERE slug = ${slug} RETURNING slug`,
      title_tag: (v) => sql`UPDATE gtd_collections SET title_tag = ${v} WHERE slug = ${slug} RETURNING slug`,
      meta_description: (v) => sql`UPDATE gtd_collections SET meta_description = ${v} WHERE slug = ${slug} RETURNING slug`,
      priority: (v) => sql`UPDATE gtd_collections SET priority = ${v} WHERE slug = ${slug} RETURNING slug`,
      search_volume: (v) => sql`UPDATE gtd_collections SET search_volume = ${v} WHERE slug = ${slug} RETURNING slug`,
      kd: (v) => sql`UPDATE gtd_collections SET kd = ${v} WHERE slug = ${slug} RETURNING slug`,
      tier: (v) => sql`UPDATE gtd_collections SET tier = ${v} WHERE slug = ${slug} RETURNING slug`,
      is_optimized: (v) => sql`UPDATE gtd_collections SET is_optimized = ${v} WHERE slug = ${slug} RETURNING slug`,
      is_hidden: (v) => sql`UPDATE gtd_collections SET is_hidden = ${v} WHERE slug = ${slug} RETURNING slug`,
      notes: (v) => sql`UPDATE gtd_collections SET notes = ${v} WHERE slug = ${slug} RETURNING slug`,
      shopify_collection_id: (v) => sql`UPDATE gtd_collections SET shopify_collection_id = ${v} WHERE slug = ${slug} RETURNING slug`,
      ultimate_guide_title: (v) => sql`UPDATE gtd_collections SET ultimate_guide_title = ${v} WHERE slug = ${slug} RETURNING slug`,
      ultimate_guide_url: (v) => sql`UPDATE gtd_collections SET ultimate_guide_url = ${v} WHERE slug = ${slug} RETURNING slug`,
      // TEXT[] — pass a JS array, never JSON.stringify
      featured_handles: (v) => sql`UPDATE gtd_collections SET featured_handles = ${Array.isArray(v) ? v : String(v).split(",").map((s: string) => s.trim()).filter(Boolean)} WHERE slug = ${slug} RETURNING slug`,
    }
    let matched = false
    for (const k of fields) {
      const rows = (await setters[k](body[k])) as any[]
      if (rows.length > 0) matched = true
    }
    if (!matched) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const [updated] = await sql`SELECT * FROM gtd_collections WHERE slug = ${slug}`
    return NextResponse.json({ collection: updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[collections PATCH] failed for', slug, 'fields', fields, 'error', msg)
    return NextResponse.json({ error: `Update failed: ${msg}` }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const sql = getSQL()
  const { slug } = await context.params
  const [row] = await sql`DELETE FROM gtd_collections WHERE slug = ${slug} RETURNING slug`
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ deleted: row.slug })
}
