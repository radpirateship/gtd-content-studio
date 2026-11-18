// Revamp article generation route — NN Style Guide compliant
// Multi-call approach: body content → FAQ → programmatic assembly
// DB-saving, DB-backed product recommendations, uuid-based article IDs
import { type NextRequest } from "next/server"
import { buildArticleDocumentHtml, normalizeArticleBodyHtml } from "@/lib/article-html"
import { callAI } from "@/lib/ai"
import { WRITING_RULES, stripEmDashes } from "@/lib/brandRules"
import { getSQL } from "@/lib/db"
import { getProductRecommendationsFromDB } from "@/lib/product-store"
import { CATEGORY_LABELS } from "@/lib/types"
import { randomUUID } from "crypto"
import { revampGenerateRequestSchema } from "@/lib/api-schemas"
import { getErrorMessage, logRouteEvent, parseAndValidateJson } from "@/lib/api-utils"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { apiSuccess, apiError } from "@/lib/api-response"

// ── SVG icon for external links ──────────────────────────────────────────────

const LINK_SVG = '<svg stroke-linejoin="round" stroke-linecap="round" stroke-width="2" stroke="currentColor" fill="none" viewBox="0 0 24 24" height="16" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>'

// ── Category → Shopify collection slug mapping ──────────────────────────────

const CATEGORY_COLLECTION: Record<string, string> = {
  // PPW collections. Replaced Aug 2026: this map held 19 Naked Nutrition
  // supplement slugs (whey-protein, creatine, bcaa, keto, vegan...), none of
  // which exist on this store, so every lookup missed and product links were
  // tagged with the wrong collection. Mirrors the map in app/api/generate.
  "sensory-deprivation-tanks": "sensory-deprivation-tanks",
  saunas: "saunas",
  "barrel-saunas": "barrel-saunas",
  "infrared-saunas": "infrared-saunas",
  "outdoor-saunas": "outdoor-saunas",
  "traditional-saunas": "traditional-saunas",
  "hybrid-saunas": "hybrid-saunas",
  "sauna-heaters": "sauna-heaters",
  "sauna-accessories": "sauna-accessories",
  "cold-plunge": "cold-plunge",
  "red-light-therapy": "red-light-therapy",
  "hyperbaric-chambers": "hyperbaric-chambers",
  "hydrogen-water": "hydrogen-water",
  "water-ionizers": "water-ionizers",
  "air-purifiers": "air-purifiers",
  "massage-equipment": "massage-equipment",
  steam: "steam",
  "elliptical-machines": "elliptical-machines",
  "exercise-bikes": "exercise-bikes",
  treadmills: "treadmills",
  "stair-climbers": "stair-climbers",
  "vertical-climbers": "vertical-climbers",
  pilates: "pilates",
  "clinical-equipment": "clinical-equipment",
  "general-wellness": "all",
}

function collectionNameToSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
}

// ── Badge config for product cards ───────────────────────────────────────────
// Flavor-first: use the product's flavor as the badge when detectable (ideal for
// flavor variant showcases). Fall back to NN brand attribute labels.
// All badges use NN black — no price-based color coding.

const PPW_BADGE_COLOR = "#0066cc"

// PPW NOTE (Aug 2026): flavour detection is Naked Nutrition logic. On PPW
// titles it produces false badges, e.g. a cherry-wood sauna badged "Cherry" or
// a red light panel badged "Orange". Emptied so extractFlavorBadge always
// returns null and the honest fallback below is used instead.
// Replacement worth building: badge from the product metafields the filter
// module already populates (capacity, heat_type, wood_type, emf_level).
const FLAVOR_KEYWORDS: { pattern: RegExp; label: string }[] = []

// Fallback badge. Must be true of every product PPW sells. The previous list
// ("Third-Party Tested", "No Additives", "Fan Favorite", "Clean Formula") was
// supplement copy and made unverifiable claims about equipment.
const BRAND_FALLBACK_BADGES = ["Authorized Dealer"]


function extractFlavorBadge(title: string): string | null {
  for (const { pattern, label } of FLAVOR_KEYWORDS) {
    if (pattern.test(title)) return label
  }
  return null
}

function assignBadge(products: { title?: string; price?: string }[], index: number): { label: string; color: string } {
  const product = products[index]
  const flavor = product?.title ? extractFlavorBadge(product.title) : null
  if (flavor) return { label: flavor, color: PPW_BADGE_COLOR }
  const fallback = BRAND_FALLBACK_BADGES[index % BRAND_FALLBACK_BADGES.length]
  return { label: fallback, color: PPW_BADGE_COLOR }
}

// ── Extract short product name for CTA button ────────────────────────────────

function getShortName(title: string): string {
  const cleaned = title
    .replace(/^(saunalife|golden designs|auroom|dynamic|medical breakthrough|oxyrevo|chattanooga|airex|sportsart|game ready)\s+/i, "")
    .replace(/\s+(ultra|pro|elite)\s*$/i, "")
    .trim()
  const words = cleaned.split(/\s+/).slice(0, 3)
  return words.join(" ") || title.split(/\s+/).slice(0, 2).join(" ")
}

// ── Extract feature bullets from product data ────────────────────────────────

function extractFeatures(product: {
  title: string
  description?: string
  tags?: string
  vendor?: string
  bullets?: string[]
}): string[] {
  // Prefer curated bullets stored in the product catalog.
  if (product.bullets && product.bullets.length > 0) return product.bullets.slice(0, 4)

  const features: string[] = []
  // Two-tier matching: ingredient patterns on title+tags only, property/cert
  // patterns on full text. Prevents descriptions like "better than BCAAs" from
  // adding a BCAA bullet to a creatine product card.
  const titleAndTags = `${product.title || ""} ${product.tags || ""}`.toLowerCase()
  const fullText = `${product.title || ""} ${product.description || ""} ${product.tags || ""}`.toLowerCase()

  // PPW spec patterns. Replaced Aug 2026: these were supplement ingredient
  // matchers (whey, casein, BCAA, creatine, collagen, probiotics) that could
  // never match equipment, plus property matchers (Non-GMO, vegan, keto,
  // grass-fed) that would have been false claims if they ever did.
  const ingredientPatterns: [RegExp, string][] = [
    [/infrared|far[\s-]?infrared|full[\s-]?spectrum/i, "Infrared Heat"],
    [/traditional|finnish|rock[\s-]?heater/i, "Traditional Heat"],
    [/hybrid/i, "Hybrid Heat"],
    [/cedar|hemlock|spruce|aspen|thermowood|basswood/i, "Solid Wood Construction"],
    [/chiller|cooling[\s-]?system/i, "Integrated Chiller"],
    [/ozone|filtration|uv[\s-]?steriliz/i, "Water Filtration"],
    [/\bata\b|pressuriz/i, "Pressurized Chamber"],
    [/red[\s-]?light|660 ?nm|850 ?nm/i, "Red and Near-Infrared"],
  ]

  const propertyPatterns: [RegExp, string][] = [
    [/low[\s-]?emf|ultra[\s-]?low[\s-]?emf|near[\s-]?zero[\s-]?emf/i, "Low EMF"],
    [/etl|ul[\s-]?listed|csa/i, "Safety Certified"],
    [/indoor[\s-]?outdoor|weather[\s-]?rated/i, "Indoor or Outdoor"],
    [/assembl|tool[\s-]?free/i, "Assembly Required"],
    [/warranty/i, "Manufacturer Warranty"],
  ]

  for (const [pattern, label] of ingredientPatterns) {
    if (features.length >= 3) break
    if (pattern.test(titleAndTags) && !features.includes(label)) features.push(label)
  }

  for (const [pattern, label] of propertyPatterns) {
    if (features.length >= 3) break
    if (pattern.test(fullText) && !features.includes(label)) features.push(label)
  }

  const genericFeatures = ["No Artificial Additives", "Made in the USA", "Quality Verified"]
  for (const gf of genericFeatures) {
    if (features.length >= 3) break
    if (!features.includes(gf)) features.push(gf)
  }

  return features.slice(0, 3)
}

// ── Build NN product card HTML ───────────────────────────────────────────────

function withBlogUtm(url: string, categorySlug: string): string {
  if (!url || url === "#") return url
  const slug = categorySlug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}utm_source=blog&utm_medium=article&utm_campaign=${slug}&utm_content=product_embed`
}

function buildProductCard(
  product: {
    title: string
    description?: string
    price?: string
    imageUrl?: string
    url?: string
    handle?: string
    vendor?: string
    tags?: string
    bullets?: string[]
  },
  index: number,
  allProducts: { price?: string }[],
  categorySlug = "wellness"
): string {
  const badge = assignBadge(allProducts, index)
  const rawUrl = product.handle ? `/products/${product.handle}` : (product.url || "#")
  const productUrl = withBlogUtm(rawUrl, categorySlug)
  const shortName = getShortName(product.title)
  const features = extractFeatures(product)

  const imageHtml = product.imageUrl
    ? `<div class="ppw-product-image-container"><img src="${product.imageUrl}" alt="${product.title}" class="ppw-product-image" loading="lazy" /></div>`
    : ""

  let priceHtml = ""
  if (product.price) {
    const numPrice = parseFloat(product.price)
    if (!isNaN(numPrice) && numPrice > 0) {
      const formatted = numPrice % 1 === 0
        ? numPrice.toLocaleString("en-US")
        : numPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      priceHtml = `<p style="font-weight:800;font-size:1.6rem;color:${badge.color};margin:0.5rem 0;">$${formatted}</p>`
    }
  }

  const featureBullets = features
    .map((f, i) => (i === 0 ? `<li>✓ <strong>${f}</strong></li>` : `<li>✓ ${f}</li>`))
    .join("\n")

  return `<div class="ppw-product-card" style="border-color:${badge.color};">
<span class="ppw-badge" style="background:${badge.color};align-self:flex-start;margin-bottom:1rem;">${badge.label}</span>
${imageHtml}
<h3>${product.title}</h3>
${priceHtml}
<ul>
${featureBullets}
</ul>
<div style="margin-top:auto;"><a class="ppw-cta" href="${productUrl}">View ${shortName}</a></div>
</div>`
}

// ── Build related articles footer ────────────────────────────────────────────

function buildRelatedArticlesHtml(articles: { title: string; url: string; description: string }[]): string {
  if (!articles || articles.length === 0) return ""
  const cards = articles.slice(0, 3).map((a) =>
    `<article class="ppw-card">
<h3 class="ppw-card-title"><a href="${a.url}" class="ppw-links">${a.title} ${LINK_SVG}</a></h3>
<p class="ppw-sm">${a.description}</p>
</article>`
  ).join("\n")

  return `<section class="ppw-section">
<h2>Continue Your Wellness Journey</h2>
<div class="ppw-grid cols-3">
${cards}
</div>
</section>`
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Rate limit: 3 full revamp generations per minute
  const limit = rateLimit("revamp-generate", { windowMs: 60_000, max: 3 })
  if (!limit.allowed) return rateLimitResponse(limit)

  const startedAt = Date.now()
  try {
    const parsed = await parseAndValidateJson(request, revampGenerateRequestSchema)
    if (!parsed.success) {
      logRouteEvent("Revamp generate validation failed", {
        category: "revamp",
        status: "warning",
        detail: "Invalid request body",
      })
      return parsed.response
    }

    const body = parsed.data

    const {
      existingContent,
      existingShopifyId,
      existingHandle,
      category,
      keyword,
      tone = "educational",
      wordCount = 2500,
      includeProducts = true,
      includeFAQ = true,
      includeEmailCapture = true,
      includeCalculator = false,
      calculatorType,
      includeComparisonTable = false,
      specialInstructions,
      approvedOutline = [],
      citations = [],
      revampSourceId,
      sourceUrl,
      collection,
      relatedArticles,
    } = body

    logRouteEvent("Revamp generate request received", {
      category: "revamp",
      detail: body.titleTag || keyword,
      metadata: {
        category,
        keyword,
        wordCount,
        includeProducts,
        includeFAQ,
        citationCount: citations.length,
        approvedOutlineCount: approvedOutline.length,
      },
    })

    const categoryLabel = (CATEGORY_LABELS as Record<string, string>)[category] || category || "Wellness"
    // The brain stores a live Shopify handle in collection_slug, and 33 of the
    // handles it uses are not app slugs (home-gym-equipment, cardio-machines,
    // walkingpad, brand collections). Falling straight to the label de-slugged
    // "Home Gym Equipment for Every Workout" into a handle that 404s. Trust the
    // stored slug before guessing from the label.
    const collectionSlug = CATEGORY_COLLECTION[category] || category || (collection ? collectionNameToSlug(collection) : "all")
    const targetWordCount = wordCount
    const articleTone = tone
    const readTime = Math.max(5, Math.round(targetWordCount / 250))

    // ── 1. Load products from DB (cold-start safe) ──────────────────────────

    const products = includeProducts
      ? await getProductRecommendationsFromDB(category, 4)
      : []

    // ── 2. Build outline context ─────────────────────────────────────────────

    const outlineContext = approvedOutline?.length
      ? `APPROVED REWRITE OUTLINE (FOLLOW THIS STRUCTURE):\n${approvedOutline
          .map((item) => {
            const tag = item.isNew ? " [NEW SECTION]" : " [FROM ORIGINAL]"
            return `- ${item.heading}${tag}\n  Key points: ${(item.keyPoints || []).join(", ")}`
          })
          .join("\n")}`
      : ""

    // ── 3. Build citation references ─────────────────────────────────────────

    const citationsText = citations.length
      ? citations
          .map(
            (c, i) =>
              `[${i + 1}] ${c.url}${c.title ? ` — ${c.title}` : ""}${c.notes ? `\nNotes: ${c.notes}` : ""}`
          )
          .join("\n")
      : ""

    // ── 4. Conversion element instructions ───────────────────────────────────

    const emailCaptureHtml = "" // NN email-gate removed for PPW (no 15%-off model)

    const calculatorHtml = "" // NN supplement calculator removed for PPW

    const comparisonInstruction = includeComparisonTable
      ? "\n- If appropriate, include a comparison table using PPW grid markup: <div class=\"ppw-grid cols-2\"> or cols-3 with ppw-card items. IMPORTANT: The comparison table must NOT be the last content section — always close every ppw-card and ppw-grid div properly and follow it with at least one more prose section before the article ends."
      : ""

    const specialContext = specialInstructions
      ? `\nSPECIAL INSTRUCTIONS FROM EDITOR:\n${specialInstructions}`
      : ""

    // ══════════════════════════════════════════════════════════════════════════
    // CALL 1: Generate body content (NO FAQ, NO images, NO product cards)
    // ══════════════════════════════════════════════════════════════════════════

    const systemPrompt = `You are a Senior Content Editor at Peak Primal Wellness, a premium wellness equipment brand (infrared saunas, cold plunges, red light therapy, hyperbaric chambers, and recovery equipment). You are rewriting an existing article, not generating from scratch. Your goal is to preserve the author's best insights and unique perspectives while dramatically improving structure, SEO optimization, and conversion elements.

OUTPUT FORMAT — You MUST use PPW CSS classes (already defined in the page). Do NOT use inline styles. Do NOT use markdown syntax (**, __, *, _, ##, etc.) — use only HTML tags like <strong>, <em>, <h2>, etc.

STRUCTURE YOU MUST FOLLOW:
1. Start directly with body section content (NO <style>, NO <div class="ppw-wrap">, NO <nav>, NO <h1> — those are added by the template)
2. First section: A "Key Takeaways" box:
   <section class="ppw-section ppw-muted">
   <h2>Key Takeaways</h2>
   <ul><li><strong>Label:</strong> description</li>...</ul>
   </section>
3. Body sections, each wrapped in:
   <section id="SLUG" class="ppw-section">
   <h2>Section Title</h2>
   ...paragraphs, lists, callout boxes...
   </section>
4. Use <div class="ppw-callout"> for important callout blocks
5. Weave citations into the text as linked references: "...research shows that [citation 1] claims that..."
6. Do NOT include any image tags or image placeholders. Images are added separately after content generation.
7. Do NOT include an FAQ section. The FAQ is generated in a separate step.
8. If you include a comparison table, it must NEVER be the last section. Always follow it with a prose wrap-up section.

WRITING GUIDELINES:
- Preserve the original article's strongest points and insights — don't discard what works
- Rewrite for a ${articleTone} tone with genuine expertise
- LENGTH: Do NOT shorten the article. Preserve all the original's substance and expand thin or outdated sections where it improves quality. The rewrite should be at least as long as the original — never cut valuable content to hit a number. There is no target word count or upper limit.
- Dramatically restructure for better SEO: start with the keyword in an early H2, improve logical flow
- Weave provided citations naturally into the text as linked references [1], [2], etc.
- Scannable paragraphs (3-5 sentences)
- Include practical, actionable advice
- Use bullet points and numbered lists where appropriate${comparisonInstruction}
- Do NOT add any <h1> tag
- Section IDs must be lowercase-kebab-case
- Do NOT add any internal links or <a> tags to other articles

${WRITING_RULES}

OUTPUT: Return ONLY the section content. No wrapping tags, no <style>, no <html>.`

    const userPrompt = `Rewrite this existing article with significant structural improvements.

TITLE: ${body.titleTag || keyword}
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
- Key Takeaways section first using ppw-muted class
- All sections use ppw-section class with kebab-case IDs`

    console.log("[revamp] Generate: calling AI for PPW body content rewrite...")
    // Generous cap so a long article is never truncated (i.e. shortened) during
    // a revamp. We don't shorten existing content, so don't bound output by the
    // target word count.
    const maxTokens = 8000
    const bodyContent = stripEmDashes(await callAI(systemPrompt, userPrompt, { maxTokens, timeoutMs: 220_000, retryOnTimeout: false }))
    console.log("[revamp] Generate: body content received, length:", bodyContent.length)

    // Clean up any stray markdown syntax or leaked image placeholders
    let cleanedBodyContent = bodyContent
      .replace(/<img[^>]*src="?\[IMAGE_PLACEHOLDER_\d+\]"?[^>]*\/?>/gi, "")
      .replace(/\[IMAGE_PLACEHOLDER_\d+\]/g, "")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<em>$1</em>")
      .replace(/(?<!=")#{2,6}\s+(.+)/g, "<h2>$1</h2>")
      .replace(/^\s*[-*]\s+/gm, "• ")

    // Strip any FAQ content the main generation may have included
    const faqFullSectionRegex = /<section\s[^>]*id=["']faq["'][^>]*>[\s\S]*?<\/section>/gi
    const faqPartialSectionRegex = /<section\s[^>]*id=["']faq["'][^>]*>[\s\S]*/gi
    const faqHeadingRegex = /<h2[^>]*>\s*Frequently Asked Questions\s*<\/h2>[\s\S]*/gi

    if (faqFullSectionRegex.test(cleanedBodyContent)) {
      cleanedBodyContent = cleanedBodyContent.replace(faqFullSectionRegex, "")
      console.log("[revamp] Generate: Stripped complete FAQ section from body content")
    } else if (faqPartialSectionRegex.test(cleanedBodyContent)) {
      cleanedBodyContent = cleanedBodyContent.replace(faqPartialSectionRegex, "")
      console.log("[revamp] Generate: Stripped partial/truncated FAQ section from body content")
    } else if (faqHeadingRegex.test(cleanedBodyContent)) {
      cleanedBodyContent = cleanedBodyContent.replace(faqHeadingRegex, "")
      console.log("[revamp] Generate: Stripped stray FAQ heading from body content")
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

    // ══════════════════════════════════════════════════════════════════════════
    // CALL 2: Generate FAQ separately (reliable structure every time)
    // ══════════════════════════════════════════════════════════════════════════

    let cleanFaqSection = ""
    const faqItems: { question: string; answer: string }[] = []

    if (includeFAQ) {
      console.log("[revamp] Generate: Making dedicated FAQ call...")
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
- Questions should cover different aspects (ingredients, safety, dosage, results, cost, certifications, etc.)
- Do NOT use markdown syntax — HTML only
- Do NOT include any content outside the <section> tags
- Do NOT include comparison tables, product grids, or any ppw-grid / ppw-card markup. This is an FAQ section ONLY.`

      const faqUserPrompt = `Write an FAQ section for this revamped article:

TITLE: ${body.titleTag || keyword}
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

        console.log("[revamp] Generate: FAQ section generated and appended successfully")
      } else {
        console.warn("[revamp] Generate: FAQ call returned unexpected format, skipping:", cleanedFaqContent.substring(0, 200))
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CALL 3: Generate subtitle
    // ══════════════════════════════════════════════════════════════════════════

    const title = body.titleTag || keyword
    const subtitlePrompt = `Write a single compelling subtitle sentence (under 150 chars) for an article titled "${title}" about ${keyword}. Return ONLY the sentence, no quotes.`
    const subtitle = await callAI("You write concise article subtitles.", subtitlePrompt, { maxTokens: 100 })

    // ══════════════════════════════════════════════════════════════════════════
    // PROGRAMMATIC ASSEMBLY
    // ══════════════════════════════════════════════════════════════════════════

    // Parse section headings for navigation. Generic sequential anchor IDs so
    // Google can't index descriptive "#heading-slug" fragments; nav labels stay descriptive.
    const headingMatches = Array.from(cleanedBodyContent.matchAll(/<h2[^>]*(?:id="([^"]*)")?[^>]*>(.*?)<\/h2>/gi))
    const navItems: { id: string; text: string }[] = []
    headingMatches.forEach((match, i) => {
      const text = match[2].replace(/<[^>]+>/g, "").trim()
      if (text) navItems.push({ id: `section-${i + 1}`, text })
    })

    // Rewrite each heading to carry only its generic ID.
    let processedContent = cleanedBodyContent
    navItems.forEach((nav) => {
      const escapedText = nav.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const headingRegex = new RegExp(`<h2[^>]*>\\s*${escapedText}\\s*</h2>`, "i")
      processedContent = processedContent.replace(headingRegex, `<h2 id="${nav.id}">${nav.text}</h2>`)
    })

    // ── Overview / Hero section ──────────────────────────────────────────────

    const overviewHtml = `<section id="overview" class="ppw-section">
<div class="ppw-kicker">${categoryLabel}</div>
<h1>${title}</h1>
<p class="ppw-subtitle">${subtitle.trim()}</p>
<div class="ppw-meta"><span>By Peak Primal Wellness</span><span class="ppw-dot"></span><span>${readTime} min read</span></div>
</section>`

    // ── Featured Products section (deterministic HTML) ───────────────────────

    let productsHtml = ""
    if (includeProducts && products.length > 0) {
      const displayProducts = products.slice(0, 4)
      const gridCols = displayProducts.length === 3 ? 3 : 2
      const cards = displayProducts
        .map((p, i) => buildProductCard(p, i, displayProducts, category))
        .join("\n")
      productsHtml = `\n<section id="featured-products" class="ppw-section">
<h2 class="ppw-center">Top ${categoryLabel} Picks</h2>
<p style="margin-bottom:3rem;color:#646464;font-size:1.6rem;" class="ppw-center">Chosen by 1 million+ customers.</p>
<div class="ppw-grid cols-${gridCols}">
${cards}
</div>
</section>`
    }

    // Insert products after Key Takeaways (first </section>)
    let bodyWithProducts = processedContent
    if (productsHtml) {
      const firstSectionEnd = processedContent.indexOf("</section>")
      if (firstSectionEnd !== -1) {
        const insertAt = firstSectionEnd + "</section>".length
        bodyWithProducts =
          processedContent.slice(0, insertAt) + productsHtml + processedContent.slice(insertAt)
      } else {
        bodyWithProducts = productsHtml + processedContent
      }
    }

    // ── Related Articles footer ──────────────────────────────────────────────

    const relatedHtml = buildRelatedArticlesHtml(relatedArticles || [])

    // ── FAQ Schema JSON-LD ───────────────────────────────────────────────────

    const faqSchema = faqItems.length > 0
      ? `\n<script type="application/ld+json">\n${JSON.stringify(
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
        )}\n</script>`
      : ""

    // ── Navigation (built from final assembled content) ──────────────────────

    const fullBodyForNav = `${bodyWithProducts}${cleanFaqSection}`
    const excludeNavPatterns = ["continue-your", "shop", "key-takeaway", "featured-product"]
    const finalH2Regex = /<h2([^>]*)>(.*?)<\/h2>/gi
    const finalNavItems: { id: string; text: string }[] = []
    let navMatch
    while ((navMatch = finalH2Regex.exec(fullBodyForNav)) !== null) {
      const text = navMatch[2].replace(/<[^>]+>/g, "").trim()
      const idMatch = navMatch[1].match(/id="([^"]*)"/)
      const id = idMatch
        ? idMatch[1]
        : text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
      if (!excludeNavPatterns.some((p) => id.includes(p)) && text) {
        finalNavItems.push({ id, text })
      }
    }

    const navLinks = [
      `<a href="#overview">Overview</a>`,
      ...finalNavItems.map((n) => `<a href="#${n.id}">${n.text}</a>`),
    ]
    const navHtml = `<nav class="ppw-topnav" aria-label="Quick navigation">\n${navLinks.join("\n")}\n</nav>`

    // ══════════════════════════════════════════════════════════════════════════
    // FINAL ASSEMBLY
    // ══════════════════════════════════════════════════════════════════════════

    const finalHtml = `${buildArticleDocumentHtml(`
${navHtml}

${overviewHtml}
${bodyWithProducts}
${cleanFaqSection}
${relatedHtml}
`)}
${faqSchema}`.trim()
    const bodyHtml = normalizeArticleBodyHtml(finalHtml)

    console.log("[revamp] Generate: NN article assembled, total length:", finalHtml.length)

    // ── Word count from stripped HTML ────────────────────────────────────────

    const wordCountActual = finalHtml
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .split(/\s+/)
      .filter(Boolean).length

    // ── Generate slug ────────────────────────────────────────────────────────

    const slug =
      existingHandle ??
      keyword
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")

    // ── Save to database ─────────────────────────────────────────────────────

    const sql = getSQL()

    // Preserve the original Shopify blog (e.g. "supplements") so the publish
    // flow can update the article in place instead of defaulting to "news".
    const shopifyBlogTag = sourceUrl?.match(/\/blogs\/([^/]+)\//)?.[1] ?? null

    const [savedArticle] = await sql`
      INSERT INTO articles (
        title, slug, keyword, category, status,
        html_content, word_count,
        source_type, original_shopify_id, shopify_blog_tag,
        created_at, updated_at
      ) VALUES (
        ${title}, ${slug}, ${keyword}, ${category}, 'draft',
        ${bodyHtml}, ${wordCountActual},
        'revamp', ${existingShopifyId ?? null}, ${shopifyBlogTag},
        NOW(), NOW()
      )
      ON CONFLICT (slug) DO UPDATE SET
        title               = EXCLUDED.title,
        html_content        = EXCLUDED.html_content,
        word_count          = EXCLUDED.word_count,
        source_type         = EXCLUDED.source_type,
        original_shopify_id = EXCLUDED.original_shopify_id,
        shopify_blog_tag    = COALESCE(EXCLUDED.shopify_blog_tag, articles.shopify_blog_tag),
        updated_at          = NOW()
      RETURNING id
    `

    const dbId = savedArticle.id

    // Update the revamp_sources row with the article reference if it exists
    if (revampSourceId) {
      await sql`
        UPDATE revamp_sources
        SET
          new_article_id = ${dbId},
          new_title = ${title},
          new_slug = ${slug},
          status = 'completed',
          revamp_completed_at = NOW(),
          updated_at = NOW()
        WHERE id = ${revampSourceId}
      `
    }

    // ── Build response ───────────────────────────────────────────────────────

    const article = {
      id: randomUUID(),
      dbId,
      title,
      slug,
      titleTag: body.titleTag ?? title,
      metaDescription: body.metaDescription ?? subtitle.trim().slice(0, 160),
      content: bodyHtml.replace(/<[^>]+>/g, " ").trim(),
      htmlContent: bodyHtml,
      documentHtml: finalHtml,
      featuredImage: undefined,
      contentImages: [],
      products: products.map((p) => ({
        id: p.id ?? p.handle,
        handle: p.handle,
        title: p.title,
        description: p.description ?? "",
        vendor: p.vendor ?? "Peak Primal Wellness",
        productType: p.productType ?? "",
        tags: p.tags ? (p.tags as string).split(",").map((t: string) => t.trim()) : [],
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        imageUrl: p.imageUrl,
        url: p.url ?? `https://www.peakprimalwellness.com/products/${p.handle}`,
        category,
        isAvailable: true,
      })),
      faqs: faqItems,
      schemaMarkup: faqSchema,
      category,
      keyword,
      wordCount: wordCountActual,
      createdAt: new Date(),
      status: "draft" as const,
      sourceType: "revamp" as const,
      sourceUrl: sourceUrl || undefined,
      shopifyBlogTag: shopifyBlogTag ?? undefined,
      shopifyBlogHandle: shopifyBlogTag ?? undefined,
      originalShopifyId: existingShopifyId,
      hasInternalLinks: false,
      hasImages: false,
      linkCount: 0,
      imageCount: 0,
    }

    logRouteEvent("Revamp generate succeeded", {
      category: "revamp",
      detail: title,
      durationMs: Date.now() - startedAt,
      metadata: {
        dbId,
        category,
        keyword,
        wordCount: wordCountActual,
      },
    })

    return apiSuccess({ article })
  } catch (error) {
    console.error("[revamp/generate] Error:", error)
    logRouteEvent("Revamp generate failed", {
      category: "revamp",
      status: "error",
      detail: "Revamp generation failed",
      durationMs: Date.now() - startedAt,
      metadata: { error: getErrorMessage(error, "Failed to generate revamped content") },
    })
    return apiError(
      error instanceof Error ? error.message : "Failed to generate revamped content",
      500
    )
  }
}
