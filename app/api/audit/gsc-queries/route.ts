// POST /api/audit/gsc-queries
// Returns raw Search Console rows for query plus page dimensions so the
// audit tooling can compute keyword cannibalization over the full corpus,
// the same signal the ppw-dashboard app computes but without its top-25 cap.
// Cookie-authed like every non-content-brain route (middleware).
//
// Body (all optional): { days: 28, rowLimit: 25000, startRow: 0 }
// Response: { ok, rowCount, startRow, rows: [{ keys: [query, page], clicks, impressions, ctr, position }] }
import { NextResponse } from "next/server";
import { queryGsc } from "@/lib/gsc-client";
import { reportError } from "@/lib/reportError";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body.days) || 28, 1), 480);
    const rowLimit = Math.min(Math.max(Number(body.rowLimit) || 25000, 1), 25000);
    const startRow = Math.max(Number(body.startRow) || 0, 0);

    const { rows } = await queryGsc({ dimensions: ["query", "page"], days, rowLimit, startRow });

    return NextResponse.json({ ok: true, rowCount: rows.length, startRow, days, rows });
  } catch (err) {
    reportError(err, { route: "//api/audit/gsc-queries", method: "POST" });
    console.error("[audit/gsc-queries]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "GSC query failed" },
      { status: 500 }
    );
  }
}
