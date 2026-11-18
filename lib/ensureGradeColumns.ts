import { getSQL } from "@/lib/db";

/**
 * Guarantees the grader columns exist on blog_post_tracking before any query
 * references them. Idempotent and cheap; called by the backlog GET and the
 * grader sync so neither depends on the other having run first.
 */
let ensured = false;

export async function ensureGradeColumns(): Promise<void> {
  if (ensured) return;
  const sql = getSQL();
  await sql`ALTER TABLE blog_post_tracking ADD COLUMN IF NOT EXISTS grade_score INTEGER`;
  await sql`ALTER TABLE blog_post_tracking ADD COLUMN IF NOT EXISTS grade_failures TEXT`;
  await sql`ALTER TABLE blog_post_tracking ADD COLUMN IF NOT EXISTS collection_links INTEGER`;
  await sql`ALTER TABLE blog_post_tracking ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ`;
  await sql`ALTER TABLE blog_post_tracking ADD COLUMN IF NOT EXISTS voice_score INTEGER`;
  ensured = true;
}
