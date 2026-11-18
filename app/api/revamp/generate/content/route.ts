// Content body generation route — NN Style Guide compliant
// Handles ONLY the body content AI generation (~40-50s)
import { type NextRequest, NextResponse } from "next/server"
import { callAI } from "@/lib/ai"
import { CATEGORY_LABELS } from "@/lib/types"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { buildBrandVoicePrompt } from "@/lib/gtd-brand-voice"

export const maxDuration = 300

// ── Types ────────────────────────────────────────────────────────────────────

interface OutlineSection {
  heading: string
  keyPoints: string[]
  isNew: boolean
}

interface Citation {
  id?: string
  url: string
  title?: string
  notes?: string
}

interface ContentGenerateRequest {
  existingContent: string
  category: string
  keyword: string
  tone?: string
  wordCount?: number
  includeEmailCapture?: boolean
  includeCalculator?: boolean
  calculatorType?: string
  includeComparisonTable?: boolean
  specialInstructions?: string
  titleTag?: string
  approvedOutline: OutlineSection[]
  citations: Citation[]
}

// ── HTML tag balancer ────────────────────────────────────────────────────────
// Detects unclosed block-level tags left by a truncated AI response and
// appends the correct closing tags in proper nesting order.
// Only targets the tags that commonly cause layout destruction when unclosed:
// div, section, ul, ol, li, p, figure, blockquote, details.

const VOID_TAGS = new Set(['br','hr','img','input','link','meta','area','base','col','embed','param','source','track','wbr'])
const BALANCE_TAGS = new Set(['div','section','ul','ol','li','p','figure','blockquote','details','summary','article','nav','aside'])

function balanceHtmlTags(html: string): string {
  const stack: string[] = []
  // Match opening and closing HTML tags
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null

  while ((m = tagRe.exec(html)) !== null) {
    const isClose  = m[1] === '/'
    const tagName  = m[2].toLowerCase()
    const isSelfClose = m[4] === '/' || VOID_TAGS.has(tagName)

    if (!BALANCE_TAGS.has(tagName) || isSelfClose) continue

    if (isClose) {
      // Pop the most recent open of this tag type from the stack
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === tagName) {
          stack.splice(i, 1)
          break
        }
      }
    } else {
      stack.push(tagName)
    }
  }

  if (stack.length === 0) return html

  // Close unclosed tags in reverse (innermost first)
  const tail = stack.reverse().map(t => `</${t}>`).join('')
  const closingCount = stack.length
  console.log(`[balanceHtmlTags] Closed ${closingCount} unclosed tag(s): ${tail}`)
  return html.trimEnd() + '\n' + tail
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimit("revamp-content", { windowMs: 60_000, max: 5 })
    if (!limit.allowed) return rateLimitResponse(limit)

    const body: ContentGenerateRequest = await request.json()

    const {
      existingContent,
      category,
      keyword,
      tone = "educational",
      wordCount = 2500,
      includeComparisonTable = false,
      specialInstructions,
      approvedOutline,
      citations = [],
      titleTag,
    } = body

    const categoryLabel = (CATEGORY_LABELS as Record<string, string>)[category] || category || "Wellness Equipment"
    const articleTone = tone

    // Derive a natural word count from the outline structure rather than using a flat number.
    // Each section gets ~280 words — enough to be substantive without padding.
    // User-supplied wordCount is still respected but clamped to a reasonable range.
    const sectionCount = approvedOutline?.length || 6
    const outlineDerivedTarget = Math.min(3000, Math.max(2000, sectionCount * 280))
    // If the user explicitly set a specific value, use the lower of their preference and outline-derived.
    // This prevents them from accidentally requesting mega-articles but respects their intent to go shorter.
    const targetWordCount = wordCount !== 2500
      ? Math.min(wordCount, 3200)   // user overrode the default — honour it with a hard cap
      : outlineDerivedTarget         // default path: let the outline decide

    // ── Build outline context ─────────────────────────────────────────────

    const outlineContext = approvedOutline?.length
      ? `APPROVED REWRITE OUTLINE (FOLLOW THIS STRUCTURE):\n${approvedOutline
          .map((item) => {
            const tag = item.isNew ? " [NEW SECTION]" : " [FROM ORIGINAL]"
            return `- ${item.heading}${tag}\n  Key points: ${item.keyPoints.join(", ")}`
          })
          .join("\n")}`
      : ""

    // ── Build citation references ─────────────────────────────────────────

    const citationsText = citations.length
      ? citations
          .map(
            (c, i) =>
              `[${i + 1}] ${c.url}${c.title ? ` — ${c.title}` : ""}${c.notes ? `\nNotes: ${c.notes}` : ""}`
          )
          .join("\n")
      : ""

    // ── Conversion element instructions ───────────────────────────────────

    // Email capture (NN 15%-off Klaviyo gate) and supplement calculator removed for GTD.
    const emailCaptureHtml = ""
    const calculatorHtml = ""

    const comparisonInstruction = includeComparisonTable
      ? "\n- If appropriate, include a comparison table using NN grid markup: <div class=\"gtd-grid cols-2\"> or cols-3 with gtd-card items. IMPORTANT: The comparison table must NOT be the last content section — always close every gtd-card and gtd-grid div properly and follow it with at least one more prose section before the article ends."
      : ""

    const specialContext = specialInstructions
      ? `\nSPECIAL INSTRUCTIONS FROM EDITOR:\n${specialInstructions}`
      : ""

    // ══════════════════════════════════════════════════════════════════════════
    // Generate body content
    // ══════════════════════════════════════════════════════════════════════════

    const systemPrompt = `You are a Senior Content Editor at Green Thumb Depot, a premium wellness equipment brand (saunas, cold plunges, red light therapy, massage, hyperbaric, home gym, and recovery equipment). You are rewriting an existing article, not generating from scratch. Your goal is to preserve the author's best insights and unique perspectives while dramatically improving structure, SEO optimization, and conversion elements.

OUTPUT FORMAT — You MUST use NN CSS classes (already defined in the page). Do NOT use inline styles. Do NOT use markdown syntax (**, __, *, _, ##, etc.) — use only HTML tags like <strong>, <em>, <h2>, etc.

STRUCTURE YOU MUST FOLLOW:
1. Start directly with body section content (NO <style>, NO <div class="gtd-wrap">, NO <nav>, NO <h1> — those are added by the template)
2. First section: A "Key Takeaways" box:
   <section class="gtd-section gtd-muted">
   <h2>Key Takeaways</h2>
   <ul><li><strong>Label:</strong> description</li>...</ul>
   </section>
3. Body sections, each wrapped in:
   <section id="SLUG" class="gtd-section">
   <h2>Section Title</h2>
   ...paragraphs, lists, callout boxes...
   </section>
4. Use <div class="gtd-callout"> for important callout blocks
5. Weave citations into the text as linked references: "...research shows that [citation 1] claims that..."
6. Do NOT include any image tags or image placeholders. Images are added separately after content generation.
7. Do NOT include an FAQ section. The FAQ is generated in a separate step.
8. If you include a comparison table, it must NEVER be the last section. Always follow it with a prose wrap-up section.
9. RESEARCH CALLOUT BOXES: For 1-2 of the most important research findings, create a dedicated callout using this structure:
   <div class="gtd-callout" style="background:#faf7f1;border-left-color:#c8a96e;border-left-width:4px;padding:1.5rem;">
   <p style="font-family:Poppins,sans-serif;font-weight:700;font-size:1.1rem;color:#8a6d2f;margin-bottom:0.5rem;">What Research Says</p>
   <p class="gtd-body">[Specific finding from the research with the linked citation]</p>
   </div>
10. INFO BOXES WITH ICONS: For 1-2 key concept explanations (e.g., "How Infrared Heat Works", "What Determines Heat-Up Time", "Safety Facts"), create a rich info box using this structure:
   <div class="gtd-info-box">
   <div class="gtd-info-box-header">
   <div class="gtd-info-box-icon"><span>[relevant emoji like 🧬 or 💪 or 🔬 or ⚡]</span></div>
   <div class="gtd-info-box-title">[Concept Title]</div>
   </div>
   <ul>
   <li>[Key fact or step 1]</li>
   <li>[Key fact or step 2]</li>
   <li>[Key fact or step 3]</li>
   </ul>
   </div>

WRITING GUIDELINES:
- Preserve the original article's strongest points and insights — don't discard what works
- Rewrite for a ${articleTone} tone with genuine expertise
- CONTENT LENGTH: Do NOT shorten the article. Preserve all valuable existing content and expand thin or outdated sections. Cover every outline section completely and in full depth, matching or exceeding the original article's length. There is no target word count and no upper limit. Do NOT pad with repetition or filler — every sentence must add information.
- Each section should be as long as its content requires and complete, never cut off mid-thought. Do not compress sections that were already detailed in the original.
- Dramatically restructure for better SEO: start with the keyword in an early H2, improve logical flow
- Weave provided citations naturally into the text as linked references [1], [2], etc.
- Scannable paragraphs (3-5 sentences)
- Include practical, actionable advice
- Use bullet points and numbered lists where appropriate${comparisonInstruction}
- Do NOT add any <h1> tag
- Section IDs must be lowercase-kebab-case
- Do NOT add any internal links or <a> tags to other articles

${buildBrandVoicePrompt()}

OUTPUT: Return ONLY the section content. No wrapping tags, no <style>, no <html>.`

    const userPrompt = `Rewrite this existing article with significant structural improvements.

TITLE: ${titleTag || keyword}
PRIMARY KEYWORD: ${keyword}
CATEGORY: ${categoryLabel}

${outlineContext}

ORIGINAL ARTICLE:
---
${existingContent}
---

${citationsText ? `CITATIONS TO WEAVE IN:\n${citationsText}` : ""}

${specialContext}

Requirements:
- Preserve the author's best insights and unique perspectives
- Dramatically improve structure, readability, and SEO
- Weave citations into the text naturally as linked references
- Do NOT include any image tags or image placeholders
- Do NOT include an FAQ section (it is generated separately)
- Key Takeaways section first using gtd-muted class
- All sections use gtd-section class with kebab-case IDs`

    // Token ceiling: NN articles use HTML-heavy callout boxes, info boxes, and structured sections.
    // Plain text is ~0.75 words/token; with NN HTML markup the effective ratio is ~0.5 words/token.
    // Use 1.5× multiplier over the raw word-count → token conversion for that overhead.
    // Floor of 5000 ensures even short articles have room to close all tags cleanly.
    // Hard ceiling of 7000 keeps generation time within the Vercel function timeout.
    console.log(`[revamp/content] Target: ${targetWordCount} words (${sectionCount} sections, outline-derived). maxTokens computed from that.`)
    // Generous cap so a long article is never truncated (shortened) on revamp.
    const maxTokens = 8000
    const bodyContent = await callAI(systemPrompt, userPrompt, { maxTokens, timeoutMs: 220_000, retryOnTimeout: false })
    console.log("[revamp/content] Body content received, length:", bodyContent.length)

    // Clean up any stray markdown syntax or leaked image placeholders
    let cleanedBodyContent = bodyContent
      .replace(/<img[^>]*src="?\[IMAGE_PLACEHOLDER_\d+\]"?[^>]*\/?>/gi, "")
      .replace(/\[IMAGE_PLACEHOLDER_\d+\]/g, "")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<em>$1</em>")
      .replace(/(?<!=")#{2,6}\s+(.+)/g, "<h2>$1</h2>")
      .replace(/^\s*[-*]\s+/gm, "• ")

    // ── HTML tag balancer ──────────────────────────────────────────────────
    // If the AI was truncated mid-callout or mid-section, unclosed block tags
    // will cause everything inserted afterwards (FAQ, products, author bio) to
    // render visually inside that element. Close any orphaned tags now.
    cleanedBodyContent = balanceHtmlTags(cleanedBodyContent)

    // Strip any FAQ content the main generation may have included
    const faqFullSectionRegex = /<section\s[^>]*id=["']faq["'][^>]*>[\s\S]*?<\/section>/gi
    const faqPartialSectionRegex = /<section\s[^>]*id=["']faq["'][^>]*>[\s\S]*/gi
    const faqHeadingRegex = /<h2[^>]*>\s*Frequently Asked Questions\s*<\/h2>[\s\S]*/gi

    if (faqFullSectionRegex.test(cleanedBodyContent)) {
      cleanedBodyContent = cleanedBodyContent.replace(faqFullSectionRegex, "")
      console.log("[revamp/content] Stripped complete FAQ section from body content")
    } else if (faqPartialSectionRegex.test(cleanedBodyContent)) {
      cleanedBodyContent = cleanedBodyContent.replace(faqPartialSectionRegex, "")
      console.log("[revamp/content] Stripped partial/truncated FAQ section from body content")
    } else if (faqHeadingRegex.test(cleanedBodyContent)) {
      cleanedBodyContent = cleanedBodyContent.replace(faqHeadingRegex, "")
      console.log("[revamp/content] Stripped stray FAQ heading from body content")
    }

    cleanedBodyContent = cleanedBodyContent.replace(/\s+$/, "")

    // Insert email capture and calculator if requested
    if (emailCaptureHtml || calculatorHtml) {
      const firstSectionEnd = cleanedBodyContent.indexOf("</section>")
      if (firstSectionEnd !== -1) {
        const insertAt = firstSectionEnd + "</section>".length
        const insertContent = emailCaptureHtml + (calculatorHtml || "")
        cleanedBodyContent =
          cleanedBodyContent.slice(0, insertAt) + insertContent + cleanedBodyContent.slice(insertAt)
      }
    }

    return NextResponse.json({ bodyContent: cleanedBodyContent })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate body content"
    const isTimeout = message.toLowerCase().includes('timeout') || message.toLowerCase().includes('timed out')
    const isAIError = message.toLowerCase().includes('api') || message.toLowerCase().includes('model') || message.toLowerCase().includes('token')
    console.error("[revamp/generate/content] Error:", error)
    return NextResponse.json(
      {
        error: isTimeout
          ? "Content generation timed out. Try reducing the target word count or simplifying your outline."
          : isAIError
          ? `AI API error during content generation: ${message}`
          : message,
        step: "content",
      },
      { status: 500 }
    )
  }
}
