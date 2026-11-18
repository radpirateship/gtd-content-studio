// Blog post index for the Video Scripts module: which posts link to which
// products and collections. Built from the live Shopify blogs, so it only
// knows about posts that exist. Rebuilt on demand.
import { getSQL } from "@/lib/db";
import { searchAdminArticles } from "@/lib/shopify/blog-admin";
import { ensureVideoTables, setMeta } from "./db";
import { htmlToText } from "./shopify";

const PRODUCT_LINK = /\/products\/([a-z0-9][a-z0-9-]*)/gi;
const COLLECTION_LINK = /\/collections\/([a-z0-9][a-z0-9-]*)/gi;
const MAX_TEXT = 40000;

function uniq(matches: IterableIterator<RegExpMatchArray>): string[] {
  return [...new Set([...matches].map((m) => m[1].toLowerCase()))];
}

export async function refreshArticleIndex(): Promise<{ articles: number; withProductLinks: number }> {
  await ensureVideoTables();
  const articles = await searchAdminArticles({ limit: 20000 });
  const rows = articles.map((a) => {
    const body = a.body_html || "";
    const text = htmlToText(body);
    return {
      article_id: a.legacy_id,
      blog_handle: a.blog_handle,
      handle: a.handle,
      title: a.title,
      url: a.online_store_url,
      published: Boolean(a.published_at),
      product_handles: uniq(body.matchAll(PRODUCT_LINK)),
      // "/collections/x/products/y" counts as a link to both.
      collection_handles: uniq(body.matchAll(COLLECTION_LINK)).filter((h) => h !== "all"),
      word_count: text ? text.split(/\s+/).length : 0,
      text_content: text.slice(0, MAX_TEXT),
    };
  });

  const sql = getSQL();
  await sql`DELETE FROM video_article_index`;
  const CHUNK = 60;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = JSON.stringify(rows.slice(i, i + CHUNK));
    await sql`
      INSERT INTO video_article_index
        (article_id, blog_handle, handle, title, url, published, product_handles, collection_handles, word_count, text_content, updated_at)
      SELECT article_id, blog_handle, handle, title, url, published,
             ARRAY(SELECT jsonb_array_elements_text(product_handles)),
             ARRAY(SELECT jsonb_array_elements_text(collection_handles)),
             word_count, text_content, NOW()
      FROM jsonb_to_recordset(${chunk}::jsonb) AS x(
        article_id bigint, blog_handle text, handle text, title text, url text, published boolean,
        product_handles jsonb, collection_handles jsonb, word_count int, text_content text
      )
      ON CONFLICT (article_id) DO NOTHING
    `;
  }

  const withProductLinks = rows.filter((r) => r.product_handles.length > 0).length;
  await setMeta("articles", { refreshedAt: new Date().toISOString(), articles: rows.length, withProductLinks });
  return { articles: rows.length, withProductLinks };
}

export type IndexedArticle = {
  articleId: string;
  title: string;
  url: string;
  wordCount: number;
  match: "product" | "collection" | "title";
  excerpt: string;
};

type Row = { article_id: string; title: string; url: string; word_count: number; text_content: string | null };

function shape(r: Row, match: IndexedArticle["match"]): IndexedArticle {
  return {
    articleId: String(r.article_id),
    title: r.title,
    url: r.url,
    wordCount: r.word_count,
    match,
    excerpt: (r.text_content || "").slice(0, 280),
  };
}

/** Published posts linking to a product, then posts linking to its collections. */
export async function articlesForProduct(productHandle: string, collectionHandles: string[], max = 12): Promise<IndexedArticle[]> {
  await ensureVideoTables();
  const sql = getSQL();
  const h = productHandle.toLowerCase();
  const direct = (await sql`
    SELECT article_id, title, url, word_count, LEFT(text_content, 400) AS text_content
    FROM video_article_index
    WHERE published AND product_handles @> ARRAY[${h}]::text[]
    ORDER BY word_count DESC
    LIMIT ${max}
  `) as Row[];
  const out = direct.map((r) => shape(r, "product"));
  const remaining = max - out.length;
  if (remaining > 0 && collectionHandles.length) {
    const seen = out.map((a) => a.articleId);
    const cols = collectionHandles.map((c) => c.toLowerCase());
    const viaCollection = (await sql`
      SELECT article_id, title, url, word_count, LEFT(text_content, 400) AS text_content
      FROM video_article_index
      WHERE published AND collection_handles && ${cols}::text[]
        AND NOT (article_id::text = ANY(${seen}::text[]))
      ORDER BY word_count DESC
      LIMIT ${Math.min(remaining, 6)}
    `) as Row[];
    out.push(...viaCollection.map((r) => shape(r, "collection")));
  }
  return out;
}

/** Published posts linking to a collection. */
export async function articlesForCollection(collectionHandle: string, max = 12): Promise<IndexedArticle[]> {
  await ensureVideoTables();
  const sql = getSQL();
  const h = collectionHandle.toLowerCase();
  const rows = (await sql`
    SELECT article_id, title, url, word_count, LEFT(text_content, 400) AS text_content
    FROM video_article_index
    WHERE published AND collection_handles @> ARRAY[${h}]::text[]
    ORDER BY word_count DESC
    LIMIT ${max}
  `) as Row[];
  return rows.map((r) => shape(r, "collection"));
}

export async function articleTexts(ids: string[]): Promise<Array<{ articleId: string; title: string; url: string; text: string }>> {
  if (!ids.length) return [];
  await ensureVideoTables();
  const sql = getSQL();
  const rows = (await sql`
    SELECT article_id, title, url, text_content FROM video_article_index
    WHERE article_id::text = ANY(${ids}::text[])
  `) as Array<{ article_id: string; title: string; url: string; text_content: string | null }>;
  return rows.map((r) => ({ articleId: String(r.article_id), title: r.title, url: r.url, text: r.text_content || "" }));
}
