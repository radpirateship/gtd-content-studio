// /api/video-scripts/scripts
//   GET    ?id=123                    one script
//   GET    ?kind=product&key=...      all scripts for a target, newest first
//   GET    (no params)                every script, newest first (limit 300)
//   PATCH  { id, status?, notes?, content? }
//   DELETE ?id=123
import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ensureVideoTables, SCRIPT_STATUSES } from "@/lib/video-scripts/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (e: unknown, status = 500) =>
  NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET(req: NextRequest) {
  try {
    await ensureVideoTables();
    const sql = getSQL();
    const id = req.nextUrl.searchParams.get("id");
    const kind = req.nextUrl.searchParams.get("kind");
    const key = req.nextUrl.searchParams.get("key");
    if (id) {
      const rows = await sql`SELECT * FROM video_scripts WHERE id = ${Number(id)}`;
      if (!rows.length) return fail("Script not found", 404);
      return NextResponse.json({ ok: true, script: rows[0] });
    }
    const rows = kind && key
      ? await sql`SELECT * FROM video_scripts WHERE kind = ${kind} AND target_key = ${key} ORDER BY created_at DESC`
      : await sql`SELECT id, kind, target_key, target_title, status, format, length_sec, title, created_at, updated_at
                  FROM video_scripts ORDER BY created_at DESC LIMIT 300`;
    return NextResponse.json({ ok: true, scripts: rows });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureVideoTables();
    const b = (await req.json()) as { id?: number; status?: string; notes?: string | null; content?: unknown };
    if (!b.id) return fail("id is required", 400);
    if (b.status && !(SCRIPT_STATUSES as readonly string[]).includes(b.status)) return fail(`Unknown status ${b.status}`, 400);
    const sql = getSQL();
    const rows = await sql`
      UPDATE video_scripts SET
        status     = COALESCE(${b.status ?? null}, status),
        notes      = CASE WHEN ${b.notes !== undefined} THEN ${b.notes ?? null} ELSE notes END,
        content    = COALESCE(${b.content !== undefined ? JSON.stringify(b.content) : null}::jsonb, content),
        updated_at = NOW()
      WHERE id = ${b.id}
      RETURNING *
    `;
    if (!rows.length) return fail("Script not found", 404);
    return NextResponse.json({ ok: true, script: rows[0] });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureVideoTables();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) return fail("id is required", 400);
    const sql = getSQL();
    await sql`DELETE FROM video_scripts WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
