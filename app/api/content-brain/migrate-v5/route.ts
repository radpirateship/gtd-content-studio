// app/api/content-brain/migrate-v5/route.ts
// Renames "Air Filters" → "Air Purifiers" in collections_registry and
// syncs all MASTER_COLLECTIONS into the registry so Products + Resources
// dropdowns always stay in sync with lib/collections.ts.
import { NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { MASTER_COLLECTIONS } from '@/lib/collections'

export async function POST() {
  const sql = getSQL()
  try {
    // 1. Rename air-filters → air-purifiers in collections_registry
    //    We INSERT the new row, copy over any existing url, then delete the old slug.
    const existing = await sql`
      SELECT url FROM collections_registry WHERE slug = 'air-filters'
    ` as Array<{ url: string | null }>

    const existingUrl = existing[0]?.url ?? null

    await sql`
      INSERT INTO collections_registry (slug, label, is_builtin, url)
      VALUES ('air-purifiers', 'Air Purifiers', TRUE, ${existingUrl})
      ON CONFLICT (slug) DO UPDATE
        SET label = 'Air Purifiers', is_builtin = TRUE,
            url = COALESCE(EXCLUDED.url, collections_registry.url)
    `

    await sql`DELETE FROM collections_registry WHERE slug = 'air-filters'`

    // 2. Also rename any content_brain rows that still use the old slug
    const brainUpdated = await sql`
      UPDATE content_brain
      SET cluster_group = 'Air Purifiers',
          collection_slug = 'air-purifiers'
      WHERE collection_slug = 'air-filters'
      RETURNING id
    ` as unknown as Array<{ id: number }>

    // 3. Sync all MASTER_COLLECTIONS into collections_registry
    //    (upsert by slug — does NOT overwrite custom url values)
    let synced = 0
    for (const col of MASTER_COLLECTIONS) {
      await sql`
        INSERT INTO collections_registry (slug, label, is_builtin)
        VALUES (${col.slug}, ${col.label}, TRUE)
        ON CONFLICT (slug) DO UPDATE
          SET label = EXCLUDED.label, is_builtin = TRUE
      `
      synced++
    }

    return NextResponse.json({
      ok: true,
      migration: 'v5',
      renamed_registry: 'air-filters → air-purifiers',
      content_brain_rows_updated: brainUpdated.length,
      master_collections_synced: synced,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ hint: 'POST to run migration v5' })
}
