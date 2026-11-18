// app/api/content-brain/ideas/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

const ALLOWED_FIELDS = new Set([
  'title',
  'keyword',
  'hub',
  'cluster_group',
  'collection',
  'collection_slug',
  'content_type',
  'article_type',
  'audience',
  'tone',
  'word_count',
  'include_comparison_table',
  'special_instructions',
  'priority',
  'status',
  'traffic_light',
  'ai_reasoning',
  'source',
  'shopify_article_id',
  'shopify_blog_handle',
  'kw_volume',
  'kw_difficulty',
  'traffic_potential',
  'url_slug',
  'ultimate_guide_url',
  'ultimate_guide_title',
  'target_subcollection',
  'target_brand',
  'notes',
  'strategic_notes',
  'opportunity_score',
  'is_shopify_page',
])

export async function GET(req: NextRequest) {
  const sql = getSQL()
  const { searchParams } = new URL(req.url)
  const hub = searchParams.get('hub') || ''
  const cluster_group = searchParams.get('cluster_group') || ''
  const status = searchParams.get('status') || ''
  const traffic_light = searchParams.get('traffic_light') || ''
  const content_type = searchParams.get('content_type') || ''
  const search = (searchParams.get('search') || '').toLowerCase()

  // content_health is the corpus audit layer, keyed by slug: segment, grade,
  // cannibalization, index status, em dashes, image reusability, and the head
  // GSC query. Joined here (LEFT, tolerant of the table not existing) so the
  // Content Brain shows how each planned or published piece is actually doing,
  // not just what was planned. Prefixed health_* so nothing collides with a
  // content_brain column.
  const all = await sql`
    SELECT cb.*,
           h.segment          AS health_segment,
           h.grade            AS health_grade,
           h.voice_score      AS health_voice_score,
           h.em_dashes        AS health_em_dashes,
           h.ai_tells         AS health_ai_tells,
           h.era              AS health_era,
           h.content_images   AS health_content_images,
           h.images_keepable  AS health_images_keepable,
           h.cluster_id       AS health_cluster_id,
           h.cannibal_queries AS health_cannibal_queries,
           h.cannibal_partners AS health_cannibal_partners,
           h.index_status     AS health_index_status,
           h.gsc_keyword      AS health_gsc_keyword,
           h.revamp_mode      AS health_revamp_mode,
           h.audited_at       AS health_audited_at,
           bp.clicks          AS health_clicks,
           bp.impressions     AS health_impressions,
           bp.position        AS health_position,
           t.status           AS health_revamp_status
    FROM content_brain cb
    LEFT JOIN content_health h ON h.slug = cb.url_slug
    LEFT JOIN blog_posts bp ON bp.slug = cb.url_slug
    LEFT JOIN blog_post_tracking t ON t.slug = cb.url_slug
    ORDER BY cb.hub, cb.cluster_group, cb.created_at DESC
  `
  let rows = Array.from(all) as Record<string, unknown>[]

  if (hub) rows = rows.filter((r) => r.hub === hub)
  if (cluster_group) rows = rows.filter((r) => r.cluster_group === cluster_group)
  if (status) rows = rows.filter((r) => r.status === status)
  if (traffic_light) rows = rows.filter((r) => r.traffic_light === traffic_light)
  if (content_type) rows = rows.filter((r) => r.content_type === content_type)
  if (search) {
    rows = rows.filter((r) => {
      const t = String(r.title || '').toLowerCase()
      const k = String(r.keyword || '').toLowerCase()
      return t.includes(search) || k.includes(search)
    })
  }

  return NextResponse.json({ ideas: rows, total: rows.length })
}

export async function POST(req: NextRequest) {
  const sql = getSQL()
  const body = await req.json()
  if (!body.title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const [row] = await sql`
    INSERT INTO content_brain (
      title, keyword, hub, cluster_group, collection, collection_slug,
      content_type, article_type, audience, tone, word_count,
      include_comparison_table, special_instructions, priority, status,
      traffic_light, ai_reasoning, source, shopify_article_id, shopify_blog_handle,
      kw_volume, kw_difficulty, traffic_potential, url_slug, notes
    ) VALUES (
      ${body.title},
      ${body.keyword ?? null},
      ${body.hub ?? null},
      ${body.cluster_group ?? null},
      ${body.collection ?? null},
      ${body.collection_slug ?? null},
      ${body.content_type ?? 'cluster'},
      ${body.article_type ?? null},
      ${body.audience ?? null},
      ${body.tone ?? null},
      ${body.word_count ?? 2500},
      ${body.include_comparison_table ?? false},
      ${body.special_instructions ?? null},
      ${body.priority ?? null},
      ${body.status ?? 'idea'},
      ${body.traffic_light ?? 'unvetted'},
      ${body.ai_reasoning ?? null},
      ${body.source ?? 'manual'},
      ${body.shopify_article_id ?? null},
      ${body.shopify_blog_handle ?? null},
      ${body.kw_volume ?? null},
      ${body.kw_difficulty ?? null},
      ${body.traffic_potential ?? null},
      ${body.url_slug ?? null},
      ${body.notes ?? null}
    )
    RETURNING *
  `
  return NextResponse.json({ idea: row }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const sql = getSQL()
  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const entries = Object.entries(updates).filter(([k]) => ALLOWED_FIELDS.has(k))
  if (entries.length === 0) {
    return NextResponse.json({ error: 'no valid fields to update' }, { status: 400 })
  }

  // Validated column names only (from ALLOWED_FIELDS). Values are parameterized.
  for (const [key, value] of entries) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqlAny = sql as any
    if (typeof sqlAny.query === 'function') {
      await sqlAny.query(
        `UPDATE content_brain SET ${key} = $1, updated_at = NOW() WHERE id = $2`,
        [value, id]
      )
    } else {
      await sqlAny(
        `UPDATE content_brain SET ${key} = $1, updated_at = NOW() WHERE id = $2`,
        [value, id]
      )
    }
  }

  const [row] = await sql`SELECT * FROM content_brain WHERE id = ${id}`
  return NextResponse.json({ idea: row })
}

export async function DELETE(req: NextRequest) {
  const sql = getSQL()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  await sql`DELETE FROM content_brain WHERE id = ${Number(id)}`
  return NextResponse.json({ ok: true })
}
