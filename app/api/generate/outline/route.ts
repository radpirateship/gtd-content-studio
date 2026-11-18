// Outline generation route — uses lib/ai.ts callAI helper
// Updated: 2026-02-19 — force Turbopack recompile
import { type NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { title, keyword, category } = await request.json();

    const systemPrompt = `You are an expert SEO content strategist for Green Thumb Depot, specializing in wellness equipment content. Create detailed, SEO-optimized article outlines that will rank well and provide genuine value to readers interested in ${category}.`;

    const userPrompt = `Create a detailed article outline for the following:

Title: ${title}
Primary Keyword: ${keyword}
Category: ${category}

Generate a comprehensive outline with:
1. A compelling introduction hook
2. 5-7 main sections (H2 headings) with:
   - SEO-friendly heading text
   - 2-3 key points to cover in each section
   - Suggested H3 subheadings where appropriate
3. A FAQ section with 4-5 relevant questions
4. A conclusion with call-to-action

Return the outline as a JSON object with this structure:
{
  "introduction": "Brief description of the intro approach",
  "sections": [
    {
      "heading": "H2 heading text",
      "keyPoints": ["point 1", "point 2", "point 3"],
      "subheadings": ["H3 subheading 1", "H3 subheading 2"]
    }
  ],
  "faq": [
    {"question": "Question text?", "briefAnswer": "Key points for answer"}
  ],
  "conclusion": "Brief description of conclusion approach",
  "suggestedKeywords": ["keyword1", "keyword2", "keyword3"]
}

Return ONLY the JSON object, no additional text.`;

    console.log("[v0] Outline route: calling callAI...");
    const outlineText = await callAI(systemPrompt, userPrompt, { maxTokens: 2000 });
    console.log("[v0] Outline route: callAI returned successfully");

    try {
      const cleaned = outlineText.replace(/\`\`\`json\\n?/g, '').replace(/\`\`\`\\n?/g, '').trim();
      const outline = JSON.parse(cleaned);
      return NextResponse.json({ outline });
    } catch {
      return NextResponse.json({ outline: outlineText });
    }
  } catch (error) {
    console.error("[v0] Outline generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate outline" },
      { status: 500 }
    );
  }
}
