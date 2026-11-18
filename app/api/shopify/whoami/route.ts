// GET /api/shopify/whoami — diagnostic: reports exactly what the token in this
// deployment's SHOPIFY_ACCESS_TOKEN can do (its granted scopes) and which store
// it belongs to. Read the result from the runtime logs.
import { NextResponse } from 'next/server'
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from '@/lib/shopifyAuth'

const API_VERSIONS = ['2024-10', '2024-07', '2024-04', '2024-01']

export async function GET() {
  try {
    const token = await getShopifyAccessToken()
    const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }

    // Granted scopes for THIS token
    let scopes: string[] | unknown = null
    try {
      const r = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/oauth/access_scopes.json`, { headers })
      const j = await r.json()
      scopes = Array.isArray(j.access_scopes) ? j.access_scopes.map((s: { handle: string }) => s.handle) : j
    } catch (e) { scopes = `error: ${e instanceof Error ? e.message : e}` }

    // Which store this token is for
    let shop: unknown = null
    for (const v of API_VERSIONS) {
      const r = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/shop.json`, { headers })
      if (r.ok) {
        const j = await r.json()
        shop = j.shop ? { name: j.shop.name, myshopify_domain: j.shop.myshopify_domain, id: j.shop.id } : j
        break
      }
    }

    const out = {
      configuredDomain: SHOPIFY_ADMIN_DOMAIN,
      // The app this deployment authenticates as (public client ID — safe to log).
      clientId: process.env.SHOPIFY_API_KEY || null,
      tokenPreview: token ? `${token.slice(0, 8)}…${token.slice(-4)}` : null,
      scopes,
      hasWriteProducts: Array.isArray(scopes) ? (scopes as string[]).includes('write_products') : 'unknown',
      shop,
    }
    console.log('[whoami]', JSON.stringify(out))
    return NextResponse.json(out)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[whoami] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
