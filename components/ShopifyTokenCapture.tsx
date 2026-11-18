'use client'

import { useEffect } from 'react'

/**
 * One-time token capture trigger for the Shopify access token rotation.
 *
 * Detects whether App Bridge is available (i.e. the page is loaded inside the
 * Shopify admin iframe), pulls a session JWT via `window.shopify.idToken()`,
 * and POSTs it to `/api/shopify/auth/token-exchange` so the backend can swap
 * it for a fresh offline access token and log it.
 *
 * Outside Shopify admin (e.g. visiting the app on its raw vercel.app domain
 * in a regular browser), `window.shopify` is undefined and this component
 * is a no-op.
 *
 * Remove this component and the matching route after the rotation completes.
 */

declare global {
  interface Window {
    shopify?: {
      idToken?: () => Promise<string>
    }
  }
}

export function ShopifyTokenCapture() {
  useEffect(() => {
    let cancelled = false

    async function attempt() {
      try {
        if (typeof window === 'undefined' || !window.shopify?.idToken) return false
        const sessionToken = await window.shopify.idToken()
        if (!sessionToken || cancelled) return true
        const res = await fetch('/api/shopify/auth/token-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken }),
        })
        if (!res.ok) {
          const text = await res.text()
          console.error('[ShopifyTokenCapture] exchange failed', res.status, text)
        } else {
          console.log('[ShopifyTokenCapture] exchange ok — check Vercel logs for NEW_SHOPIFY_TOKEN')
        }
        return true
      } catch (err) {
        console.error('[ShopifyTokenCapture] error', err)
        return true
      }
    }

    // App Bridge can take a moment to attach window.shopify after the page paints.
    // Try immediately, then poll briefly, then give up.
    let tries = 0
    const interval = setInterval(async () => {
      tries += 1
      const done = await attempt()
      if (done || tries >= 20) clearInterval(interval)
    }, 500)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return null
}
