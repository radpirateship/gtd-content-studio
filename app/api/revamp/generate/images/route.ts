import { reportError } from "@/lib/reportError";
// Image generation route — generates contextual images for article sections
// Runs AFTER content generation, inserts images into the body HTML
import { type NextRequest, NextResponse } from "next/server"
import { callAI } from "@/lib/ai"
import { generateImageWithModel } from "@/lib/imageGeneration"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"

export const maxDuration = 120

// ── Types ────────────────────────────────────────────────────────────────────

interface ImageGenerateRequest {
  bodyContent: string
  keyword: string
  category: string
  titleTag?: string
  maxImages?: number
}

interface ImageStoryboardItem {
  sectionId: string
  description: string
  style: string
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimit("revamp-images", { windowMs: 60_000, max: 3 })
    if (!limit.allowed) return rateLimitResponse(limit)

    const body: ImageGenerateRequest = await request.json()

    const {
      bodyContent,
      keyword,
      category,
      titleTag,
      maxImages = 3,
    } = body

    // Step 1: Ask AI to create an image storyboard from the article content
    console.log("[revamp/images] Creating image storyboard...")

    // Corrected Aug 2026. This prompt described a supplement brand with black
    // backgrounds and #1A90FF / #26D07C accents, none of which are PPW. It came
    // across with the Naked Nutrition feature port and was never rewritten, so
    // every image from this route was off-brand. Palette now matches
    // lib/ppw-image-style.ts and the ppw-blog.css design system.
    const storyboardSystem = `You are an art director for Peak Primal Wellness, a retailer of high-end wellness and recovery equipment: saunas, cold plunges, hyperbaric chambers, red light therapy, home gym and clinical rehab equipment. You create image briefs for article illustrations. The brand aesthetic is clean, modern and technical: white or warm off-white backgrounds, deep navy (#09195B) as the dominant colour, muted gold (#C8A96E) as the accent, and uncluttered professional composition.`

    const storyboardUser = `Analyze this article body and create exactly ${maxImages} image descriptions for contextual illustrations to insert between sections.

ARTICLE KEYWORD: ${keyword}
ARTICLE TITLE: ${titleTag || keyword}
CATEGORY: ${category}

ARTICLE BODY HTML:
${bodyContent.substring(0, 4000)}

Return a JSON array of image objects. Each object must have:
- "sectionId": the id attribute of the <section> AFTER which the image should be inserted
- "description": a detailed image generation prompt (2-3 sentences) for a clean, professional infographic or illustration. NO text overlays. Focus on visual representations of concepts.
- "style": one of "infographic", "diagram", "illustration", "photograph"

Rules:
- Space images evenly through the article — never put 2 images in a row
- First image should go after the 2nd or 3rd section
- Do NOT place images after the Key Takeaways section
- Focus on visually explaining concepts (how things work, comparisons, processes)

Return ONLY the JSON array, no markdown fences.`

    const storyboardRaw = await callAI(storyboardSystem, storyboardUser, { maxTokens: 1500 })

    let storyboard: ImageStoryboardItem[] = []
    try {
      const cleaned = storyboardRaw.replace(/```json?\n?/g, "").replace(/```/g, "").trim()
      storyboard = JSON.parse(cleaned)
      if (!Array.isArray(storyboard)) storyboard = []
    } catch {
      console.warn("[revamp/images] Failed to parse storyboard, skipping images")
      return NextResponse.json({ bodyContent, images: [] })
    }

    console.log(`[revamp/images] Storyboard: ${storyboard.length} images planned`)

    // Step 2: Generate images in parallel (up to maxImages)
    const imageSlots = storyboard.slice(0, maxImages)

    const imagePromises = imageSlots.map(async (slot, i) => {
      const fullPrompt = `Create a clean, professional ${slot.style} for an article about wellness and recovery equipment. Brand colours: deep navy #09195B dominant, muted gold #C8A96E as the accent, dark charcoal #12182B for outlines and labels. Bright blue #0A86CB only for flow or airflow arrows; red #C0392B only for heat or warnings. Modern, minimalist, no text overlays.

${slot.description}

Style: High-quality ${slot.style} on a white (#FFFFFF) or warm off-white (#FAF7F1) background, suitable for a premium equipment retailer. No dark backgrounds, no neon or saturated tech colours. 16:9 aspect ratio.`

      console.log(`[revamp/images] Generating image ${i + 1}/${imageSlots.length}: ${slot.style}`)

      try {
        const result = await generateImageWithModel(fullPrompt, "gemini-3.1-flash-image-preview", {
          aspectRatio: "16:9",
        })

        if (result?.url) {
          return { ...slot, imageUrl: result.url, success: true }
        }
        return { ...slot, imageUrl: "", success: false }
      } catch (error) {
        console.error(`[revamp/images] Image ${i + 1} failed:`, error)
        return { ...slot, imageUrl: "", success: false }
      }
    })

    const imageResults = await Promise.all(imagePromises)
    const successfulImages = imageResults.filter((r) => r.success && r.imageUrl)

    console.log(`[revamp/images] Generated ${successfulImages.length}/${imageSlots.length} images successfully`)

    // Step 3: Insert images into body content
    let updatedContent = bodyContent

    for (const img of successfulImages) {
      const sectionClosePattern = new RegExp(
        `(<section[^>]*id=["']${img.sectionId}["'][^>]*>[\\s\\S]*?</section>)`,
        "i"
      )

      const imageHtml = `\n<figure class="ppw-content-image">
<img src="${img.imageUrl}" alt="${img.description.substring(0, 120)}" loading="lazy" />
</figure>\n`

      const match = updatedContent.match(sectionClosePattern)
      if (match) {
        const insertAt = updatedContent.indexOf(match[0]) + match[0].length
        updatedContent = updatedContent.slice(0, insertAt) + imageHtml + updatedContent.slice(insertAt)
        console.log(`[revamp/images] Inserted image after section: ${img.sectionId}`)
      }
    }

    return NextResponse.json({
      bodyContent: updatedContent,
      images: successfulImages.map((r) => ({
        sectionId: r.sectionId,
        url: r.imageUrl,
        description: r.description,
        style: r.style,
      })),
    })
  } catch (error) {
    reportError(error, { route: "//api/revamp/generate/images", method: "POST" });
    console.error("[revamp/generate/images] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate images" },
      { status: 500 }
    )
  }
}
