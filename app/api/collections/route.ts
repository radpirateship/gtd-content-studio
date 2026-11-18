// app/api/collections/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'
import { ensureCollectionColumns } from '@/lib/ensureCollectionColumns'

export async function GET(req: NextRequest) {
  const sql = getSQL()
  await ensureCollectionColumns(sql)
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.toLowerCase() || ''
  const category = searchParams.get('category') || ''
  const type = searchParams.get('type') || ''
  const priority = searchParams.get('priority') || ''
  const optimized = searchParams.get('optimized') || ''

  const allRows = await sql`SELECT * FROM gtd_collections ORDER BY category, slug`

  let rows = Array.from(allRows) as any[]

  if (search) {
    rows = rows.filter((r: any) =>
      r.slug?.toLowerCase().includes(search) ||
      r.primary_keyword?.toLowerCase().includes(search) ||
      r.title_tag?.toLowerCase().includes(search)
    )
  }
  if (category) rows = rows.filter((r: any) => r.category === category)
  if (type) rows = rows.filter((r: any) => r.collection_type === type)
  if (priority) rows = rows.filter((r: any) => String(r.priority) === priority)
  if (optimized === 'true') rows = rows.filter((r: any) => r.is_optimized === true)
  if (optimized === 'false') rows = rows.filter((r: any) => r.is_optimized !== true)

  return NextResponse.json({ collections: rows, total: rows.length })
}

export async function POST(req: NextRequest) {
  const sql = getSQL()
  const body = await req.json()
  const {
    slug, url, category, collection_type = 'standard',
    primary_keyword, secondary_keywords = [],
    title_tag, meta_description, priority,
    search_volume, kd, tier, notes,
    shopify_collection_id
  } = body

  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 })

  const [row] = await sql`
    INSERT INTO gtd_collections
      (slug, url, category, collection_type, primary_keyword, secondary_keywords,
       title_tag, meta_description, priority, search_volume, kd, tier, notes, shopify_collection_id)
    VALUES
      (${slug}, ${url}, ${category}, ${collection_type}, ${primary_keyword},
       ${secondary_keywords}, ${title_tag}, ${meta_description}, ${priority},
       ${search_volume}, ${kd}, ${tier}, ${notes}, ${shopify_collection_id})
    RETURNING *
  `
  return NextResponse.json({ collection: row }, { status: 201 })
}
