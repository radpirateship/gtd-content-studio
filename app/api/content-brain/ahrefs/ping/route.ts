// app/api/content-brain/ahrefs/ping/route.ts
// Diagnostic endpoint — verifies that the Ahrefs key is reaching production,
// the auth format is accepted, and the API is returning data.
//
// Returns a rich status object (never throws) so the UI can surface exactly
// what's wrong without needing DevTools.
import { NextResponse } from 'next/server'

export async function POST() {
  return GET()
}

export async function GET() {
  const key = process.env.AHREFS_API_KEY
  const status = {
    ok: false as boolean,
    key_present: !!key,
    key_length: key ? key.length : 0,
    key_preview: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null,
    endpoint: 'https://api.ahrefs.com/v3/keywords-explorer/overview',
    http_status: null as number | null,
    response_sample: null as unknown,
    error: null as string | null,
  }

  if (!key) {
    status.error = 'AHREFS_API_KEY not set in Vercel env. Add it under Settings → Environment Variables, then REDEPLOY (env changes are not hot-reloaded).'
    return NextResponse.json(status)
  }

  try {
    const url = new URL('https://api.ahrefs.com/v3/keywords-explorer/overview')
    url.searchParams.set('keywords', 'hyperbaric chamber benefits')
    url.searchParams.set('country', 'us')
    url.searchParams.set('select', 'keyword,volume,difficulty,traffic_potential')

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    })
    status.http_status = res.status

    const text = await res.text()
    let parsed: unknown = null
    try { parsed = JSON.parse(text) } catch { /* non-JSON */ }

    if (!res.ok) {
      status.error = `Ahrefs returned ${res.status}: ${text.slice(0, 400)}`
      status.response_sample = parsed ?? text.slice(0, 400)
      return NextResponse.json(status)
    }

    status.ok = true
    status.response_sample = parsed
    return NextResponse.json(status)
  } catch (err) {
    status.error = `Network error: ${err instanceof Error ? err.message : 'Unknown'}`
    return NextResponse.json(status)
  }
}
