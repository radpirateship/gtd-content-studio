// app/api/content-brain/migrate/route.ts
// One-shot migration to create content_brain + content_brain_clusters tables
// and seed the canonical hub map. Idempotent — safe to re-run.
import { NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

export async function POST() {
  const sql = getSQL()

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS content_brain (
        id                       SERIAL PRIMARY KEY,
        title                    TEXT NOT NULL,
        keyword                  TEXT,
        hub                      TEXT,
        cluster_group            TEXT,
        collection               TEXT,
        collection_slug          TEXT,
        content_type             TEXT DEFAULT 'cluster',
        article_type             TEXT,
        audience                 TEXT,
        tone                     TEXT,
        word_count               INTEGER DEFAULT 2500,
        include_comparison_table BOOLEAN DEFAULT false,
        special_instructions     TEXT,
        priority                 TEXT,
        status                   TEXT NOT NULL DEFAULT 'idea',
        traffic_light            TEXT DEFAULT 'unvetted',
        ai_reasoning             TEXT,
        source                   TEXT DEFAULT 'manual',
        shopify_article_id       TEXT,
        shopify_blog_handle      TEXT,
        kw_volume                INTEGER,
        kw_difficulty            INTEGER,
        traffic_potential        INTEGER,
        url_slug                 TEXT,
        notes                    TEXT,
        created_at               TIMESTAMPTZ DEFAULT NOW(),
        updated_at               TIMESTAMPTZ DEFAULT NOW()
      )
    `

    await sql`
      CREATE TABLE IF NOT EXISTS content_brain_clusters (
        id         SERIAL PRIMARY KEY,
        hub        TEXT NOT NULL,
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(hub, slug)
      )
    `

    const seed: Array<[string, string, string]> = [
      ['Saunas', 'Infrared Saunas', 'infrared-saunas'],
      ['Saunas', 'Barrel Saunas', 'barrel-saunas'],
      ['Saunas', 'Traditional Saunas', 'traditional-saunas'],
      ['Saunas', 'Sauna Heaters', 'sauna-heaters'],
      ['Saunas', 'Sauna Accessories', 'sauna-accessories'],
      ['Saunas', 'Sauna Kits', 'sauna-kits'],
      ['Saunas', 'Steam', 'steam'],
      ['Recovery', 'Cold Plunges', 'cold-plunges'],
      ['Recovery', 'Red Light Therapy', 'red-light-therapy'],
      ['Recovery', 'Hyperbaric Chambers', 'hyperbaric-chambers'],
      ['Recovery', 'Sensory Deprivation Tanks', 'sensory-deprivation-tanks'],
      ['Recovery', 'Massage Equipment', 'massage-equipment'],
      ['Recovery', 'Compression Boots', 'compression-boots'],
      ['Wellness', 'Hydrogen Water', 'hydrogen-water'],
      ['Wellness', 'Water Ionizers', 'water-ionizers'],
      ['Wellness', 'Air Purifiers', 'air-purifiers'],
      ['Cardio', 'Treadmills', 'treadmills'],
      ['Cardio', 'Elliptical Machines', 'elliptical-machines'],
      ['Cardio', 'Exercise Bikes', 'exercise-bikes'],
      ['Cardio', 'Stair Climbers', 'stair-climbers'],
      ['Cardio', 'Vertical Climbers', 'vertical-climbers'],
      ['Cardio', 'Pilates', 'pilates'],
      ['Recovery', 'Neck Training', 'neck-training'],
      ['Saunas', 'Outdoor Saunas', 'outdoor-saunas'],
      ['Cross-Topic', 'Cross-Topic', 'cross-topic'],
    ]

    for (const [hub, name, slug] of seed) {
      await sql`
        INSERT INTO content_brain_clusters (hub, name, slug)
        VALUES (${hub}, ${name}, ${slug})
        ON CONFLICT (hub, slug) DO NOTHING
      `
    }

    const [{ count: ideas }] = await sql`SELECT COUNT(*)::int AS count FROM content_brain`
    const [{ count: clusters }] = await sql`SELECT COUNT(*)::int AS count FROM content_brain_clusters`

    return NextResponse.json({
      ok: true,
      tables: ['content_brain', 'content_brain_clusters'],
      counts: { ideas, clusters },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ hint: 'POST to run the migration' })
}
