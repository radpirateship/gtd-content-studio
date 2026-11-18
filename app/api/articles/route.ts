import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { countEditorialLinks } from "@/lib/article-v2";

// The link counter the review list reads. v2 bodies arrive with their links
// already written, and this route used to save them with link_count 0 and
// has_internal_links false because only add-links/apply-links ever set those
// columns. Count what is actually in the HTML: editorial-class anchors when
// present, otherwise any site article or collection link (v1 bodies).
function countLinksInHtml(html: string | null | undefined): number {
  if (!html) return 0;
  const editorial = countEditorialLinks(html);
  if (editorial > 0) return editorial;
  const hrefs = html.match(/href=["'](?:https?:\/\/(?:www\.)?peakprimalwellness\.com)?\/(?:blogs|collections)\/[^"'#?]+/gi) || [];
  return new Set(hrefs.map((h) => h.toLowerCase().replace(/\/+$/, ""))).size;
}

// GET - Fetch all articles or a specific article
export async function GET(request: NextRequest) {
  try {
    const sql = getSQL();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (id) {
      const articles = await sql`
        SELECT * FROM articles WHERE id = ${id}
      `;
      if (articles.length === 0) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
      }
      return NextResponse.json(articles[0]);
    }

    const articles = await sql`
      SELECT id, title, slug, category, keyword, status, word_count, meta_description, article_type, created_at, updated_at
      FROM articles
      ORDER BY created_at DESC
    `;
    return NextResponse.json(articles);
  } catch (error) {
    console.error("Error fetching articles:", error);
    return NextResponse.json(
      { error: "Failed to fetch articles" },
      { status: 500 }
    );
  }
}

// POST - Create a new article
export async function POST(request: NextRequest) {
  try {
    const sql = getSQL();
    const body = await request.json();
    const {
      title,
      slug,
      category,
      keyword,
      html_content,
      meta_description,
      schema_markup,
      featured_image_url,
      featured_image_alt,
      word_count,
      status = "draft",
    article_type, } = body;

    // A slug that already exists means we are re-generating a piece we already
    // have, which is the normal case for a revamp. The old behaviour appended
    // Date.now() to force uniqueness, and that mangled slug then travelled all
    // the way to Shopify: seven live articles ended up on URLs like
    // "how-much-does-a-home-gym-cost-2026-pricing-guide-1787393895356".
    // The match was also a LIKE prefix, so "barbell-guide" collided with
    // "barbell-guide-2026" and mangled a slug that was never a duplicate.
    //
    // Now: exact match only, and a hit UPDATES the existing row rather than
    // inventing a new URL. The slug is the asset; it never changes here.
    const existing = await sql`SELECT id FROM articles WHERE slug = ${slug} LIMIT 1`;
    const uniqueSlug = slug;

    if (existing.length > 0) {
      const linkCountExisting = countLinksInHtml(html_content);
      const updated = await sql`
        UPDATE articles SET
          title = ${title}, category = ${category}, keyword = ${keyword},
          html_content = ${html_content}, meta_description = ${meta_description},
          schema_markup = ${schema_markup || null},
          featured_image_url = ${featured_image_url || null},
          featured_image_alt = ${featured_image_alt || null},
          word_count = ${word_count || 0}, status = ${status},
          article_type = ${article_type || null},
          link_count = ${linkCountExisting}, has_internal_links = ${linkCountExisting > 0},
          updated_at = NOW()
        WHERE id = ${existing[0].id}
        RETURNING *
      `;
      return NextResponse.json({ ...updated[0], replacedExisting: true }, { status: 200 });
    }

    const linkCount = countLinksInHtml(html_content);
    const articles = await sql`
      INSERT INTO articles (
        title, slug, category, keyword, html_content, meta_description,
        schema_markup, featured_image_url, featured_image_alt, word_count, status, article_type,
        link_count, has_internal_links
      ) VALUES (
        ${title}, ${uniqueSlug}, ${category}, ${keyword}, ${html_content}, ${meta_description},
        ${schema_markup || null}, ${featured_image_url || null}, ${featured_image_alt || null}, 
        ${word_count || 0}, ${status}, ${article_type || null},
        ${linkCount}, ${linkCount > 0}
      )
      RETURNING *
    `;

    return NextResponse.json(articles[0], { status: 201 });
  } catch (error) {
    console.error("Error creating article:", error);
    return NextResponse.json(
      { error: "Failed to create article" },
      { status: 500 }
    );
  }
}

// PUT - Update an existing article
export async function PUT(request: NextRequest) {
  try {
    const sql = getSQL();
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Article ID required" }, { status: 400 });
    }

    // Build dynamic update query
    const allowedFields = [
      "title", "slug", "category", "keyword", "html_content", "meta_description",
      "schema_markup", "featured_image_url", "featured_image_alt", "word_count", "status"
    ];

    const updateFields: string[] = [];
    const values: unknown[] = [];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(field);
        values.push(updates[field]);
      }
    }

    if (updateFields.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // Recount links whenever the body changes so the review list stays honest.
    const putLinkCount = updates.html_content !== undefined ? countLinksInHtml(updates.html_content) : 0;
    // Use parameterized query for safety
    const articles = await sql`
      UPDATE articles 
      SET 
        title = COALESCE(${updates.title}, title),
        slug = COALESCE(${updates.slug}, slug),
        category = COALESCE(${updates.category}, category),
        keyword = COALESCE(${updates.keyword}, keyword),
        html_content = COALESCE(${updates.html_content}, html_content),
        meta_description = COALESCE(${updates.meta_description}, meta_description),
        schema_markup = COALESCE(${updates.schema_markup}, schema_markup),
        featured_image_url = CASE WHEN ${'featured_image_url' in updates}::boolean THEN ${updates.featured_image_url ?? null} ELSE featured_image_url END,
        featured_image_alt = CASE WHEN ${'featured_image_alt' in updates}::boolean THEN ${updates.featured_image_alt ?? null} ELSE featured_image_alt END,
        word_count = COALESCE(${updates.word_count}, word_count),
        status = COALESCE(${updates.status}, status),
          article_type = COALESCE(${updates.article_type}, article_type),
        link_count = CASE WHEN ${updates.html_content !== undefined}::boolean THEN ${putLinkCount} ELSE link_count END,
        has_internal_links = CASE WHEN ${updates.html_content !== undefined}::boolean THEN ${putLinkCount > 0} ELSE has_internal_links END,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    if (articles.length === 0) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    return NextResponse.json(articles[0]);
  } catch (error) {
    console.error("Error updating article:", error);
    return NextResponse.json(
      { error: "Failed to update article" },
      { status: 500 }
    );
  }
}

// DELETE - Delete an article
export async function DELETE(request: NextRequest) {
  try {
    const sql = getSQL();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Article ID required" }, { status: 400 });
    }

    await sql`DELETE FROM articles WHERE id = ${id}`;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting article:", error);
    return NextResponse.json(
      { error: "Failed to delete article" },
      { status: 500 }
    );
  }
}
