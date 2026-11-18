// app/api/bot/keyword-audit/notes/route.ts
//
// POST /api/bot/keyword-audit/notes   (Bearer BOT_API_TOKEN)
//   { notes: [{ slug, note }] }   or   { slug, note }
// Appends a dated review note to the collection's audit row. Notes show in the
// Keyword Audit panel and are passed to Regenerate as operator constraints.
// This is the ONLY write the bot token can make here: it never changes a
// recommendation, a row or Shopify.
import { type NextRequest, NextResponse } from "next/server";
import { botRequestAuthorized } from "@/lib/bot-auth";
import { getSQL } from "@/lib/db";
import { ensureKeywordResearchTable } from "@/lib/keyword-audit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await botRequestAuthorized(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as { notes?: Array<{ slug: string; note: string }>; slug?: string; note?: string; reviewer?: string };
    const items = Array.isArray(body.notes) ? body.notes : body.slug && body.note ? [{ slug: body.slug, note: body.note }] : [];
    if (!items.length) return NextResponse.json({ error: "Provide { notes: [{ slug, note }] }" }, { status: 400 });
    if (items.length > 200) return NextResponse.json({ error: "Max 200 notes per call" }, { status: 400 });
    const sql = getSQL();
    await ensureKeywordResearchTable(sql);
    const who = (body.reviewer || "Grok Bot").slice(0, 40);
    const stamp = new Date().toISOString().slice(0, 10);
    const written: string[] = []; const unknown: string[] = [];
    for (const it of items) {
      const slug = String(it.slug || "").trim(); const note = String(it.note || "").trim().slice(0, 1000);
      if (!slug || !note) continue;
      const res = (await sql`
        UPDATE collection_keyword_research
        SET notes = CASE WHEN notes IS NULL OR notes = '' THEN ${`[${who} ${stamp}] ${note}`} ELSE notes || E'\n' || ${`[${who} ${stamp}] ${note}`} END
        WHERE slug = ${slug} RETURNING slug
      `) as Array<{ slug: string }>;
      if (res.length) written.push(slug); else unknown.push(slug);
    }
    return NextResponse.json({ ok: true, written: written.length, unknown });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "write failed" }, { status: 500 });
  }
}
