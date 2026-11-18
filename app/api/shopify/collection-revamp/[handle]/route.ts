// app/api/shopify/collection-revamp/[handle]/route.ts
// GET  — fetch a live Shopify collection's full data (body_html, seo, id, type)
// PUT  — update body_html + seo_title + seo_description on Shopify
import { NextRequest, NextResponse } from 'next/server'
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from '@/lib/shopifyAuth'
import { fetchAdminProducts } from "@/lib/shopify/products-admin"
import { priceScanText } from "@/lib/collection-generate"

export const maxDuration = 60

const API_VERSIONS = ['2024-10', '2024-07', '2024-04', '2024-01']

async function shopifyFetch(path: string, options: RequestInit = {}) {
  const token = await getShopifyAccessToken()
  const errors: string[] = []

  for (const version of API_VERSIONS) {
    const url = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`
    // 429/5xx are RETRIED on the same version with Retry-After backoff —
    // burning through fallback versions on a rate limit just amplified the
    // hammering and made publishes fail right after bulk generation runs.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': token,
            ...(options.headers as Record<string, string> || {}),
          },
        })
        if (res.ok) return { ok: true as const, data: await res.json(), version }
        if (res.status === 429 || res.status >= 500) {
          const wait = Math.min(10, Number(res.headers.get('retry-after')) || 2)
          errors.push(`${version}: ${res.status} (attempt ${attempt + 1}, waiting ${wait}s)`)
          await new Promise((r) => setTimeout(r, wait * 1000))
          continue
        }
        const body = await res.text()
        errors.push(`${version}: ${res.status} - ${body.slice(0, 200)}`)
        if (res.status === 401 || res.status === 403) {
          throw new Error(`Shopify auth failed (${res.status})`)
        }
        break // non-retryable (404/406 etc.) — try the next API version
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(msg)
        break
      }
    }
  }
  return { ok: false as const, data: null, errors }
}

// Resolve handle → { id, type: 'custom' | 'smart' }
async function resolveCollection(handle: string): Promise<{ id: number; type: 'custom' | 'smart' } | null> {
  for (const type of ['custom', 'smart'] as const) {
    const r = await shopifyFetch(`${type}_collections.json?handle=${encodeURIComponent(handle)}&limit=1`)
    if (r.ok) {
      const key = `${type}_collections`
      const list = (r.data as Record<string, Array<{ id: number }>>)[key] || []
      if (list[0]?.id) return { id: list[0].id, type }
    }
  }
  return null
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ handle: string }> }
) {
  const { handle } = await context.params

  const resolved = await resolveCollection(handle)
  if (!resolved) {
    return NextResponse.json({ error: `Collection '${handle}' not found on Shopify (if it definitely exists, the API may be rate-limited from a bulk run — wait a minute and retry)` }, { status: 404 })
  }

  const r = await shopifyFetch(`${resolved.type}_collections/${resolved.id}.json`)
  if (!r.ok) {
    return NextResponse.json({ error: 'Failed to fetch collection from Shopify' }, { status: 500 })
  }

  const key = `${resolved.type}_collection`
  const col = (r.data as Record<string, Record<string, unknown>>)[key]

  // SEO title/description are stored as metafields (global.title_tag /
  // global.description_tag), NOT on the REST collection object — fetch them.
  // limit=250: the default page size is 50 and app metafields (reviews,
  // Smart SEO extras) can push title_tag past page 1, which made the UI
  // silently fall back to the bare collection title on metafield-heavy
  // collections (e.g. air purifiers). Any-namespace fallback for app-written
  // tags, global preferred.
  const mfRes = await shopifyFetch(`collections/${resolved.id}/metafields.json?limit=250`)
  const metafields = mfRes.ok
    ? ((mfRes.data as { metafields?: Array<{ namespace: string; key: string; value: string }> }).metafields || [])
    : []
  // Smart SEO and similar apps may store under their own namespace/keys —
  // try the standard key first (global preferred), then common app variants.
  const mfPick = (keys: string[]) => {
    for (const key of keys) {
      const v = metafields.find((m) => m.namespace === 'global' && m.key === key)?.value ||
        metafields.find((m) => m.key === key)?.value
      if (v) return v
    }
    return undefined
  }
  const titleTag = mfPick(['title_tag', 'seo_title', 'meta_title'])
  const descTag = mfPick(['description_tag', 'seo_description', 'meta_description'])
  if (!mfRes.ok) console.error('[collection-revamp GET] metafields fetch FAILED for', handle, '- SEO fields will show fallbacks:', JSON.stringify((mfRes as { errors?: string[] }).errors))
  if (mfRes.ok && !titleTag) console.warn('[collection-revamp GET] no SEO title metafield found for', handle, '- available keys:', metafields.map((m) => `${m.namespace}.${m.key}`).join(', ') || 'none')

  return NextResponse.json({
    id: col.id,
    handle: col.handle,
    title: col.title,
    body_html: col.body_html || '',
    collection_type: resolved.type,
    // Prefer the real metafield title tag; fall back to the collection name.
    seo_title: titleTag || col.title || '',
    seo_description: descTag || '',
    updated_at: col.updated_at,
  })
}

// Create-or-update a collection's global.<key> metafield (SEO title_tag /
// description_tag). Returns an error string on failure, else null.
async function upsertCollectionMetafield(id: number, key: string, value: string): Promise<string | null> {
  const existing = await shopifyFetch(`collections/${id}/metafields.json?namespace=global&key=${key}`)
  const mf = existing.ok
    ? ((existing.data as { metafields?: Array<{ id: number }> }).metafields || [])[0]
    : null
  if (mf?.id) {
    const r = await shopifyFetch(`metafields/${mf.id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ metafield: { id: mf.id, value } }),
    })
    return r.ok ? null : ((r.errors || []).join('; ') || 'update failed')
  }
  const r = await shopifyFetch(`collections/${id}/metafields.json`, {
    method: 'POST',
    body: JSON.stringify({ metafield: { namespace: 'global', key, type: 'single_line_text_field', value } }),
  })
  return r.ok ? null : ((r.errors || []).join('; ') || 'create failed')
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ handle: string }> }
) {
  const { handle } = await context.params
  const body = await req.json() as {
    body_html?: string
    seo_title?: string
    seo_description?: string
    baseline_html?: string   // the live body the caller started from; figures already in it never block
  }

  // ── Pre-publish validation: three blockers, nothing writes if any fail ──
  let staleWarnings: string[] = []
  if (body.body_html) {
    const blockers: string[] = []
    const html = body.body_html

    // 1. Exactly one ld+json script tag.
    const ldCount = (html.match(/<script[^>]*type=["']application\/ld\+json["']/gi) || []).length
    if (ldCount > 1) blockers.push(`${ldCount} ld+json script tags found — schema must be a single @graph block`)

    // 2. No duplicate id="faq" (catches duplicate section injection).
    const faqIdCount = (html.match(/id=["']faq["']/gi) || []).length
    if (faqIdCount > 1) blockers.push(`${faqIdCount} elements with id="faq" — duplicate FAQ section injected`)

    // 3. Every displayed price matches a live variant price (or compare-at).
    try {
      // limit MUST match the generate route (250) — a 100 cap made prices from
      // products 101+ look stale on large collections (e.g. sauna heaters)
      const products = await fetchAdminProducts({ collectionHandle: handle, limit: 250 })
      const valid = new Set<number>()
      for (const pr of products) {
        const v = Math.round(parseFloat(pr.price)); if (Number.isFinite(v) && v > 0) valid.add(v)
        const c = Math.round(parseFloat(pr.compareAtPrice)); if (Number.isFinite(c) && c > 0) valid.add(c)
      }
      if (valid.size > 0) {
        // Article headlines are not price claims. "Kangen Water vs. Tyent vs.
        // Echo: Is the $5,000 Price Tag a Scam?" is a legitimate Learning
        // Center link whose title blocked the whole page from publishing.
        // priceScanText drops the Learning Center and article/page link text.
        const clean = priceScanText(html)
        // Keep the sentence each bad figure sits in. "$5,000" on its own says
        // nothing about WHY it is there; "keeps every model under $5,000" says
        // immediately that it is an invented threshold, not a stale price.
        const shown = new Map<number, string>()
        for (const m of clean.matchAll(/\$\s?([\d,]+)(?:\.\d{2})?/g)) {
          const at = m.index || 0
          const before = clean.slice(Math.max(0, at - 16), at)
          const after = clean.slice(at + m[0].length, at + m[0].length + 6)
          // savings/discount/financing figures aren't variant prices — skip
          if (/save|sav(e|ing)|off|discount|deposit|financ|as low as/i.test(before) || /\s*\/\s*mo/i.test(after)) continue
          const n = Math.round(parseFloat(m[1].replace(/,/g, "")))
          if (!Number.isFinite(n) || n < 200) continue
          if (!shown.has(n)) shown.set(n, clean.slice(Math.max(0, at - 60), at + m[0].length + 40).trim())
        }
        const staleAll = [...shown.keys()].filter((n) => ![n - 1, n, n + 1].some((x) => valid.has(x)))
        // A figure that is ALREADY on the live page is not something this
        // publish introduces, so it must not block an unrelated copy change
        // (the keyword-audit content phase hit this on hyperbaric-chambers,
        // blocked by a four-month-old "$4,495 to $42,999" H2). Pre-existing
        // stale figures are reported as warnings; only NEW figures block.
        let liveFigures = new Set<number>()
        let liveHtml = typeof body.baseline_html === 'string' ? body.baseline_html : ''
        if (!liveHtml) {
          try {
            const rc = await resolveCollection(handle)
            if (rc) {
              const cur = await shopifyFetch(`${rc.type}_collections/${rc.id}.json?fields=body_html`)
              liveHtml = cur.ok ? String((cur.data as any)?.[`${rc.type}_collection`]?.body_html || '') : ''
              if (!cur.ok) console.warn('[collection-revamp PUT] could not read live body for stale-price baseline:', JSON.stringify(cur.errors))
            }
          } catch (e) { console.warn('[collection-revamp PUT] baseline read failed:', e) }
        }
        // scan the raw live html as well as the cleaned text so a figure inside an
        // existing heading or product card counts as pre-existing either way
        for (const src of [priceScanText(liveHtml), liveHtml]) {
          for (const m of src.matchAll(/\$\s?([\d,]+)(?:\.\d{2})?/g)) {
            const n = Math.round(parseFloat(m[1].replace(/,/g, ''))); if (Number.isFinite(n)) liveFigures.add(n)
          }
        }
        const stale = staleAll.filter((n) => !liveFigures.has(n))
        staleWarnings = staleAll.filter((n) => liveFigures.has(n)).map((n) => `$${n.toLocaleString()} (already on the live page, in: "...${shown.get(n)}...")`)
        if (stale.length > 0) {
          blockers.push(`price(s) not matching any live variant: ${stale.slice(0, 6).map((n) => `$${n.toLocaleString()} (in: "...${shown.get(n)}...")`).join("; ")} — either a product price changed since generation, or the copy states a figure that is not an actual product price`)
        }
      }
    } catch (pErr) {
      console.warn("[collection-revamp PUT] price validation skipped:", pErr)
    }

    if (blockers.length > 0) {
      return NextResponse.json(
        { error: `Publish blocked by validation: ${blockers.join(" | ")}`, blockers },
        { status: 422 }
      )
    }
  }

  const resolved = await resolveCollection(handle)
  if (!resolved) {
    return NextResponse.json({ error: `Collection '${handle}' not found on Shopify (if it definitely exists, the API may be rate-limited from a bulk run — wait a minute and retry)` }, { status: 404 })
  }

  // 1) Update body_html on the collection (collections do NOT accept the
  //    metafields_global_* convenience fields — that 500s).
  let bodySaved = false
  if (body.body_html !== undefined) {
    const colKey = `${resolved.type}_collection`
    const r = await shopifyFetch(`${resolved.type}_collections/${resolved.id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ [colKey]: { id: resolved.id, body_html: body.body_html } }),
    })
    if (!r.ok) {
      console.error('[collection-revamp PUT] body update FAILED:', resolved.type, resolved.id, JSON.stringify(r.errors))
      return NextResponse.json({ error: 'Failed to update collection body on Shopify', details: r.errors }, { status: 500 })
    }
    bodySaved = true
  }

  // 2) Write SEO via the global.title_tag / global.description_tag metafields.
  //    BEST EFFORT — a metafield hiccup must never fail the body publish.
  const seoWarnings: string[] = []
  if (body.seo_title !== undefined) {
    const e = await upsertCollectionMetafield(resolved.id, 'title_tag', body.seo_title)
    if (e) { console.error('[collection-revamp PUT] title_tag metafield failed:', e); seoWarnings.push(`title_tag: ${e}`) }
  }
  if (body.seo_description !== undefined) {
    const e = await upsertCollectionMetafield(resolved.id, 'description_tag', body.seo_description)
    if (e) { console.error('[collection-revamp PUT] description_tag metafield failed:', e); seoWarnings.push(`description_tag: ${e}`) }
  }

  return NextResponse.json({
    success: true,
    handle,
    bodySaved,
    seoWarnings: seoWarnings.length ? seoWarnings : undefined,
    stalePrices: staleWarnings.length ? staleWarnings : undefined,
  })
}
