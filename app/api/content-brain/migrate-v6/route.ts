// app/api/content-brain/migrate-v6/route.ts
// Seeds the four sports collections into gtd_collections + ultimate_guide fields,
// and re-syncs all MASTER_COLLECTIONS into collections_registry so dropdowns
// stay in sync.
// Hit POST /api/content-brain/migrate-v6 once after deploying.
import { NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { MASTER_COLLECTIONS } from '@/lib/collections'

const SPORTS_COLLECTIONS = [
  {
    slug: 'lacrosse-equipment',
    label: 'Lacrosse Equipment',
    url: 'https://greenthumbdepot.com/collections/lacrosse-equipment',
    category: 'Fitness',
    primary_keyword: 'lacrosse training equipment',
    search_volume: 250,
    ultimate_guide_title: 'The Ultimate Guide to Lacrosse Equipment',
    ultimate_guide_url: '/pages/lacrosse-training-ultimate-guide',
  },
  {
    slug: 'pickleball-paddles',
    label: 'Pickleball Paddles',
    url: 'https://greenthumbdepot.com/collections/pickleball-paddles',
    category: 'Fitness',
    primary_keyword: 'pickleball paddle buying guide',
    search_volume: 100,
    ultimate_guide_title: 'The Ultimate Guide to Pickleball Paddles',
    ultimate_guide_url: '/pages/pickleball-paddle-ultimate-guide',
  },
  {
    slug: 'reaction-training',
    label: 'Reaction Training',
    url: 'https://greenthumbdepot.com/collections/reaction-training',
    category: 'Fitness',
    primary_keyword: 'reaction time training',
    search_volume: 700,
    ultimate_guide_title: 'The Ultimate Guide to Reaction Training',
    ultimate_guide_url: '/pages/reaction-time-training-ultimate-guide',
  },
  {
    slug: 'timing-systems',
    label: 'Timing Systems',
    url: 'https://greenthumbdepot.com/collections/timing-systems',
    category: 'Fitness',
    primary_keyword: 'timing gates',
    search_volume: 300,
    ultimate_guide_title: 'The Ultimate Guide to Athletic Timing Systems',
    ultimate_guide_url: '/pages/timing-systems-ultimate-guide',
  },
  {
    slug: 'sauna-kits',
    label: 'Sauna Kits',
    url: 'https://greenthumbdepot.com/collections/sauna-kits',
    category: 'Saunas',
    primary_keyword: 'sauna kits',
    search_volume: 0,
    ultimate_guide_title: 'The Ultimate Guide To Sauna Kits',
    ultimate_guide_url: '/pages/sauna-kits-ultimate-guide',
  },
  {
    slug: 'emf-protection',
    label: 'EMF Protection',
    url: 'https://greenthumbdepot.com/collections/emf-protection',
    category: 'Wellness',
    primary_keyword: 'emf protection',
    search_volume: 0,
    ultimate_guide_title: 'The Ultimate Guide to EMF Protection',
    ultimate_guide_url: '/pages/emf-protection-ultimate-guide',
  },
]

export async function POST() {
  const sql = getSQL()
  const results: string[] = []

  try {
    // 1. Ensure ultimate_guide columns exist
    await sql`
      ALTER TABLE gtd_collections
        ADD COLUMN IF NOT EXISTS ultimate_guide_title TEXT,
        ADD COLUMN IF NOT EXISTS ultimate_guide_url   TEXT
    `

    // 2. Upsert sports collections into gtd_collections
    for (const col of SPORTS_COLLECTIONS) {
      await sql`
        INSERT INTO gtd_collections
          (slug, url, category, primary_keyword, search_volume,
           ultimate_guide_title, ultimate_guide_url)
        VALUES
          (${col.slug}, ${col.url}, ${col.category}, ${col.primary_keyword},
           ${col.search_volume}, ${col.ultimate_guide_title}, ${col.ultimate_guide_url})
        ON CONFLICT (slug) DO UPDATE SET
          url                 = COALESCE(gtd_collections.url, EXCLUDED.url),
          category            = EXCLUDED.category,
          primary_keyword     = COALESCE(gtd_collections.primary_keyword, EXCLUDED.primary_keyword),
          search_volume       = COALESCE(gtd_collections.search_volume, EXCLUDED.search_volume),
          ultimate_guide_title = COALESCE(gtd_collections.ultimate_guide_title, EXCLUDED.ultimate_guide_title),
          ultimate_guide_url   = COALESCE(gtd_collections.ultimate_guide_url, EXCLUDED.ultimate_guide_url)
      `
      results.push(`upserted gtd_collections: ${col.slug}`)
    }

    // 3. Sync all MASTER_COLLECTIONS into collections_registry
    //    (upsert by slug — preserves any custom url values already set)
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
    results.push(`synced ${synced} collections into collections_registry`)

    return NextResponse.json({ ok: true, migration: 'v6', results })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ hint: 'POST to /api/content-brain/migrate-v6 to run migration' })
}
