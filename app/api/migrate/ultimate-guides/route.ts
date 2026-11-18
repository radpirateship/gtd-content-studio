// app/api/migrate/ultimate-guides/route.ts
// One-time migration: adds ultimate_guide_title + ultimate_guide_url columns
// to ppw_collections and seeds the existing hardcoded values.
// Hit POST /api/migrate/ultimate-guides once after deploying.
import { NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

const SEED_DATA: Record<string, { title: string; url: string }> = {
  // Saunas
  saunas:                    { title: 'The Ultimate Guide to Saunas',                   url: '/pages/ultimate-guide-to-saunas' },
  'barrel-saunas':           { title: 'The Ultimate Guide to Barrel Saunas',            url: '/pages/barrel-saunas-ultimate-guide' },
  'infrared-saunas':         { title: 'The Ultimate Guide to Infrared Saunas',          url: '/pages/infrared-saunas-ultimate-guide' },
  'outdoor-saunas':          { title: 'The Ultimate Guide to Outdoor Saunas',           url: '/pages/outdoor-saunas-ultimate-guide' },
  'traditional-saunas':      { title: 'The Ultimate Guide to Traditional Saunas',       url: '/pages/the-ultimate-guide-to-traditional-saunas' },
  'hybrid-saunas':           { title: 'Hybrid Sauna Ultimate Guide',                    url: '/pages/hybrid-saunas-ultimate-guide' },
  'sauna-heaters':           { title: 'The Ultimate Guide to Sauna Heaters',            url: '/pages/ultimate-guide-to-sauna-heaters' },
  steam:                     { title: 'The Ultimate Guide to Steam Showers',            url: '/pages/ultimate-guide-to-steam-shower-generators' },
  // Recovery
  'cold-plunges':            { title: 'The Ultimate Guide to Cold Plunges',             url: '/pages/cold-plunge-ultimate-guide' },
  'red-light-therapy':       { title: 'The Ultimate Guide to Red Light Therapy',        url: '/pages/red-light-therapy-ultimate-guide' },
  'hyperbaric-chambers':     { title: 'The Ultimate Guide to Hyperbaric Chambers',      url: '/pages/hyperbaric-chambers-ultimate-guide' },
  'massage-equipment':       { title: 'The Ultimate Guide to Massage Equipment',        url: '/pages/massage-equipment-ultimate-guide' },
  'compression-boots':       { title: 'The Ultimate Guide to Compression Boots',        url: '/pages/compression-boots-ultimate-guide' },
  'sensory-deprivation-tanks': { title: 'The Ultimate Guide to Sensory Deprivation Tanks', url: '/pages/sensory-deprivation-tanks-ultimate-guide' },
  // Wellness
  'hydrogen-water':          { title: 'The Ultimate Guide to Hydrogen Water',           url: '/pages/hydrogen-water-ultimate-guide' },
  'water-ionizers':          { title: 'The Ultimate Guide to Water Ionizers',           url: '/pages/water-ionizers-ultimate-guide' },
  'air-purifiers':           { title: 'The Ultimate Guide to Air Purifiers',            url: '/pages/air-purifiers-ultimate-guide' },
  // Fitness
  'elliptical-machines':     { title: 'The Ultimate Guide to Elliptical Machines',      url: '/pages/elliptical-machines-ultimate-guide' },
  'exercise-bikes':          { title: 'The Ultimate Guide to Exercise Bikes',           url: '/pages/exercise-bikes-ultimate-guide' },
  treadmills:                { title: 'The Ultimate Guide to Treadmills',               url: '/pages/treadmills-ultimate-guide' },
  'stair-climbers':          { title: 'The Ultimate Guide to Stair Climber Machines',   url: '/pages/stair-climber-machines-ultimate-guide' },
  'vertical-climbers':       { title: 'The Ultimate Guide to VersaClimber Machines',    url: '/pages/vertical-climbers-ultimate-guide' },
  pilates:                   { title: 'The Ultimate Guide to Pilates Equipment',         url: '/pages/pilates-ultimate-guide' },
  // Sports
  'lacrosse-equipment':      { title: 'The Ultimate Guide to Lacrosse Equipment',        url: '/pages/lacrosse-training-ultimate-guide' },
  'pickleball-paddles':      { title: 'The Ultimate Guide to Pickleball Paddles',        url: '/pages/pickleball-paddle-ultimate-guide' },
  'reaction-training':       { title: 'The Ultimate Guide to Reaction Training',         url: '/pages/reaction-time-training-ultimate-guide' },
  'timing-systems':          { title: 'The Ultimate Guide to Athletic Timing Systems',   url: '/pages/timing-systems-ultimate-guide' },
  // Wellness
  'emf-protection':          { title: 'The Ultimate Guide to EMF Protection',           url: '/pages/emf-protection-ultimate-guide' },
  // Saunas
  'sauna-kits':              { title: 'The Ultimate Guide To Sauna Kits',               url: '/pages/sauna-kits-ultimate-guide' },
}

export async function POST() {
  const sql = getSQL()

  // 1. Add columns if they don't exist
  await sql`
    ALTER TABLE ppw_collections
      ADD COLUMN IF NOT EXISTS ultimate_guide_title TEXT,
      ADD COLUMN IF NOT EXISTS ultimate_guide_url   TEXT
  `

  // 2. Seed known values (only overwrites nulls — won't stomp edits you've made)
  let seeded = 0
  for (const [slug, guide] of Object.entries(SEED_DATA)) {
    const result = await sql`
      UPDATE ppw_collections
      SET
        ultimate_guide_title = COALESCE(ultimate_guide_title, ${guide.title}),
        ultimate_guide_url   = COALESCE(ultimate_guide_url,   ${guide.url})
      WHERE slug = ${slug}
      RETURNING slug
    `
    if (Array.from(result).length > 0) seeded++
  }

  return NextResponse.json({
    ok: true,
    message: `Columns added. Seeded ${seeded} collections.`,
  })
}
