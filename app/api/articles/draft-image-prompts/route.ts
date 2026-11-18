import { type NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai";

/**
 * Sections that must never receive a body image. Matches v1 ids, v2 ids
 * (picks, more-picks, faq, keep-reading) and the slug fallback used when a
 * heading carries no id at all.
 */
const NON_CONTENT_SECTION =
  /(^|-)(picks|faq|shop|author|related)(-|$)|key-takeaway|continue-your|featured-product|keep-reading|frequently-asked/i;

/** Belt and braces for headings that have no id to test. */
const NON_CONTENT_HEADING =
  /^(frequently asked questions?|keep reading|shop\b|about the author|more .+ worth a look|.+ to start with)/i;

/**
 * POST /api/articles/draft-image-prompts
 * 
 * The "Technical Illustrator" persona. Reads the article and drafts the
 * image generation prompts: 1 cinematic featured image + N technical graphics.
 * N defaults to 5 and is capped by how many real content sections exist.
 * 
 * Does NOT generate images. Returns prompts for the user to review/edit first.
 */
export async function POST(request: NextRequest) {
  try {
    const { htmlContent, articleTitle, articleKeyword, category, imageCount } = await request.json();

    if (!htmlContent) {
      return NextResponse.json({ error: "htmlContent is required" }, { status: 400 });
    }

    // Extract plain text for analysis
    const plainText = htmlContent
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);

    // Extract H2 section IDs and their text from the article
    // Capture the attribute string first, then pull the id out of it.
    // The previous pattern /<h2[^>]*(?:id="([^"]*)")?[^>]*>/ NEVER captured an
    // id: the leading greedy [^>]* consumed every attribute, the optional group
    // matched empty, and the trailing [^>]* matched empty, so the engine had no
    // reason to backtrack. Every id silently fell through to a slug of the
    // heading text. That is why the storyboard's primary matcher went looking
    // for <h2 ... id="the-real-difference-between-a-cold-shower-and-a-cold-plunge">
    // in an article whose real id is "section-1", missed on every image, and
    // dropped everything to fuzzy label matching.
    const h2Regex = /<h2([^>]*)>([\s\S]*?)<\/h2>/gi;
    const sections: { id: string; text: string }[] = [];
    let h2Match;
    while ((h2Match = h2Regex.exec(htmlContent)) !== null) {
      const attrs = h2Match[1] || '';
      const text = h2Match[2].replace(/<[^>]+>/g, '').trim();
      const idAttr = /\bid=["']([^"']+)["']/i.exec(attrs);
      const id = idAttr
        ? idAttr[1]
        : text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!NON_CONTENT_SECTION.test(id) && !NON_CONTENT_HEADING.test(text)) {
        sections.push({ id, text });
      }
    }

    // One image per section, and the hero takes one of them, so the ceiling is
    // the number of real content sections rather than whatever was requested.
    const technicalCount = Math.max(
      1,
      Math.min(7, Number(imageCount ?? 5), Math.max(1, sections.length - 1))
    );
    const totalConcepts = technicalCount + 1;

    const sectionList = sections.map((s, i) => `  ${i + 1}. id="${s.id}" — "${s.text}"`).join('\n');

    const systemPrompt = `You are an expert Technical Illustrator and Brand Visualist for Peak Primal Wellness.

Your Task: Create ${totalConcepts} distinct image concepts (1 Hero, ${technicalCount} Technical/Educational) based on the article.
Each image MUST be assigned to a specific article section by its H2 id.

Crucial Constraint: Every concept you draft must be designed to fit a strict brand style guide that will be appended to your prompt later. Do NOT include style instructions yourself — the global style suffix will handle that.

For the Featured Image: Describe a clean, high-end cinematic shot. Assign it to the FIRST content section. Focus on professional lighting and the brand color palette (e.g., a navy blue sauna heater in a clean, minimalist wood room). Think magazine cover quality. IMPORTANT: The featured image prompt MUST include this instruction at the end: "Include the article title as large, bold, elegant white text rendered directly within the image — centered near the bottom third, on a dark semi-transparent background strip. The text must be fully legible and part of the image itself, not an overlay."

For Technical Graphics: Describe charts, diagrams, cross-sections, or infographics. Each one MUST be assigned to the section it illustrates — match the image content to the section topic. Explicitly state how to use the brand colors (e.g., 'Use Navy Blue for the main structure outlines, Red arrows to show heat flow, and a clean White background'). Use precise visual vocabulary: "medical illustration," "cross-section diagram," "vector infographic," "isometric engineering view," "cutaway technical drawing."

RULES:
- Each image must go to a DIFFERENT section — never assign two images to the same section id.
- The featured image goes to the first content section.
- Technical images should be spread across different sections.
- AVOID: Generic stock photos of people smiling, relaxing, or exercising. Every image must convey INFORMATION or explain a CONCEPT. Keep text inside images to absolute minimum.

OUTPUT FORMAT: Return ONLY a valid JSON array of exactly ${totalConcepts} objects. No markdown, no code fences, no explanation.
Each object must have:
- "label": Short descriptive label like "Figure 1: Vasoconstriction Mechanism" or "Hero: Cold Immersion Science"
- "prompt": The descriptive core of the image prompt (80-150 words). Do not include style instructions.
- "altText": A descriptive, SEO-friendly alt text (10-20 words) that explains exactly what the image shows. Must be specific to the content, never generic like "Article image". Example: "Cross-section diagram showing cold plunge water circulation with intake and outflow paths"
- "type": Either "featured" or "technical"
- "targetSectionId": The exact H2 id from the list below where this image belongs`;

    const userPrompt = `ARTICLE TITLE: "${articleTitle}"
KEYWORD: "${articleKeyword}"
CATEGORY: "${category}"

AVAILABLE ARTICLE SECTIONS (use these exact ids for targetSectionId):
${sectionList}

ARTICLE CONTENT:
${plainText}

Draft ${totalConcepts} image prompts (1 featured + ${technicalCount} technical). Assign each to a different section from the list above.

FOR THE FEATURED IMAGE PROMPT: You must end the prompt field with this exact sentence (substituting the real title): Include the text "${articleTitle}" as large, bold, elegant white text rendered directly within the image — centered near the bottom third, on a dark semi-transparent background strip. The text must be fully legible and baked into the image itself.`;

    let rawText = await callAI(systemPrompt, userPrompt, { maxTokens: 8000 });

    // Clean markdown fences
    rawText = rawText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();

    let concepts;
    try {
      concepts = JSON.parse(rawText);
    } catch {
      console.error("Failed to parse AI image concepts:", rawText.slice(0, 500));
      return NextResponse.json({ error: "AI returned invalid JSON for image concepts" }, { status: 500 });
    }

    // Normalize into our ImageConcept format with section targeting
    const usedSections = new Set<string>();
    const sectionIds = sections.map(s => s.id);

    const normalizedConcepts = (Array.isArray(concepts) ? concepts : []).map(
      (c: { label: string; prompt: string; type: string; targetSectionId?: string; altText?: string }, i: number) => {
        // Validate targetSectionId — must be from the article's actual sections
        let targetId = c.targetSectionId || '';
        if (!sectionIds.includes(targetId) || usedSections.has(targetId)) {
          // Assign to next unused section
          targetId = sectionIds.find(id => !usedSections.has(id)) || sectionIds[0] || '';
        }
        if (targetId) usedSections.add(targetId);

        // Build descriptive alt text: prefer AI-generated, fall back to label stripped of "Figure N:" prefix
        const rawLabel = (c.label || `Image ${i + 1}`);
        const fallbackAlt = rawLabel.replace(/^(featured|hero|figure\s*\d*)\s*[:–\-]\s*/i, '').trim();

        return {
          id: `img-${Date.now()}-${i}`,
          label: rawLabel,
          prompt: c.prompt || '',
          altText: c.altText || fallbackAlt,
          type: (c.type === 'featured' || c.type === 'hero') ? 'featured' as const : 'technical' as const,
          status: 'draft' as const,
          targetSectionId: targetId,
          placeholderKey: `IMAGE_PLACEHOLDER_${i + 1}`, // legacy compat
        };
      }
    ).filter((c: { prompt: string }) => c.prompt);

    return NextResponse.json({
      concepts: normalizedConcepts,
      count: normalizedConcepts.length,
      success: true,
    });
  } catch (error) {
    console.error("Draft image prompts error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to draft image prompts" },
      { status: 500 }
    );
  }
}
