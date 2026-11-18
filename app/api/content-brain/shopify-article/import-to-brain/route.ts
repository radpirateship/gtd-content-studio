// app/api/content-brain/shopify-article/import-to-brain/route.ts
// Imports shopify_only articles into content_brain as status='live'.
// Infers hub/cluster from title (same logic as shopify-import route).
// Preserves the Shopify handle as url_slug so the article stays mapped
// to its existing URL for future optimisation.
//
// POST { articles: Array<{ shopify_id: number; title: string; handle: string; blog_handle: string }> }
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

// Taxonomy inference — matches title keywords to known clusters
const CLUSTER_KEYWORDS: Array<{ hub: string; cluster: string; slug: string; keywords: string[] }> = [
  { hub: 'Saunas', cluster: 'Infrared Saunas', slug: 'infrared-saunas', keywords: ['infrared sauna', 'far infrared', 'full spectrum sauna'] },
  { hub: 'Saunas', cluster: 'Barrel Saunas', slug: 'barrel-saunas', keywords: ['barrel sauna'] },
  { hub: 'Saunas', cluster: 'Traditional Saunas', slug: 'traditional-saunas', keywords: ['traditional sauna', 'finnish sauna', 'sauna'] },
  { hub: 'Saunas', cluster: 'Sauna Heaters', slug: 'sauna-heaters', keywords: ['sauna heater', 'sauna stove', 'sauna stones', 'wood burning sauna', 'wood fired'] },
  { hub: 'Saunas', cluster: 'Sauna Accessories', slug: 'sauna-accessories', keywords: ['sauna accessories', 'sauna bucket', 'sauna towel', 'sauna bench', 'sauna door', 'sauna wood', 'sauna insulation', 'sauna lighting', 'cedar sauna', 'hemlock sauna'] },
  { hub: 'Saunas', cluster: 'Steam', slug: 'steam', keywords: ['steam shower', 'steam generator', 'steam room', 'mrsteam', 'kohler steam', 'thermasol'] },
  { hub: 'Saunas', cluster: 'Outdoor Saunas', slug: 'outdoor-saunas', keywords: ['outdoor sauna', 'indoor vs outdoor', 'backyard sauna'] },
  { hub: 'Recovery', cluster: 'Cold Plunges', slug: 'cold-plunges', keywords: ['cold plunge', 'ice bath', 'cold water', 'contrast therapy', 'cold immersion', 'chiller'] },
  { hub: 'Recovery', cluster: 'Red Light Therapy', slug: 'red-light-therapy', keywords: ['red light', 'infrared light', 'photobiomodulation', 'rlt'] },
  { hub: 'Recovery', cluster: 'Hyperbaric Chambers', slug: 'hyperbaric-chambers', keywords: ['hyperbaric', 'hbot', 'oxygen therapy', 'pressurized'] },
  { hub: 'Recovery', cluster: 'Sensory Deprivation Tanks', slug: 'sensory-deprivation-tanks', keywords: ['float tank', 'float therapy', 'sensory deprivation', 'flotation', 'isolation tank'] },
  { hub: 'Recovery', cluster: 'Massage Equipment', slug: 'massage-equipment', keywords: ['massage chair', 'massage gun', 'percussion', 'theragun', 'hypervolt', 'shiatsu', 'foam roller', 'foot massager', 'neck massager'] },
  { hub: 'Recovery', cluster: 'Compression Boots', slug: 'compression-boots', keywords: ['compression boot', 'compression therapy', 'pneumatic', 'normatec', 'rapid reboot', 'reathlete'] },
  { hub: 'Wellness', cluster: 'Hydrogen Water', slug: 'hydrogen-water', keywords: ['hydrogen water', 'h2 water', 'molecular hydrogen'] },
  { hub: 'Wellness', cluster: 'Water Ionizers', slug: 'water-ionizers', keywords: ['water ionizer', 'alkaline water', 'kangen', 'tyent', 'ionized water'] },
  { hub: 'Cardio', cluster: 'Treadmills', slug: 'treadmills', keywords: ['treadmill'] },
  { hub: 'Cardio', cluster: 'Elliptical Machines', slug: 'elliptical-machines', keywords: ['elliptical'] },
  { hub: 'Cardio', cluster: 'Exercise Bikes', slug: 'exercise-bikes', keywords: ['exercise bike', 'spin bike', 'stationary bike', 'recumbent bike', 'air bike', 'peloton'] },
  { hub: 'Cardio', cluster: 'Stair Climbers', slug: 'stair-climbers', keywords: ['stair climber', 'stairmaster', 'stepr', 'step machine'] },
  { hub: 'Cardio', cluster: 'Vertical Climbers', slug: 'vertical-climbers', keywords: ['vertical climber', 'versaclimber', 'maxiclimber'] },
  { hub: 'Cardio', cluster: 'Pilates', slug: 'pilates', keywords: ['pilates'] },
  { hub: 'Cross-Topic', cluster: 'Cross-Topic', slug: 'cross-topic', keywords: ['biohacking', 'home gym', 'wellness routine', 'home spa', 'recovery routine'] },
]

function inferTaxonomy(title: string): { hub: string; cluster: string; collection_slug: string } {
  const lower = title.toLowerCase()
  for (const c of CLUSTER_KEYWORDS) {
    if (c.keywords.some(k => lower.includes(k))) {
      return { hub: c.hub, cluster: c.cluster, collection_slug: c.slug }
    }
  }
  return { hub: 'Saunas', cluster: 'Traditional Saunas', collection_slug: 'traditional-saunas' }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      articles: Array<{ shopify_id: number; title: string; handle: string; blog_handle: string }>
    }
    if (!Array.isArray(body.articles) || body.articles.length === 0) {
      return NextResponse.json({ error: 'articles array required' }, { status: 400 })
    }

    const sql = getSQL()
    let inserted = 0; let skipped = 0
    const errors: string[] = []

    for (const a of body.articles) {
      // Skip if already in brain (by handle or title)
      const existing = await sql`
        SELECT id FROM content_brain
        WHERE url_slug = ${a.handle} OR LOWER(title) = ${a.title.toLowerCase().trim()}
        LIMIT 1
      ` as unknown as Array<{ id: number }>
      if (existing.length > 0) { skipped++; continue }

      const { hub, cluster, collection_slug } = inferTaxonomy(a.title)

      try {
        await sql`
          INSERT INTO content_brain (
            title, hub, cluster_group, collection, collection_slug,
            url_slug, status, traffic_light, source,
            shopify_article_id, shopify_blog_handle
          ) VALUES (
            ${a.title}, ${hub}, ${cluster}, ${cluster}, ${collection_slug},
            ${a.handle}, 'live', 'green', 'shopify-import',
            ${String(a.shopify_id)}, ${a.blog_handle}
          )
        `
        inserted++
      } catch (e) {
        errors.push(`${a.title}: ${e instanceof Error ? e.message : 'insert failed'}`)
      }
    }

    return NextResponse.json({ ok: true, inserted, skipped, errors })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 })
  }
}
