import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { GUIDE_KEYWORDS } from "@/lib/collection-guide-keywords";

/**
 * POST /api/collections/restore-keywords
 *
 * Bulk-resets primary_keyword + secondary_keywords on ppw_collections to the
 * CANONICAL values from the collection guide (lib/collection-guide-keywords.ts,
 * generated from PPW_Complete_Collection_Optimization_6.xlsx). Used to undo
 * the keyword inflation earlier generate runs caused by auto-merging Ahrefs
 * terms. Safe to run repeatedly. Collections not in the guide are untouched.
 */

export const maxDuration = 120;

export async function POST() {
  try {
    const sql = getSQL();
    let updated = 0;
    const notInQueue: string[] = [];
    for (const e of GUIDE_KEYWORDS) {
      // TEXT[] — pass a JS array, never JSON.stringify
      const rows = (await sql`
        UPDATE ppw_collections
        SET primary_keyword = ${e.primary}, secondary_keywords = ${e.secondaries}
        WHERE slug = ${e.slug} RETURNING slug
      `) as Array<{ slug: string }>;
      if (rows.length > 0) updated++;
      else notInQueue.push(e.slug);
    }
    return NextResponse.json({
      ok: true,
      updated,
      guideTotal: GUIDE_KEYWORDS.length,
      notInQueue: notInQueue.slice(0, 30),
      notInQueueCount: notInQueue.length,
    });
  } catch (error) {
    console.error("[collections/restore-keywords] Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "restore failed" }, { status: 500 });
  }
}
