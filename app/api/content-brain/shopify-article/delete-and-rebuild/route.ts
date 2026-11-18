// app/api/content-brain/shopify-article/delete-and-rebuild/route.ts
// Deletes old Shopify articles AND adds them to content_brain as 'planned'
// with the original handle preserved as url_slug. When the new article is
// generated and published, it will reclaim the same URL.
//
// POST { articles: Array<{ shopify_id: number; title: string; handle: string; blog_handle: string }> }
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from '@/lib/shopifyAuth'

export const maxDuration = 60
const API_VERSIONS = ['2024-10', '2024-07', '2024-04', '2024-01']

// Same taxonomy inference as import-to-brain
const CLUSTER_KEYWORDS: Array<{ hub: string; cluster: string; slug: string; keywords: string[] }> = [
  { hub: 'Saunas', cluster: 'Infrared Saunas', slug: 'infrared-saunas', keywords: ['infrared sauna', 'far infrared', 'full spectrum sauna'] },
  { hub: 'Saunas', cluster: 'Barrel Saunas', slug: 'barrel-saunas', keywords: ['barrel sauna'] },
  { hub: 'Saunas', cluster: 'Traditional Saunas', slug: 'traditional-saunas', keywords: ['traditional sauna', 'finnish sauna', 'sauna'] },
  { hub: 'Saunas', cluster: 'Sauna Heaters', slug: 'sauna-heaters', keywords: ['sauna heater', 'sauna stove', 'sauna stones', 'wood burning sauna', 'wood fired'] },
  { hub: 'Saunas', cluster: 'Sauna Accessories', slug: 'sauna-accessories', keywords: ['sauna accessories', 'sauna bucket', 'cedar sauna', 'hemlock sauna', 'sauna bench', 'sauna door', 'sauna wood', 'sauna insulation'] },
  { hub: 'Saunas', cluster: 'Steam', slug: 'steam', keywords: ['steam shower', 'steam generator', 'steam room', 'mrsteam', 'kohler steam', 'thermasol'] },
  { hub: 'Saunas', cluster: 'Outdoor Saunas', slug: 'outdoor-saunas', keywords: ['outdoor sauna', 'backyard sauna'] },
  { hub: 'Recovery', cluster: 'Cold Plunges', slug: 'cold-plunges', keywords: ['cold plunge', 'ice bath', 'cold water', 'contrast therapy', 'chiller'] },
  { hub: 'Recovery', cluster: 'Red Light Therapy', slug: 'red-light-therapy', keywords: ['red light', 'infrared light', 'photobiomodulation'] },
  { hub: 'Recovery', cluster: 'Hyperbaric Chambers', slug: 'hyperbaric-chambers', keywords: ['hyperbaric', 'hbot', 'oxygen therapy'] },
  { hub: 'Recovery', cluster: 'Sensory Deprivation Tanks', slug: 'sensory-deprivation-tanks', keywords: ['float tank', 'float therapy', 'sensory deprivation', 'flotation'] },
  { hub: 'Recovery', cluster: 'Massage Equipment', slug: 'massage-equipment', keywords: ['massage chair', 'massage gun', 'percussion', 'shiatsu', 'foot massager'] },
  { hub: 'Recovery', cluster: 'Compression Boots', slug: 'compression-boots', keywords: ['compression boot', 'compression therapy', 'normatec', 'rapid reboot'] },
  { hub: 'Wellness', cluster: 'Hydrogen Water', slug: 'hydrogen-water', keywords: ['hydrogen water', 'h2 water'] },
  { hub: 'Wellness', cluster: 'Water Ionizers', slug: 'water-ionizers', keywords: ['water ionizer', 'alkaline water', 'kangen', 'tyent'] },
  { hub: 'Cardio', cluster: 'Treadmills', slug: 'treadmills', keywords: ['treadmill'] },
  { hub: 'Cardio', cluster: 'Elliptical Machines', slug: 'elliptical-machines', keywords: ['elliptical'] },
  { hub: 'Cardio', cluster: 'Exercise Bikes', slug: 'exercise-bikes', keywords: ['exercise bike', 'spin bike', 'stationary bike', 'air bike', 'peloton'] },
  { hub: 'Cardio', cluster: 'Stair Climbers', slug: 'stair-climbers', keywords: ['stair climber', 'stairmaster', 'stepr'] },
  { hub: 'Cardio', cluster: 'Vertical Climbers', slug: 'vertical-climbers', keywords: ['vertical climber', 'versaclimber'] },
  { hub: 'Cardio', cluster: 'Pilates', slug: 'pilates', keywords: ['pilates'] },
]

function inferTaxonomy(title: string) {
  const lower = title.toLowerCase()
  for (const c of CLUSTER_KEYWORDS) {
    if (c.keywords.some(k => lower.includes(k))) {
      return { hub: c.hub, cluster: c.cluster, collection_slug: c.slug }
    }
  }
  return { hub: 'Saunas', cluster: 'Traditional Saunas', collection_slug: 'traditional-saunas' }
}

async function shopifyDelete(blogHandle: string, articleId: number, token: string): Promise<boolean> {
  // First get blog id
  for (const v of API_VERSIONS) {
    const blogsRes = await fetch(
      `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs.json`,
      { headers: { 'X-Shopify-Access-Token': token } }
    )
    if (!blogsRes.ok) continue
    const blogsData = await blogsRes.json()
    const blog = (blogsData.blogs || []).find((b: { handle: string; id: number }) => b.handle === blogHandle)
    if (!blog) return false

    const delRes = await fetch(
      `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs/${blog.id}/articles/${articleId}.json`,
      { method: 'DELETE', headers: { 'X-Shopify-Access-Token': token } }
    )
    return delRes.ok || delRes.status === 204 || delRes.status === 404
  }
  return false
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
    const token = await getShopifyAccessToken()

    let deleted = 0; let queued = 0
    const errors: string[] = []

    for (const a of body.articles) {
      // 1. Delete from Shopify
      try {
        const ok = await shopifyDelete(a.blog_handle, a.shopify_id, token)
        if (ok) deleted++
        else errors.push(`Delete failed for ${a.shopify_id}`)
      } catch (e) {
        errors.push(`Delete ${a.shopify_id}: ${e instanceof Error ? e.message : 'Failed'}`)
        continue // don't add to Brain if delete failed
      }

      // 2. Add to content_brain as planned, preserving original handle
      const { hub, cluster, collection_slug } = inferTaxonomy(a.title)
      try {
        // Skip if already queued
        const existing = await sql`
          SELECT id FROM content_brain WHERE url_slug = ${a.handle} LIMIT 1
        ` as unknown as Array<{ id: number }>
        if (existing.length > 0) { queued++; continue }

        await sql`
          INSERT INTO content_brain (
            title, hub, cluster_group, collection, collection_slug,
            url_slug, status, traffic_light, source,
            strategic_notes
          ) VALUES (
            ${a.title}, ${hub}, ${cluster}, ${cluster}, ${collection_slug},
            ${a.handle}, 'planned', 'unvetted', 'rebuild-queue',
            ${'Rebuild: old article deleted, regenerate at same URL to preserve SEO value'}
          )
        `
        queued++
      } catch (e) {
        errors.push(`Queue ${a.title}: ${e instanceof Error ? e.message : 'DB failed'}`)
      }
    }

    return NextResponse.json({ ok: true, deleted, queued, errors })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 })
  }
}
