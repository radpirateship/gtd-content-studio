import { reportError } from "@/lib/reportError";
// FAQ generation route — NN Style Guide compliant
// Handles ONLY the FAQ generation (~15-20s)
import { type NextRequest, NextResponse } from "next/server"
import { callAI } from "@/lib/ai"
import { WRITING_RULES, stripEmDashes } from "@/lib/brandRules"
import { CATEGORY_LABELS } from "@/lib/types"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"

export const maxDuration = 300

// ── Types ────────────────────────────────────────────────────────────────────

interface FaqGenerateRequest {
  keyword: string
  category: string
  titleTag?: string
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimit("revamp-faq", { windowMs: 60_000, max: 5 })
    if (!limit.allowed) return rateLimitResponse(limit)

    const body: FaqGenerateRequest = await request.json()

    const { keyword, category, titleTag } = body

    const categoryLabel = (CATEGORY_LABELS as Record<string, string>)[category] || category || "Wellness Equipment"

    // ══════════════════════════════════════════════════════════════════════════
    // Generate FAQ
    // ══════════════════════════════════════════════════════════════════════════

    console.log("[revamp/faq] Making dedicated FAQ call...")

    const faqSystemPrompt = `You are a Senior Content Editor at Peak Primal Wellness. Generate ONLY an FAQ section for an article. Output ONLY the HTML below — no explanation, no markdown, no wrapping tags.

FORMAT (use this EXACT structure):
<section id="faq" class="ppw-section">
<h2>Frequently Asked Questions</h2>
<div class="ppw-faq-list">
<details class="ppw-faq-item"><summary class="ppw-faq-question">Question?</summary><div class="ppw-faq-answer"><p>Answer paragraph.</p></div></details>
</div>
</section>

RULES:
- Write exactly 8 high-quality questions a reader would actually ask — no more, no less
- Each answer should be 2-3 sentences, informative and specific
- Questions should cover different aspects (sizing/fit, safety, setup, maintenance, results, cost, warranty, comparisons, etc.)
- Do NOT use markdown syntax — HTML only
- Do NOT include any content outside the <section> tags
- Do NOT include comparison tables, product grids, or any ppw-grid / ppw-card markup. This is an FAQ section ONLY.

${WRITING_RULES}`

    const faqUserPrompt = `Write an FAQ section for this revamped article:

TITLE: ${titleTag || keyword}
KEYWORD: ${keyword}
CATEGORY: ${categoryLabel}`

    const faqContent = stripEmDashes(await callAI(faqSystemPrompt, faqUserPrompt, { maxTokens: 2000 }))

    const cleanedFaqContent = faqContent
      .replace(/^```html?\n?/i, "")
      .replace(/\n?```$/i, "")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<em>$1</em>")
      // Strip any comparison table / product grid markup that leaked into FAQ
      .replace(/<div\s+class="ppw-grid[^"]*">[\s\S]*?<\/div>\s*<\/div>/gi, "")
      .replace(/<div\s+class="ppw-card[^"]*">[\s\S]*?<\/div>/gi, "")
      .trim()

    let cleanFaqSection = ""
    const faqItems: { question: string; answer: string }[] = []

    if (cleanedFaqContent.includes('id="faq"') && cleanedFaqContent.includes("ppw-faq-item")) {
      // Sanitize FAQ section
      cleanFaqSection = cleanedFaqContent.replace(
        /(<div class="ppw-faq-answer">)([\s\S]*?)(<\/div>)/gi,
        (_match: string, open: string, body: string, close: string) => {
          const cleanBody = body
            .replace(/<\/section>/gi, "")
            .replace(/<\/article>/gi, "")
            .replace(/<div\s+class="ppw-grid[^"]*">[\s\S]*?<\/div>/gi, "")
            .replace(/<div\s+class="ppw-card[^"]*">[\s\S]*?<\/div>/gi, "")
          return open + cleanBody + close
        }
      )

      // Parse FAQ items for schema
      const questionMatches = Array.from(cleanFaqSection.matchAll(/<summary[^>]*>(.*?)<\/summary>/gi))
      const answerMatches = Array.from(cleanFaqSection.matchAll(/<div class="ppw-faq-answer">([\s\S]*?)<\/div>/gi))
      questionMatches.forEach((qm, i) => {
        const q = qm[1].replace(/<[^>]+>/g, "").trim()
        const a = answerMatches[i] ? answerMatches[i][1].replace(/<[^>]+>/g, "").trim() : ""
        if (q && a) faqItems.push({ question: q, answer: a })
      })

      console.log("[revamp/faq] FAQ section generated successfully, items:", faqItems.length)
    } else {
      console.warn("[revamp/faq] FAQ call returned unexpected format, skipping:", cleanedFaqContent.substring(0, 200))
    }

    return NextResponse.json({
      faqHtml: cleanFaqSection,
      faqItems,
      faqSchema: faqItems.length > 0
        ? JSON.stringify(
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: faqItems.map((f) => ({
                "@type": "Question",
                name: f.question,
                acceptedAnswer: { "@type": "Answer", text: f.answer },
              })),
            },
            null,
            2
          )
        : "",
    })
  } catch (error) {
    reportError(error, { route: "//api/revamp/generate/faq", method: "POST" });
    const message = error instanceof Error ? error.message : "Failed to generate FAQ"
    const isTimeout = message.toLowerCase().includes('timeout') || message.toLowerCase().includes('timed out')
    console.error("[revamp/generate/faq] Error:", error)
    return NextResponse.json(
      {
        error: isTimeout
          ? "FAQ generation timed out. This can happen with long keywords — try again."
          : `FAQ generation failed: ${message}`,
        step: "faq",
      },
      { status: 500 }
    )
  }
}
