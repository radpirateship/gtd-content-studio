import { type NextRequest, NextResponse } from "next/server";
import { gradePost } from "@/lib/post-grader";
import { getSQL } from "@/lib/db";
import { ensureGradeColumns } from "@/lib/ensureGradeColumns";

/**
 * POST /api/workshop/grade
 * Grades one article body against the PPW core-element checklist.
 * When a slug is provided, the score is synced into the revamp backlog so
 * edits made in the Workshop immediately refresh the backlog row.
 */
export async function POST(request: NextRequest) {
  try {
    const { bodyHtml, slug } = await request.json();
    if (!bodyHtml) {
      return NextResponse.json({ error: "bodyHtml is required" }, { status: 400 });
    }
    const grade = gradePost(bodyHtml);

    let backlogSynced = false;
    if (slug) {
      try {
        const sql = getSQL();
        await ensureGradeColumns();
        await sql`
          UPDATE blog_post_tracking
          SET grade_score = ${grade.score},
              grade_failures = ${grade.failures.join(",")},
              collection_links = ${grade.collectionLinkCount},
              voice_score = ${grade.voiceScore},
              graded_at = NOW()
          WHERE slug = ${slug}
        `;
        backlogSynced = true;
      } catch (dbErr) {
        console.error("[workshop/grade] backlog sync failed:", dbErr);
      }
    }

    return NextResponse.json({ ...grade, backlogSynced });
  } catch (error) {
    console.error("[workshop/grade] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Grading failed" },
      { status: 500 }
    );
  }
}
