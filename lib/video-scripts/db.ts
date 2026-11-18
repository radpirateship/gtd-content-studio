// Video Scripts module: tables. Created on first use (CREATE IF NOT EXISTS),
// so no manual Neon migration is needed. Additive only: nothing here touches
// existing tables.
import { getSQL } from "@/lib/db";

let ensured = false;

export async function ensureVideoTables(): Promise<void> {
  if (ensured) return;
  const sql = getSQL();

  // Ranked snapshot. kind = 'product' (key = Shopify product id) or
  // 'collection' (key = collection handle). Rebuilt on every refresh.
  await sql`
    CREATE TABLE IF NOT EXISTS video_rankings (
      kind          TEXT NOT NULL,
      key           TEXT NOT NULL,
      rank          INTEGER NOT NULL,
      title         TEXT NOT NULL,
      handle        TEXT,
      vendor        TEXT,
      status        TEXT,
      image_url     TEXT,
      price         TEXT,
      net           NUMERIC(12,2) NOT NULL DEFAULT 0,
      units         INTEGER NOT NULL DEFAULT 0,
      orders        INTEGER NOT NULL DEFAULT 0,
      product_count INTEGER NOT NULL DEFAULT 0,
      flags         TEXT[] NOT NULL DEFAULT '{}',
      collections   JSONB NOT NULL DEFAULT '[]',
      products      JSONB NOT NULL DEFAULT '[]',
      refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (kind, key)
    )
  `;

  // Small key/value store: refresh metadata, hidden collections.
  await sql`
    CREATE TABLE IF NOT EXISTS video_meta (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Blog posts with the product and collection links found in their body.
  await sql`
    CREATE TABLE IF NOT EXISTS video_article_index (
      article_id         BIGINT PRIMARY KEY,
      blog_handle        TEXT,
      handle             TEXT,
      title              TEXT,
      url                TEXT,
      published          BOOLEAN NOT NULL DEFAULT TRUE,
      product_handles    TEXT[] NOT NULL DEFAULT '{}',
      collection_handles TEXT[] NOT NULL DEFAULT '{}',
      word_count         INTEGER NOT NULL DEFAULT 0,
      text_content       TEXT,
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_articles_products ON video_article_index USING GIN (product_handles)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_articles_collections ON video_article_index USING GIN (collection_handles)`;

  // Scripts. One target can have several (different angles, rewrites).
  await sql`
    CREATE TABLE IF NOT EXISTS video_scripts (
      id           SERIAL PRIMARY KEY,
      kind         TEXT NOT NULL,
      target_key   TEXT NOT NULL,
      target_title TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'draft',
      format       TEXT,
      length_sec   INTEGER,
      title        TEXT,
      content      JSONB NOT NULL DEFAULT '{}',
      sources      JSONB NOT NULL DEFAULT '{}',
      warnings     JSONB NOT NULL DEFAULT '[]',
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_scripts_target ON video_scripts(kind, target_key)`;

  ensured = true;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  await ensureVideoTables();
  const sql = getSQL();
  const rows = (await sql`SELECT value FROM video_meta WHERE key = ${key}`) as Array<{ value: T }>;
  return rows[0]?.value ?? fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await ensureVideoTables();
  const sql = getSQL();
  await sql`
    INSERT INTO video_meta (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export const SCRIPT_STATUSES = ["draft", "approved", "recorded", "posted", "rejected"] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];
