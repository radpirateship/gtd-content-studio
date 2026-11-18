// app/api/content-brain/migrate-v4/route.ts
// Adds is_shopify_page boolean to content_brain.
// When true, the row represents a Shopify Page (not a blog article) and is
// excluded from the Shopify blog audit — pages are managed separately.
import { NextResponse } from 'next/server'
import { getSQL } from '@/lib/db'

export async function POST() {
  const sql = getSQL()
  try {
    await sql`ALTER TABLE content_brain ADD COLUMN IF NOT EXISTS is_shopify_page BOOLEAN DEFAULT false`
    await sql`CREATE INDEX IF NOT EXISTS idx_content_brain_is_page ON content_brain(is_shopify_page)`

    // Auto-mark known Ultimate Guide rows as pages based on title pattern.
    // Ryan can manually toggle others via the Article Database.
    const result = await sql`
      UPDATE content_brain
      SET is_shopify_page = true
      WHERE (
        title ILIKE 'The Ultimate Guide to%'
        OR title ILIKE 'Ultimate Guide to%'
      )
      AND (is_shopify_page = false OR is_shopify_page IS NULL)
      RETURNING id, title
    ` as unknown as Array<{ id: number; title: string }>

    return NextResponse.json({
      ok: true,
      migration: 'v4',
      added_column: 'is_shopify_page',
      auto_marked_as_pages: result.length,
      sample: result.slice(0, 5).map(r => r.title),
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ hint: 'POST to run migration v4' })
}
