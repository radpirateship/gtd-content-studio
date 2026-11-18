import { type NextRequest, NextResponse } from "next/server";
import { callAIFull } from "@/lib/ai";
import { getSQL } from "@/lib/db";
import { logActivity } from "@/lib/activity-log";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/reportError";

export async function POST(request: NextRequest) {
  // Rate limit: 5 revamp analyses per minute
  const limit = rateLimit("revamp-analyze", { windowMs: 60_000, max: 5 });
  if (!limit.allowed) return rateLimitResponse(limit);

  try {
    const {
      existingContent,
      citations,
      category,
      keyword,
      existingHandle,
      existingShopifyId,
      existingTitle,
      sourceUrl,
      originalPublishedAt,
      trackingStatus,
      revampReason,
    } = await request.json();

    const citationsText = citations?.length
      ? citations.map((c: { url: string; title?: string; notes?: string }, i: number) =>
          `[${i + 1}] ${c.url}${c.title ? ` — ${c.title}` : ''}${c.notes ? `\nNotes: ${c.notes}` : ''}`
        ).join('\n')
      : 'No citations provided.';

    const systemPrompt = `You are a content strategist for Peak Primal Wellness (peakprimalwellness.com), a premium wellness equipment brand (saunas, cold plunges, red light therapy, and recovery equipment). You are analyzing an existing blog article to plan a comprehensive rewrite. Your goal is to identify what's strong, what's missing, and create a restructuring plan that will improve SEO, readability, and conversion.`;

    const userPrompt = `Analyze this existing article for a comprehensive rewrite.

CATEGORY: ${category}
PRIMARY KEYWORD: ${keyword}

EXISTING ARTICLE CONTENT:
---
${existingContent}
---

AVAILABLE CITATIONS/RESEARCH:
${citationsText}

Analyze the article and return a JSON object with this exact structure:
{
  "currentWordCount": <number>,
  "currentHeadings": ["list of existing H2/H3 headings"],
  "readabilityNotes": "Brief assessment of current readability and tone",
  "existingTopics": ["list of topics/claims currently covered"],
  "missingElements": ["list of things the article is missing — e.g., 'No FAQ section', 'No product recommendations', 'No dosage information', 'No internal links', 'Claims lack citations'],
  "citationOpportunities": [
    {
      "claim": "The specific claim in the article that could use a citation",
      "citationId": "The index number of the matching citation from the provided list, or 'none'",
      "suggestion": "How to strengthen this claim with the citation"
    }
  ],
  "suggestedOutline": [
    {
      "heading": "Suggested H2 heading for the rewrite",
      "keyPoints": ["Key points to cover in this section"],
      "isNew": true/false
    }
  ]
}

The suggested outline should:
- Preserve the strongest sections from the original article
- Add missing sections (FAQ, product recommendations, key takeaways)
- Restructure for better SEO (keyword in first H2, logical flow)
- Plan for 5-8 H2 sections
- Include a FAQ section with 4-6 questions

Return ONLY the JSON object, no additional text or markdown fences.`;

    const { text: result, truncated } = await callAIFull(systemPrompt, userPrompt, { maxTokens: 4096 });

    if (truncated) {
      return NextResponse.json(
        { success: false, error: "The article is too long to analyze in one pass — try shortening the content or splitting it into sections." },
        { status: 422 }
      );
    }

    try {
      const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const analysis = JSON.parse(cleaned);
      let revampSourceId: number | null = null;

      if (existingShopifyId || existingHandle) {
        const sql = getSQL();
        const latestRows = existingShopifyId
          ? await sql`
              SELECT id, new_article_id
              FROM revamp_sources
              WHERE original_shopify_id = ${existingShopifyId}
              ORDER BY created_at DESC
              LIMIT 1
            `
          : await sql`
              SELECT id, new_article_id
              FROM revamp_sources
              WHERE original_slug = ${existingHandle || null}
              ORDER BY created_at DESC
              LIMIT 1
            `;
        const latest = latestRows[0];

        if (latest && !latest.new_article_id) {
          const updatedRows = await sql`
            UPDATE revamp_sources
            SET
              original_title = ${existingTitle || null},
              original_slug = ${existingHandle || null},
              original_url = ${sourceUrl || null},
              original_published_at = ${originalPublishedAt || null},
              original_content = ${existingContent},
              category = ${category || null},
              keyword = ${keyword || null},
              revamp_reason = ${revampReason || null},
              status = ${trackingStatus || "in-progress"},
              revamp_started_at = COALESCE(revamp_started_at, NOW()),
              updated_at = NOW()
            WHERE id = ${latest.id}
            RETURNING id
          `;
          revampSourceId = updatedRows[0]?.id ?? null;
        } else {
          const insertedRows = await sql`
            INSERT INTO revamp_sources (
              original_shopify_id,
              original_title,
              original_slug,
              original_url,
              original_published_at,
              original_content,
              category,
              keyword,
              revamp_reason,
              status,
              revamp_started_at,
              created_at,
              updated_at
            ) VALUES (
              ${existingShopifyId || null},
              ${existingTitle || null},
              ${existingHandle || null},
              ${sourceUrl || null},
              ${originalPublishedAt || null},
              ${existingContent},
              ${category || null},
              ${keyword || null},
              ${revampReason || null},
              ${trackingStatus || "in-progress"},
              NOW(),
              NOW(),
              NOW()
            )
            RETURNING id
          `;
          revampSourceId = insertedRows[0]?.id ?? null;
        }
      }

      logActivity("Article analyzed", {
        category: "revamp",
        detail: keyword,
      });
      return NextResponse.json({ success: true, analysis, revampSourceId });
    } catch {
      console.error("[revamp/analyze] Failed to parse AI response as JSON");
      logActivity("Article analysis parse failed", {
        category: "revamp",
        status: "warning",
        detail: keyword,
      });
      return NextResponse.json(
        { success: false, error: "AI returned malformed analysis — please retry", rawText: result.slice(0, 500) },
        { status: 422 }
      );
    }
  } catch (error) {
    reportError(error, { route: "//api/revamp/analyze", method: "POST" });
    console.error("[revamp/analyze] Error:", error);
    logActivity("Article analysis failed", {
      category: "revamp",
      status: "error",
      detail: "Analysis failed",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
