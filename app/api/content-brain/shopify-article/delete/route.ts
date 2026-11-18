// app/api/content-brain/shopify-article/delete/route.ts
// Deletes one or more Shopify blog articles by shopify_id.
// Does NOT touch the content_brain DB — caller is responsible for any DB updates.
// POST { articles: Array<{ shopify_id: number; blog_handle: string }> }
import { NextRequest, NextResponse } from 'next/server'
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from '@/lib/shopifyAuth'

export const maxDuration = 60
const API_VERSIONS = ['2024-10', '2024-07', '2024-04', '2024-01']

async function getBlogId(blogHandle: string, token: string): Promise<number | null> {
  for (const v of API_VERSIONS) {
    const res = await fetch(
      `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs.json`,
      { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } }
    )
    if (!res.ok) continue
    const data = await res.json()
    const blog = (data.blogs || []).find((b: { handle: string; id: number }) => b.handle === blogHandle)
    if (blog) return blog.id
  }
  return null
}

async function deleteArticle(blogId: number, articleId: number, token: string): Promise<boolean> {
  for (const v of API_VERSIONS) {
    const res = await fetch(
      `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/blogs/${blogId}/articles/${articleId}.json`,
      { method: 'DELETE', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } }
    )
    if (res.ok || res.status === 200 || res.status === 204) return true
    if (res.status === 404) return true // already gone
    if (res.status === 401 || res.status === 403) throw new Error(`Shopify auth failed (${res.status})`)
  }
  return false
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      articles: Array<{ shopify_id: number; blog_handle: string }>
    }
    if (!Array.isArray(body.articles) || body.articles.length === 0) {
      return NextResponse.json({ error: 'articles array required' }, { status: 400 })
    }

    const token = await getShopifyAccessToken()

    // Cache blog_handle → blog_id
    const blogIdCache = new Map<string, number>()
    const getBlog = async (handle: string) => {
      if (!blogIdCache.has(handle)) {
        const id = await getBlogId(handle, token)
        if (id) blogIdCache.set(handle, id)
      }
      return blogIdCache.get(handle) ?? null
    }

    let deleted = 0
    const errors: string[] = []

    for (const a of body.articles) {
      try {
        const blogId = await getBlog(a.blog_handle)
        if (!blogId) { errors.push(`Blog "${a.blog_handle}" not found`); continue }
        const ok = await deleteArticle(blogId, a.shopify_id, token)
        if (ok) deleted++
        else errors.push(`Failed to delete article ${a.shopify_id}`)
      } catch (e) {
        errors.push(`${a.shopify_id}: ${e instanceof Error ? e.message : 'Unknown'}`)
      }
    }

    return NextResponse.json({ ok: true, deleted, errors })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 })
  }
}
