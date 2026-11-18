// app/api/collections/create-in-shopify/route.ts
//
// POST /api/collections/create-in-shopify   body: { slug: string }
//
// Creates a smart collection on Shopify from a repository row that does not
// exist in the store yet, using the row's rule_summary as the smart rule.
// The collection is created UNPUBLISHED so nothing appears on the live site
// until it is reviewed and published in Shopify admin (or via a later bulk
// publish step). On success the row is stamped with the new Shopify id.
//
// Rule text format (written by the scope import):
//   "ALL: TAG EQUALS heat therapy"
//   "ANY: TAG EQUALS plyo box | TAG EQUALS weight sled"
//   "ALL: VENDOR EQUALS Game Ready"

import { type NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { ensureCollectionColumns } from '@/lib/ensureCollectionColumns'
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from '@/lib/shopifyAuth'

export const maxDuration = 60

const API_VERSIONS = ['2024-10', '2024-07', '2024-04', '2024-01']

const ACRONYMS: Record<string, string> = {
    iastm: 'IASTM', cpm: 'CPM', emg: 'EMG', bfr: 'BFR', hci: 'HCI', ubes: 'UBEs',
}

function titleFromSlug(slug: string): string {
    return slug
      .replace(/-\d+$/, '')
      .split('-')
      .map((w) => ACRONYMS[w] ?? (w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ')
}

interface ParsedRule { column: string; relation: string; condition: string }

function parseRules(ruleSummary: string): { disjunctive: boolean; rules: ParsedRule[] } | null {
    const text = (ruleSummary || '').trim()
    if (!text) return null
    const disjunctive = /^ANY\s*:/i.test(text)
    const body = text.replace(/^(ALL|ANY)\s*:\s*/i, '')
    const rules: ParsedRule[] = []
        for (const part of body.split('|')) {
              const m = part.trim().match(/^(TAG|TYPE|VENDOR)\s+EQUALS\s+(.+)$/i)
              if (!m) continue
              const col = m[1].toUpperCase()
              rules.push({
                      column: col === 'TAG' ? 'tag' : col === 'TYPE' ? 'type' : 'vendor',
                      relation: 'equals',
                      condition: m[2].trim(),
              })
        }
    return rules.length ? { disjunctive, rules } : null
}

async function shopifyGet(path: string): Promise<Record<string, any> | null> {
    const token = await getShopifyAccessToken()
    for (const v of API_VERSIONS) {
          const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/${path}`, {
                  headers: { 'X-Shopify-Access-Token': token },
          })
          if (res.ok) return (await res.json()) as Record<string, any>
          if ([401, 403].includes(res.status)) break
    }
    return null
}

async function shopifyPost(path: string, body: unknown) {
    const token = await getShopifyAccessToken()
    let lastDetail = ''
    for (const v of API_VERSIONS) {
          const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/${path}`, {
                  method: 'POST',
                  headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
          })
          if (res.ok) return (await res.json()) as Record<string, any>
          lastDetail = `${res.status}: ${(await res.text()).slice(0, 300)}`
          // 401/403/422 will not improve with an older API version — stop early.
      if ([401, 403, 422].includes(res.status)) break
    }
    throw new Error(`Shopify create failed ${lastDetail}`)
}

export async function POST(req: NextRequest) {
    try {
          const { slug } = (await req.json()) as { slug?: string }
          if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 })

      const sql = getSQL()
          await ensureCollectionColumns(sql)

      const rows = (await sql`
            SELECT slug, collection_type, rule_summary, shopify_collection_id, last_synced_at
                  FROM gtd_collections WHERE slug = ${slug}
                      `) as Array<Record<string, any>>
          if (!rows.length) return NextResponse.json({ error: `Unknown collection: ${slug}` }, { status: 404 })
          const row = rows[0]

      if (row.shopify_collection_id || row.last_synced_at) {
              return NextResponse.json({ error: `${slug} already exists on Shopify — nothing to create.` }, { status: 409 })
      }

      // Guard against a stale repository: if a collection with this handle
      // already exists on Shopify, never create a duplicate. Stamp the row so
      // the badge corrects itself and report back instead.
      for (const kind of ['smart_collections', 'custom_collections']) {
              const found = await shopifyGet(`${kind}.json?handle=${encodeURIComponent(slug)}&limit=1`)
              const hit = found?.[kind]?.[0]
              if (hit?.id) {
                        await sql`
                                  UPDATE gtd_collections SET
                                              shopify_collection_id = ${String(hit.id)},
                                                          last_synced_at = NOW()
                                                                    WHERE slug = ${slug}
                                                                            `
                        return NextResponse.json(
                          { error: `${slug} already exists on Shopify (id ${hit.id}) — row marked as synced, nothing created.` },
                          { status: 409 }
                                  )
              }
      }

      const parsed = parseRules(row.rule_summary)
          if (!parsed) {
                  return NextResponse.json(
                    { error: `${slug} has no usable smart rule. Fill in rule_summary (e.g. "ALL: TAG EQUALS heat therapy") first.` },
                    { status: 400 }
                          )
          }

      // Brand pages take the exact vendor string as the title; category pages
      // take the slug, title-cased.
      const vendorRule = parsed.rules.length === 1 && parsed.rules[0].column === 'vendor' ? parsed.rules[0] : null
          const title = vendorRule ? vendorRule.condition : titleFromSlug(slug)

      const result = await shopifyPost('smart_collections.json', {
              smart_collection: {
                        title,
                        handle: slug,
                        published: false,
                        disjunctive: parsed.disjunctive,
                        rules: parsed.rules,
              },
      })

      const created = result.smart_collection as { id: number; handle: string; title: string }
          const finalHandle = created.handle
          const handleDrifted = finalHandle !== slug

      await sql`
            UPDATE gtd_collections SET
                    shopify_collection_id = ${String(created.id)},
                            url            = ${'https://greenthumbdepot.com/collections/' + finalHandle},
                                    is_published   = FALSE,
                                            status         = 'Created, unpublished',
                                                    last_synced_at = NOW()
                                                          WHERE slug = ${slug}
                                                              `

      return NextResponse.json({
              ok: true,
              slug,
              shopifyId: created.id,
              title: created.title,
              handle: finalHandle,
              handleDrifted,
              note: handleDrifted
                ? `Shopify assigned /${finalHandle} because /${slug} was taken — check for a duplicate collection.`
                        : 'Created unpublished. Review and publish in Shopify admin.',
      })
    } catch (err) {
          console.error('[collections/create-in-shopify]', err)
          return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Create failed' },
            { status: 500 }
                )
    }
}
