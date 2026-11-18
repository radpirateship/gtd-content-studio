import { type NextRequest, NextResponse } from 'next/server'
import { replaceWithShopifyImages } from '@/lib/shopifyImageUpload'
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from '@/lib/shopifyAuth'
import { getSQL } from '@/lib/db'

export const maxDuration = 120

const STOREFRONT = 'https://peakprimalwellness.com'

/**
 * A 2xx from the Admin API means Shopify accepted the write. It does not mean
 * the page is reachable. In Sep 2026 eight guides were reported as published
 * and were not on the storefront, and nothing caught it for six days because
 * nothing ever looked. So look.
 *
 * Retries because a freshly created page can take a moment to serve, and the
 * URL is cache-busted so a previously cached 404 is not mistaken for the page
 * still being missing. A non-200 here is reported as unverified, never acted
 * on: this function only ever reads.
 */
async function verifyLive(handle: string): Promise<{ ok: boolean; status: number | null; attempts: number }> {
  const delays = [0, 1500, 3500]
  let status: number | null = null
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]))
    try {
      const res = await fetch(`${STOREFRONT}/pages/${handle}?_pv=${Date.now()}`, {
        redirect: 'manual',
        headers: { 'User-Agent': 'ppw-content-studio/publish-verify' },
        cache: 'no-store',
      })
      status = res.status
      if (res.status === 200) return { ok: true, status, attempts: i + 1 }
    } catch {
      status = null
    }
  }
  return { ok: false, status, attempts: delays.length }
}

/** Publishes were invisible before this. Best effort: never fail a publish over a log write. */
async function logPublish(entry: {
  action: string
  detail: string
  status: string
  durationMs: number
  metadata: Record<string, unknown>
}) {
  try {
    const sql = getSQL()
    await sql`
      INSERT INTO activity_log (action, category, detail, status, duration_ms, metadata)
      VALUES (${entry.action}, 'guide-publish', ${entry.detail}, ${entry.status},
              ${entry.durationMs}, ${JSON.stringify(entry.metadata)}::jsonb)
    `
  } catch (e) {
    console.warn('[pages-publish] activity_log write failed:', e instanceof Error ? e.message : e)
  }
}

const API_VERSIONS = ['2024-10', '2024-07', '2024-04', '2024-01']

// Same helper pattern as blog/publish — tries each API version in order
async function shopifyAdminFetch(path: string, options: RequestInit = {}) {
  const token = await getShopifyAccessToken()
  const errors: string[] = []

  for (const version of API_VERSIONS) {
    const url = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
          ...options.headers,
        },
      })

      if (response.ok) return response.json()

      const status = response.status
      const body = await response.text()
      errors.push(`v${version}: ${status} — ${body.slice(0, 200)}`)

      if (status === 401 || status === 403) {
        throw new Error(`Shopify auth failed (${status}): ${body.slice(0, 200)}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!errors.includes(msg)) errors.push(msg)
      if (version === API_VERSIONS[API_VERSIONS.length - 1]) {
        throw new Error(`All API versions failed. Errors: ${errors.join(' | ')}`)
      }
    }
  }

  throw new Error(`All Shopify API versions failed. Errors: ${errors.join(' | ')}`)
}

/**
 * POST /api/shopify/pages/publish
 *
 * Publishes an ultimate guide as a Shopify Page (not a blog article).
 * Pages API: /admin/api/{version}/pages.json
 *
 * Key difference from blog/publish:
 * - Uses pages.json endpoint instead of blogs/{id}/articles.json
 * - No blog_id or author field
 * - No featured_image field on pages — hero image is baked into body_html
 * - Meta title/description go in metafields (same pattern)
 * - Returns /pages/{handle} URL
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  try {
    const {
      title,
      bodyHtml,
      handle,
      metaDescription,
      published = true,
      pageId,
      // Opt-in only. Renaming a live page breaks every inbound link, so it
      // never happens as a side effect of a routine republish.
      renameHandle,
    } = await request.json()

    if (!title || !bodyHtml) {
      return NextResponse.json(
        { error: 'title and bodyHtml are required' },
        { status: 400 }
      )
    }

    // Safety-net: upload any remaining temp images to Shopify CDN
    // (should be a no-op if the image storyboard already uploaded everything)
    const hasTempImages = /data:image\/|fal\.media|fal\.run|fal-cdn|v3\.fal\.media/.test(bodyHtml)
    let processedHtml: string

    if (hasTempImages) {
      console.warn('[pages-publish] Found temp images — running safety-net upload...')
      processedHtml = await replaceWithShopifyImages(bodyHtml)
    } else {
      console.log('[pages-publish] All images already on CDN — skipping re-upload.')
      processedHtml = bodyHtml
    }

    // Build the page payload
    const pagePayload: Record<string, unknown> = {
      title,
      body_html: processedHtml,
      handle: handle || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      published,
    }

    // Add metafields for SEO title tag + description
    if (metaDescription) {
      pagePayload.metafields = [
        {
          namespace: 'global',
          key: 'title_tag',
          value: title,
          type: 'single_line_text_field',
        },
        {
          namespace: 'global',
          key: 'description_tag',
          value: metaDescription.replace(/[\r\n]+/g, ' ').trim().slice(0, 160),
          type: 'single_line_text_field',
        },
      ]
    }

    // Republish. A guide that already has a Shopify page id is UPDATED in
    // place, so the handle never changes and every collection record and
    // article that links to /pages/{handle} keeps working. Until Aug 2026
    // every publish was a POST, and a second publish of the same guide made a
    // duplicate page at {handle}-1.
    let data: { page: Record<string, unknown> }
    const existingId = String(pageId || '').trim()
    if (existingId) {
      // The live handle is Shopify's, not ours. Studio's slug can be stale
      // (four guides are already live under a handle that differs from the
      // slug Studio holds), and sending it here would RENAME the live page and
      // 404 every inbound link. So an update never touches the handle unless
      // the caller explicitly asks for a rename. What Shopify returns is
      // written back to the guide row, so a drifted slug self-corrects on the
      // next republish instead of breaking the page.
      const { metafields, handle: _requestedHandle, ...pageFields } = pagePayload
      const renameTo = renameHandle ? String(renameHandle).trim() : ''
      data = await shopifyAdminFetch(`pages/${existingId}.json`, {
        method: 'PUT',
        body: JSON.stringify({
          page: { id: Number(existingId), ...pageFields, ...(renameTo ? { handle: renameTo } : {}) },
        }),
      })
      // Metafields on an existing page have ids of their own; a PUT on the
      // page with a duplicate namespace/key is rejected, so update or create
      // each one individually.
      if (Array.isArray(metafields)) {
        try {
          const current = await shopifyAdminFetch(`pages/${existingId}/metafields.json`)
          const have = (current.metafields || []) as Array<{ id: number; namespace: string; key: string }>
          for (const mf of metafields as Array<{ namespace: string; key: string; value: string; type: string }>) {
            const match = have.find((m) => m.namespace === mf.namespace && m.key === mf.key)
            if (match) {
              await shopifyAdminFetch(`metafields/${match.id}.json`, {
                method: 'PUT',
                body: JSON.stringify({ metafield: { id: match.id, value: mf.value, type: mf.type } }),
              })
            } else {
              await shopifyAdminFetch(`pages/${existingId}/metafields.json`, {
                method: 'POST',
                body: JSON.stringify({ metafield: mf }),
              })
            }
          }
        } catch (e) {
          console.warn('[pages-publish] metafield update failed:', e instanceof Error ? e.message : e)
        }
      }
      console.log(`[pages-publish] updated existing page ${existingId}`)
    } else {
      data = await shopifyAdminFetch('pages.json', {
        method: 'POST',
        body: JSON.stringify({ page: pagePayload }),
      })
    }

    const createdPage = data.page as { id: number; title: string; handle: string; published_at?: string; created_at?: string }
    const pageUrl = `${STOREFRONT}/pages/${createdPage.handle}`

    // Shopify accepted the write. Confirm the page actually serves before
    // telling anyone it is published.
    const verified = await verifyLive(createdPage.handle)
    if (!verified.ok) {
      console.warn(
        `[pages-publish] page ${createdPage.id} (${createdPage.handle}) accepted by Shopify but ` +
        `the storefront returned ${verified.status ?? 'no response'} after ${verified.attempts} attempts`
      )
    }

    // Sitemap pings — same as blog/publish
    const sitemapUrl = 'https://peakprimalwellness.com/sitemap.xml'
    const pingResults: Record<string, string> = {}
    const pingUrls = [
      { name: 'Google',   url: `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}` },
      { name: 'Bing',     url: `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}` },
      { name: 'IndexNow', url: `https://api.indexnow.org/indexnow?url=${encodeURIComponent(pageUrl)}&key=peakprimalwellness` },
    ]
    for (const ping of pingUrls) {
      try {
        const res = await fetch(ping.url)
        pingResults[ping.name] = res.ok ? 'sent' : `${res.status}`
      } catch {
        pingResults[ping.name] = 'failed'
      }
    }

    await logPublish({
      action: existingId ? 'guide-page-updated' : 'guide-page-created',
      detail: `${createdPage.handle} -> ${verified.ok ? 'live' : `UNVERIFIED (${verified.status ?? 'no response'})`}`,
      status: verified.ok ? 'success' : 'unverified',
      durationMs: Date.now() - startedAt,
      metadata: {
        pageId: createdPage.id,
        requestedHandle: pagePayload.handle,
        finalHandle: createdPage.handle,
        handleChanged: pagePayload.handle !== createdPage.handle,
        url: pageUrl,
        updatedInPlace: !!existingId,
        verifyStatus: verified.status,
        verifyAttempts: verified.attempts,
      },
    })

    return NextResponse.json({
      success: true,
      page: {
        id: createdPage.id,
        title: createdPage.title,
        handle: createdPage.handle,
        url: pageUrl,
        published_at: createdPage.published_at,
        created_at: createdPage.created_at,
        updated: !!existingId,
      },
      // Shopify said yes; this says whether the page is actually reachable.
      verified: verified.ok,
      verifyStatus: verified.status,
      sitemapPing: pingResults,
    })
  } catch (error) {
    console.error('[pages-publish]', error)
    await logPublish({
      action: 'guide-page-publish-failed',
      detail: error instanceof Error ? error.message.slice(0, 300) : 'unknown error',
      status: 'error',
      durationMs: Date.now() - startedAt,
      metadata: {},
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish page to Shopify' },
      { status: 500 }
    )
  }
}
