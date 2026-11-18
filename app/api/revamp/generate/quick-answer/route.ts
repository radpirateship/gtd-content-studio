import { reportError } from "@/lib/reportError";
// Quick Answer generation route — generates a concise 1-2 sentence answer for the article topic
import { type NextRequest, NextResponse } from "next/server"
import { callAI } from "@/lib/ai"
import { CATEGORY_LABELS } from "@/lib/types"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"

export const maxDuration = 60

interface QuickAnswerRequest {
  title: string
  keyword: string
  category: string
}

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimit("revamp-quick-answer", { windowMs: 60_000, max: 10 })
    if (!limit.allowed) return rateLimitResponse(limit)

    const body: QuickAnswerRequest = await request.json()
    const { title, keyword, category } = body

    if (!keyword) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 })
    }

    const categoryLabel = (CATEGORY_LABELS as Record<string, string>)[category] || category || "Wellness"

    const systemPrompt = `You are a Senior Content Editor at Peak Primal Wellness. Generate ONLY a quick answer summary for a blog article. Output ONLY 1-2 plain-text sentences — no HTML, no markdown, no explanation.

RULES:
- Answer the core question implied by the article title/keyword in 1-2 sentences (max 60 words total)
- Wrap the single most important fact or key term in <strong> tags
- Do NOT include any HTML other than a single <strong>...</strong> tag pair
- Do NOT start with "Quick Answer:", "In short:", or any prefix — go straight to the answer
- Be specific and actionable, not vague`

    const userPrompt = `Write a quick answer for this article:

TITLE: ${title || keyword}
KEYWORD: ${keyword}
CATEGORY: ${categoryLabel}`

    const raw = await callAI(systemPrompt, userPrompt, { maxTokens: 150 })

    const quickAnswer = raw
      .replace(/^```html?\n?/i, "")
      .replace(/\n?```$/i, "")
      .replace(/^(Quick Answer:|In short:|TL;DR:)\s*/i, "")
      .trim()

    console.log("[revamp/quick-answer] Generated:", quickAnswer.substring(0, 100))

    return NextResponse.json({ quickAnswer })
  } catch (error) {
    reportError(error, { route: "//api/revamp/generate/quick-answer", method: "POST" });
    const message = error instanceof Error ? error.message : "Failed to generate quick answer"
    console.error("[revamp/generate/quick-answer] Error:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
