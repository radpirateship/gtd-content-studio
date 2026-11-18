// app/api/content-brain/shopify-import/route.ts
// Pulls published articles from Shopify Admin API and inserts each as a
// content_brain row with status='live', source='shopify-import'.
// Idempotent: skips any article whose shopify_article_id already exists.
import { NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from '@/lib/shopifyAuth'

const API_VERSIONS = ['2024-10', '2024-07', '2024-04', '2024-01']

async function shopifyAdminFetch(path: string): Promise<Record<string, unknown>> {
  const token = await getShopifyAccessToken()
  for (const v of API_VERSIONS) {
    const url = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/${path}`
    try {
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
      })
      if (res.ok) return res.json()
      if (res.status === 404) continue
      if (res.status === 401 || res.status === 403) throw new Error(`Shopify auth failed (${res.status})`)
    } catch (err) {
      if (v === API_VERSIONS[API_VERSIONS.length - 1]) throw err
    }
  }
  throw new Error('All Shopify API versions failed.')
}

// Resolve one working API version, then page articles via the Link header so we
// import the FULL blog (not just the first 250). Returns json + the next page_info.
let resolvedVersion: string | null = null
async function fetchArticlesPage(
  blogId: number,
  pageInfo: string | null
): Promise<{ articles: ShopifyArticle[]; nextPageInfo: string | null }> {
  const token = await getShopifyAccessToken()
  // page_info cannot be combined with filters other than limit, so status is only
  // applied on the first (unpaginated) request.
  const query = pageInfo
    ? `limit=250&page_info=${encodeURIComponent(pageInfo)}`
    : `limit=250&status=published`
  const versions = resolvedVersion ? [resolvedVersion] : API_VERSIONS
  for (const v of versions) {
    const url = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs/${blogId}/articles.json?${query}`
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    })
    if (res.status === 404) continue
    if (res.status === 401 || res.status === 403) throw new Error(`Shopify auth failed (${res.status})`)
    if (!res.ok) continue
    resolvedVersion = v
    const data = (await res.json()) as { articles?: ShopifyArticle[] }
    return { articles: data.articles || [], nextPageInfo: parseNextPageInfo(res.headers.get('link')) }
  }
  return { articles: [], nextPageInfo: null }
}

function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const next = linkHeader.split(',').find((p) => p.includes('rel="next"'))
  const url = next?.match(/<([^>]+)>/)?.[1]
  if (!url) return null
  try {
    return new URL(url).searchParams.get('page_info')
  } catch {
    return null
  }
}

// Best-effort hub/cluster inference from tags + title
function inferTaxonomy(
  tags: string[],
  title: string,
  clustersByName: Map<string, { hub: string; name: string; slug: string }>
): { hub: string | null; cluster_group: string | null; collection: string | null; collection_slug: string | null } {
  const tagSet = new Set(tags.map((t) => t.trim()))
  const titleLower = title.toLowerCase()

  // 1. Exact tag match against known cluster names
  for (const tag of tagSet) {
    const match = clustersByName.get(tag)
    if (match) {
      return {
        hub: match.hub,
        cluster_group: match.name,
        collection: match.name,
        collection_slug: match.slug,
      }
    }
  }

  // 2. Substring match in title
  for (const [name, info] of clustersByName.entries()) {
    if (titleLower.includes(name.toLowerCase())) {
      return {
        hub: info.hub,
        cluster_group: info.name,
        collection: info.name,
        collection_slug: info.slug,
      }
    }
  }

  // 3. Hub fallback from tags
  const hubs = ['Saunas', 'Recovery', 'Wellness', 'Cardio']
  for (const h of hubs) {
    if (tagSet.has(h)) return { hub: h, cluster_group: null, collection: null, collection_slug: null }
  }

  return { hub: null, cluster_group: null, collection: null, collection_slug: null }
}

interface ShopifyArticle {
  id: number
  title: string
  handle: string
  tags: string
  published_at: string | null
}

interface ShopifyBlog {
  id: number
  handle: string
  title: string
}

export async function POST() {
  try {
    const sql = getSQL()

    // Load cluster map for taxonomy inference
    const clusterRows = (await sql`SELECT hub, name, slug FROM content_brain_clusters`) as unknown as Array<{
      hub: string
      name: string
      slug: string
    }>
    const clustersByName = new Map<string, { hub: string; name: string; slug: string }>()
    for (const c of clusterRows) clustersByName.set(c.name, c)

    // Existing shopify IDs for idempotency
    const existingRows = (await sql`
      SELECT shopify_article_id FROM content_brain WHERE shopify_article_id IS NOT NULL
    `) as unknown as Array<{ shopify_article_id: string }>
    const existingIds = new Set(existingRows.map((r) => r.shopify_article_id))

    // Fetch all blogs, then all articles per blog
    const blogsData = await shopifyAdminFetch('blogs.json')
    const blogs: ShopifyBlog[] = Array.isArray(blogsData.blogs) ? (blogsData.blogs as ShopifyBlog[]) : []

    let imported = 0
    let skipped = 0
    const errors: string[] = []

    for (const blog of blogs) {
      let pageInfo: string | null = null
      let firstPage = true
      while (firstPage || pageInfo) {
        firstPage = false
        try {
          const { articles, nextPageInfo } = await fetchArticlesPage(blog.id, pageInfo)
          pageInfo = nextPageInfo

          for (const a of articles) {
            const idStr = String(a.id)
            if (existingIds.has(idStr)) {
              skipped++
              continue
            }
            const tags = (a.tags || '').split(',').map((t) => t.trim()).filter(Boolean)
            const tax = inferTaxonomy(tags, a.title, clustersByName)

            await sql`
              INSERT INTO content_brain (
                title, hub, cluster_group, collection, collection_slug,
                content_type, status, traffic_light, source,
                shopify_article_id, shopify_blog_handle, url_slug
              ) VALUES (
                ${a.title}, ${tax.hub}, ${tax.cluster_group}, ${tax.collection}, ${tax.collection_slug},
                'cluster', 'live', 'unvetted', 'shopify-import',
                ${idStr}, ${blog.handle}, ${a.handle}
              )
            `
            existingIds.add(idStr)
            imported++
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          errors.push(`Blog ${blog.handle}: ${msg}`)
          pageInfo = null
        }
      }
    }

    return NextResponse.json({ imported, skipped, errors })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
