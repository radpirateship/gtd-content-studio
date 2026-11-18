// app/api/collections/grade-all/route.ts
// Catalog-wide collection scan + single-collection re-audit, using the SAME
// editable SEO grade (lib/seoGrade) as the Revamp tool — so the score you see
// after improving a collection is exactly what the Audit Queue shows.
//
// POST ?slug=<handle>           — re-audit ONE collection (used after publish).
// POST ?offset=0&limit=5        — grade a BATCH (UI loops until done).
// POST ?mode=remaining&limit=5  — grade only collections not yet audited (resume).
// GET                           — stored grades, ranked worst-first.
//
// Shopify REST is rate-limited; we retry 429/5xx with backoff, pace calls, and
// only mark a collection "not found" when Shopify returns a clean empty result.
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from '@/lib/shopifyAuth'
import { computeSeoGrade } from '@/lib/seoGrade'
import { gradeCollection } from '@/lib/collectionGrade'
import { ensureCollectionColumns } from '@/lib/ensureCollectionColumns'

export const maxDuration = 120

const API_VERSION = '2024-10'
const PACE_MS = 900
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type FetchResult = { ok: true; data: any } | { ok: false; status: number }

async function shopifyFetch(path: string, token: string): Promise<FetchResult> {
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${API_VERSION}/${path}`, { headers })
      if (res.ok) return { ok: true, data: await res.json() }
      if (res.status === 429 || res.status >= 500) {
        const ra = parseFloat(res.headers.get('retry-after') || '')
        await sleep(Number.isFinite(ra) ? ra * 1000 : Math.min(2500 * (attempt + 1), 12000))
        continue
      }
      return { ok: false, status: res.status }
    } catch {
      await sleep(1000 * (attempt + 1))
    }
  }
  return { ok: false, status: 429 }
}

type Resolved = { kind: 'found'; id: number; type: 'custom' | 'smart' } | { kind: 'absent' } | { kind: 'error' }

async function resolveCollection(handle: string, token: string): Promise<Resolved> {
  let sawError = false
  for (const type of ['custom', 'smart'] as const) {
    const r = await shopifyFetch(`${type}_collections.json?handle=${encodeURIComponent(handle)}&limit=1`, token)
    if (r.ok) {
      const list = (r.data as Record<string, Array<{ id: number }>>)[`${type}_collections`] || []
      if (list[0]?.id) return { kind: 'found', id: list[0].id, type }
    } else {
      sawError = true
    }
    await sleep(PACE_MS)
  }
  return sawError ? { kind: 'error' } : { kind: 'absent' }
}

async function ensureTable(sql: ReturnType<typeof getSQL>) {
  await sql`
    CREATE TABLE IF NOT EXISTS collection_grades (
      slug TEXT PRIMARY KEY, score INTEGER, severity INTEGER, fail_count INTEGER,
      warn_count INTEGER, product_count INTEGER, checks JSONB, top_issues JSONB,
      shopify_found BOOLEAN DEFAULT TRUE, graded_at TIMESTAMPTZ DEFAULT now()
    )
  `
}

function keywordList(primary: string | null, secondary: unknown): string[] {
  const sec = Array.isArray(secondary) ? (secondary as string[]) : []
  return [primary || '', ...sec].map((k) => (k || '').trim()).filter(Boolean)
}

type GradeOutcome = { slug: string; score: number | null; found: boolean; status: 'graded' | 'absent' | 'error' }

// Grade one collection and persist to collection_grades + ppw_collections.
async function gradeOne(
  sql: ReturnType<typeof getSQL>,
  token: string,
  row: { slug: string; primary_keyword: string | null; secondary_keywords: unknown; collection_type?: string | null },
): Promise<GradeOutcome> {
  const handle = row.slug
  const resolved = await resolveCollection(handle, token)

  if (resolved.kind === 'error') return { slug: handle, score: null, found: false, status: 'error' }

  if (resolved.kind === 'absent') {
    await sql`
      INSERT INTO collection_grades (slug, score, severity, fail_count, warn_count, product_count, checks, top_issues, shopify_found, graded_at)
      VALUES (${handle}, NULL, 999, 0, 0, NULL, ${JSON.stringify([])}, ${JSON.stringify(['Not found on Shopify'])}, FALSE, now())
      ON CONFLICT (slug) DO UPDATE SET score = NULL, severity = 999, shopify_found = FALSE, top_issues = ${JSON.stringify(['Not found on Shopify'])}, graded_at = now()
    `
    await sql`
      UPDATE ppw_collections SET score = NULL, audit_fail_count = NULL, audit_warn_count = NULL,
        audit_top_issues = ${JSON.stringify(['Not found on Shopify'])}, audited_at = now() WHERE slug = ${handle}
    `
    return { slug: handle, score: null, found: false, status: 'absent' }
  }

  const colRes = await shopifyFetch(`${resolved.type}_collections/${resolved.id}.json`, token)
  if (!colRes.ok) return { slug: handle, score: null, found: false, status: 'error' }
  const col = (colRes.data as Record<string, any>)[`${resolved.type}_collection`] || {}

  const mfRes = await shopifyFetch(`collections/${resolved.id}/metafields.json`, token)
  const metafields: Array<{ namespace: string; key: string; value: string }> = mfRes.ok ? (mfRes.data.metafields || []) : []
  const seoTitle = metafields.find((m) => m.namespace === 'global' && m.key === 'title_tag')?.value || col.title || ''
  const seoDescription = metafields.find((m) => m.namespace === 'global' && m.key === 'description_tag')?.value || ''

  const cntRes = await shopifyFetch(`products/count.json?collection_id=${resolved.id}`, token)
  const productCount = cntRes.ok && typeof cntRes.data.count === 'number' ? cntRes.data.count : null

  const keywords = keywordList(row.primary_keyword, row.secondary_keywords)
  const g = computeSeoGrade({
    body_html: col.body_html || '',
    seo_title: seoTitle,
    seo_description: seoDescription,
    primary_keyword: row.primary_keyword || '',
    keywords,
  })
  // Structural grade per docs/PPW_Collection_Page_Rules.md — combined 50/50
  // with the keyword rubric so the queue reflects the FULL ruleset.
  const sg = gradeCollection({
    title: col.title || '',
    seoTitle,
    seoDescription,
    bodyHtml: col.body_html || '',
    productCount,
    primaryKeyword: row.primary_keyword || '',
    isBrand: (row.collection_type || '').toLowerCase() === 'brand',
  })
  const combined = Math.round(g.total * 0.5 + sg.score * 0.5)
  const mergedIssues = [...sg.topIssues, ...g.topIssues]
  const failCount = sg.failCount + g.topIssues.length

  await sql`
    INSERT INTO collection_grades (slug, score, severity, fail_count, warn_count, product_count, checks, top_issues, shopify_found, graded_at)
    VALUES (${handle}, ${combined}, ${100 - combined}, ${failCount}, ${sg.warnCount}, ${productCount}, ${JSON.stringify({ seo: g.breakdown, structural: sg.checks })}, ${JSON.stringify(mergedIssues)}, TRUE, now())
    ON CONFLICT (slug) DO UPDATE SET
      score = ${combined}, severity = ${100 - combined}, fail_count = ${failCount}, warn_count = ${sg.warnCount},
      product_count = ${productCount}, checks = ${JSON.stringify({ seo: g.breakdown, structural: sg.checks })}, top_issues = ${JSON.stringify(mergedIssues)},
      shopify_found = TRUE, graded_at = now()
  `
  await sql`
    UPDATE ppw_collections SET score = ${combined}, audit_fail_count = ${failCount}, audit_warn_count = ${sg.warnCount},
      audit_top_issues = ${JSON.stringify(mergedIssues)}, word_count = ${g.breakdown.technical.wordCount}, audited_at = now() WHERE slug = ${handle}
  `
  return { slug: handle, score: combined, found: true, status: 'graded' }
}

export async function POST(req: NextRequest) {
  const sql = getSQL()
  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')
  const mode = searchParams.get('mode') || 'all'
  const offset = parseInt(searchParams.get('offset') || '0', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') || '5', 10), 10)

  await ensureTable(sql)
  await ensureCollectionColumns(sql)

  let token = ''
  try {
    token = await getShopifyAccessToken()
  } catch (e) {
    return NextResponse.json({ error: `Shopify auth failed: ${e instanceof Error ? e.message : e}` }, { status: 500 })
  }

  // ── Single-collection re-audit (called after a publish) ───────────────────
  if (slug) {
    const r = (await sql`SELECT slug, primary_keyword, secondary_keywords, collection_type FROM ppw_collections WHERE slug = ${slug}`) as Array<{ slug: string; primary_keyword: string | null; secondary_keywords: unknown }>
    if (!r[0]) return NextResponse.json({ error: `Collection '${slug}' not found in database` }, { status: 404 })
    const outcome = await gradeOne(sql, token, r[0])
    return NextResponse.json({ ok: true, single: true, ...outcome })
  }

  // ── Batch ─────────────────────────────────────────────────────────────────
  const totalRow = await sql`SELECT COUNT(*)::int AS n FROM ppw_collections`
  const total = (totalRow[0] as { n: number }).n

  const rows = mode === 'remaining'
    ? ((await sql`SELECT slug, primary_keyword, secondary_keywords, collection_type FROM ppw_collections WHERE audited_at IS NULL ORDER BY category, slug LIMIT ${limit}`) as Array<{ slug: string; primary_keyword: string | null; secondary_keywords: unknown }>)
    : ((await sql`SELECT slug, primary_keyword, secondary_keywords, collection_type FROM ppw_collections ORDER BY category, slug LIMIT ${limit} OFFSET ${offset}`) as Array<{ slug: string; primary_keyword: string | null; secondary_keywords: unknown }>)

  const batch: GradeOutcome[] = []
  let errorCount = 0
  for (const row of rows) {
    const outcome = await gradeOne(sql, token, row)
    if (outcome.status === 'error') errorCount++
    batch.push(outcome)
    await sleep(PACE_MS)
  }

  const remainingRow = await sql`SELECT COUNT(*)::int AS n FROM ppw_collections WHERE audited_at IS NULL`
  const remaining = (remainingRow[0] as { n: number }).n

  // 'remaining' mode: advance until nothing un-audited is left (errors retried next pass).
  // 'all' mode: classic offset pagination.
  const progressed = batch.some((b) => b.status !== 'error')
  const nextOffset = offset + rows.length
  const done = mode === 'remaining'
    ? (remaining === 0 || rows.length === 0 || !progressed)
    : (nextOffset >= total || rows.length === 0)

  return NextResponse.json({
    ok: true, total, processed: mode === 'remaining' ? total - remaining : nextOffset,
    remaining, batch, errorCount, done, nextOffset,
  })
}

export async function GET() {
  const sql = getSQL()
  await ensureTable(sql)
  const rows = await sql`
    SELECT slug, score, severity, fail_count, warn_count, product_count, top_issues, checks, shopify_found, graded_at
    FROM collection_grades ORDER BY (score IS NULL), score ASC, slug ASC
  `
  return NextResponse.json({ grades: Array.from(rows), count: rows.length })
}
