// Finalize route — assembles final article and saves to DB
// Handles subtitle generation, programmatic assembly, and DB save (~10s)
import { type NextRequest, NextResponse } from "next/server"
import { buildArticleDocumentHtml, normalizeArticleBodyHtml } from "@/lib/article-html"
import { callAI } from "@/lib/ai"
import { WRITING_RULES, stripEmDashes } from "@/lib/brandRules"
import { getSQL } from "@/lib/db"
import { getProductRecommendationsFromDB } from "@/lib/product-store"
import { CATEGORY_LABELS } from "@/lib/types"
import { logActivity } from "@/lib/activity-log"
import { randomUUID } from "crypto"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { injectCollectionLinks } from "@/lib/collection-links"
import { listLiveCollectionHandles } from "@/lib/shopify/products-admin"

export const maxDuration = 300

// ── Types ────────────────────────────────────────────────────────────────────

interface FinalizeRequest {
  bodyContent: string
  faqHtml: string
  faqItems: { question: string; answer: string }[]
  faqSchema: string
  keyword: string
  category: string
  titleTag?: string
  metaDescription?: string
  existingHandle?: string
  existingShopifyId?: number
  existingAuthor?: string | null
  revampSourceId?: number
  sourceUrl?: string
  includeProducts?: boolean
  relatedArticles?: { title: string; url: string; description: string }[]
  citations?: { url: string; title?: string; author?: string; notes?: string }[]
  collection?: string
  tone?: string
  wordCount?: number
  videoUrl?: string
  heroImageUrl?: string
  quickAnswer?: string
}

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
// Strategy: extract flavor from product title when available (ideal for showcasing
// flavor variants of the same product). Fall back to brand-attribute labels.
// All badges use Peak Primal Wellness black to stay on-brand.

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
  // No flavor found — use brand attribute fallbacks cycling by index
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

// ── HTML Post-Processor: adds ppw-body/ppw-h2/ppw-h3 classes to plain tags ─────

function postProcessHtml(html: string): string {
  let result = html

  // Add ppw-h2 class to all <h2> tags that don't already have it
  result = result.replace(/<h2(?![^>]*class="[^"]*ppw-h2)([^>]*)>/gi, (match, attrs) => {
    if (attrs.includes('class="')) {
      return match.replace(/class="/, 'class="ppw-h2 ')
    }
    return `<h2 class="ppw-h2"${attrs}>`
  })

  // Add ppw-h3 class to all <h3> tags that don't already have it
  result = result.replace(/<h3(?![^>]*class="[^"]*ppw-h3)([^>]*)>/gi, (match, attrs) => {
    if (attrs.includes('class="')) {
      return match.replace(/class="/, 'class="ppw-h3 ')
    }
    return `<h3 class="ppw-h3"${attrs}>`
  })

  // Add ppw-body class to all <p> tags that don't already have an ppw- class
  // Skip p tags inside product cards, email gates, meta, etc.
  result = result.replace(/<p(?![^>]*class="[^"]*ppw-)([^>]*)>/gi, (match, attrs) => {
    if (attrs.includes('class="')) {
      return match.replace(/class="/, 'class="ppw-body ')
    }
    return `<p class="ppw-body"${attrs}>`
  })

  // Add ppw-h1 class to <h1> tags that don't already have it
  result = result.replace(/<h1(?![^>]*class="[^"]*ppw-h1)([^>]*)>/gi, (match, attrs) => {
    if (attrs.includes('class="')) {
      return match.replace(/class="/, 'class="ppw-h1 ')
    }
    return `<h1 class="ppw-h1"${attrs}>`
  })

  return result
}

// ── Static trust badges HTML (same for every article) ───────────────────────
// Rebuilt Aug 2026. This block previously shipped Naked Nutrition supplement
// badges on every PPW article: Third Party Tested, No Additives, GMO Free,
// Gluten Free, No Artificial Sweeteners, Vegan Options. None of those are true
// of sauna or rehab equipment, and they were injected unconditionally.
// Replaced with claims from the approved list in docs / PPW Content Claims
// Policy. Do not add "free shipping" (conditional on product class) or
// "white-glove delivery" (not offered). HSA/FSA is real but eligibility varies
// by product class, so it is deliberately not in this always-on block.

const TRUST_BADGE_ITEMS: { icon: string; label: string }[] = [
  { icon: "\u2713", label: "Authorized Dealer" },
  { icon: "\u2713", label: "Quality Inspected Before Shipping" },
  { icon: "\u2713", label: "Expert US-Based Support" },
]

const TRUST_BADGES_HTML = `<section class="ppw-section" style="background:#faf7f1;border-radius:8px;padding:2.5rem 2rem;margin:3rem 0;">
<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:2rem;align-items:center;">
${TRUST_BADGE_ITEMS.map(
  (b) =>
    `<div style="text-align:center;min-width:120px;"><div style="width:56px;height:56px;border-radius:50%;background:#09195B;display:flex;align-items:center;justify-content:center;margin:0 auto 0.5rem;"><span style="color:#fff;font-size:1.4rem;">${b.icon}</span></div><span style="font-family:Poppins,sans-serif;font-size:0.8rem;font-weight:700;text-transform:uppercase;color:#09195B;letter-spacing:0.05em;">${b.label}</span></div>`,
).join("\n")}
</div>
</section>`

// ── Build immersive product CTA for #1 recommended product ──────────────────

function buildProductHeroHtml(
  product: {
    title: string
    description?: string
    price?: string
    imageUrl?: string
    url?: string
    handle?: string
    vendor?: string
    tags?: string
  },
  categorySlug = "wellness"
): string {
  const rawUrl = product.handle ? `/products/${product.handle}` : (product.url || "#")
  const productUrl = withBlogUtm(rawUrl, categorySlug)
  const features = extractFeatures(product)

  const imageHtml = product.imageUrl
    ? `<img src="${product.imageUrl}" alt="${product.title}" loading="lazy" />`
    : `<span style="color:rgba(255,255,255,0.3);font-size:3rem;">📦</span>`

  let priceHtml = ""
  if (product.price) {
    const numPrice = parseFloat(product.price)
    if (!isNaN(numPrice) && numPrice > 0) {
      const formatted = numPrice % 1 === 0
        ? numPrice.toLocaleString("en-US")
        : numPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      priceHtml = `<div class="ppw-product-hero-price">$${formatted}</div>`
    }
  }

  const featureBullets = features
    .map((f) => `<li>${f}</li>`)
    .join("\n")

  return `<section class="ppw-product-hero">
<div class="ppw-product-hero-image">${imageHtml}</div>
<div class="ppw-product-hero-content">
<span class="ppw-product-hero-badge">Our Top Pick</span>
<h3>${product.title}</h3>
<div class="ppw-product-hero-stars">★★★★★ <span style="color:rgba(255,255,255,0.6);font-size:0.85rem;">4.8/5</span></div>
<ul class="ppw-product-hero-features">
${featureBullets}
</ul>
${priceHtml}
<a class="ppw-cta" href="${productUrl}">Shop ${getShortName(product.title)}</a>
</div>
</section>`
}

// ── Build customer testimonials section ──────────────────────────────────────

function buildTestimonialsHtml(categoryLabel: string): string {
  // Static testimonials — category-aware messaging
  const testimonials = [
    {
      stars: 5,
      quote: `The quality is unmatched. I've tried dozens of ${categoryLabel.toLowerCase()} products and nothing comes close to Peak Primal Wellness's transparency and purity.`,
      author: "Michael R.",
      verified: true,
    },
    {
      stars: 5,
      quote: "Finally a brand that lists every single ingredient with no proprietary blends. The results speak for themselves — I've seen real gains since switching.",
      author: "Sarah K.",
      verified: true,
    },
    {
      stars: 5,
      quote: "Clean ingredients, fast shipping, and excellent customer service. I recommend Peak Primal Wellness to everyone at my gym.",
      author: "James T.",
      verified: true,
    },
  ]

  const cards = testimonials.map((t) => `<div class="ppw-testimonial-card">
<div class="ppw-testimonial-stars">${"★".repeat(t.stars)}${"☆".repeat(5 - t.stars)}</div>
<p class="ppw-testimonial-quote">"${t.quote}"</p>
<p class="ppw-testimonial-author">${t.author}</p>
${t.verified ? `<p class="ppw-testimonial-verified">✓ Verified Buyer</p>` : ""}
</div>`).join("\n")

  return `<section class="ppw-testimonials">
<h2>What Our Customers Say</h2>
<div class="ppw-testimonials-grid">
${cards}
</div>
</section>`
}

// ── Build video embed section ────────────────────────────────────────────────

function buildVideoEmbedHtml(videoUrl: string, title: string): string {
  if (!videoUrl) return ""

  // Extract YouTube video ID
  let videoId = ""
  const ytMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
  if (ytMatch) {
    videoId = ytMatch[1]
  }

  if (!videoId) {
    // Try Vimeo
    const vimeoMatch = videoUrl.match(/vimeo\.com\/(\d+)/)
    if (vimeoMatch) {
      return `<div class="ppw-video-embed">
<iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="${title}"></iframe>
</div>`
    }
    return "" // Unsupported video URL
  }

  // YouTube embed with VideoObject schema
  return `<div class="ppw-video-embed">
<iframe src="https://www.youtube.com/embed/${videoId}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="${title}"></iframe>
</div>
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: title,
  embedUrl: `https://www.youtube.com/embed/${videoId}`,
  thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
}, null, 2)}
</script>`
}

// ── Build scientific references section from citations ───────────────────────

function buildReferencesHtml(citations: { url: string; title?: string; author?: string; notes?: string }[]): string {
  if (!citations || citations.length === 0) return ""
  const refs = citations.map((c, i) => {
    const titleText = c.title || new URL(c.url).hostname.replace("www.", "")
    const authorText = c.author ? `${c.author}. ` : ""
    return `<li style="margin-bottom:0.75rem;font-size:0.95rem;line-height:1.5;color:#646464;">
<span style="font-weight:700;color:#000000;">[${i + 1}]</span> ${authorText}<a href="${c.url}" class="ppw-links" target="_blank" rel="noopener">${titleText}</a>${c.notes ? ` — <em>${c.notes}</em>` : ""}
</li>`
  })
  return `<section class="ppw-section" style="border-left:4px solid #000000;background:#F5F5F5;padding:2rem;border-radius:0 4px 4px 0;margin:3rem 0;">
<h2 class="ppw-h2" style="font-size:1.6rem;margin-top:0;">Scientific References</h2>
<ol style="padding-left:0;list-style:none;margin:0;">
${refs.join("\n")}
</ol>
</section>`
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimit("revamp-finalize", { windowMs: 60_000, max: 5 })
    if (!limit.allowed) return rateLimitResponse(limit)

    const body: FinalizeRequest = await request.json()

    const {
      bodyContent,
      faqHtml,
      faqItems,
      faqSchema,
      keyword,
      category,
      titleTag,
      metaDescription,
      existingHandle,
      existingShopifyId,
      existingAuthor,
      revampSourceId,
      sourceUrl,
      includeProducts = false,
      relatedArticles,
      collection,
      wordCount = 2500,
    } = body

    const categoryLabel = (CATEGORY_LABELS as Record<string, string>)[category] || category || "Wellness Equipment"
    // The brain stores a live Shopify handle in collection_slug, and 33 of the
    // handles it uses are not app slugs (home-gym-equipment, cardio-machines,
    // walkingpad, brand collections). Falling straight to the label de-slugged
    // "Home Gym Equipment for Every Workout" into a handle that 404s. Trust the
    // stored slug before guessing from the label.
    const collectionSlug = CATEGORY_COLLECTION[category] || category || (collection ? collectionNameToSlug(collection) : "all")
    const readTime = Math.max(5, Math.round((wordCount || 2500) / 250))

    // ── Generate proper title (not raw keyword) ──────────────────────────────
    // If titleTag looks like a real title (has capitals, >30 chars), use it.
    // Otherwise generate one from the keyword.
    const hasProperTitle = titleTag && titleTag !== keyword && /[A-Z]/.test(titleTag) && titleTag.length > 20
    let title = titleTag || keyword
    if (!hasProperTitle) {
      const titlePrompt = `Write a compelling, SEO-optimized article title for the keyword "${keyword}" in the ${categoryLabel} category for Peak Primal Wellness's blog. The title should be engaging, include the keyword naturally, and be under 70 characters. Return ONLY the title text, no quotes or explanation.`
      const generatedTitle = stripEmDashes(await callAI(`You write SEO article titles.\n${WRITING_RULES}`, titlePrompt, { maxTokens: 80 }))
      title = generatedTitle.replace(/^["']|["']$/g, "").trim() || titleTag || keyword
    }

    // ── Generate subtitle + quick answer in parallel ───────────────────────

    const subtitlePrompt = `Write a single compelling subtitle sentence (under 150 chars) for an article titled "${title}" about ${keyword}. Return ONLY the sentence, no quotes.`
    const quickAnswerPrompt = `You are answering a reader's question for Peak Primal Wellness's blog. The article title is "${title}" about ${keyword} in the ${categoryLabel} category.

Write a single, direct 1-2 sentence answer to the implied question. Make the KEY phrase (the actual answer) wrapped in <strong> tags. Keep it under 100 words total. Return ONLY the answer HTML, no explanation.

Example format: "Yes, <strong>an infrared sauna can be used every day</strong> for most healthy adults, though 3 to 4 sessions a week is where most of the benefit shows up."`

    const [subtitle, quickAnswerRaw] = await Promise.all([
      callAI(`You write concise article subtitles.\n${WRITING_RULES}`, subtitlePrompt, { maxTokens: 100 }).then(stripEmDashes),
      body.quickAnswer
        ? Promise.resolve(body.quickAnswer)
        : callAI(`You write direct, expert answers for wellness equipment articles.\n${WRITING_RULES}`, quickAnswerPrompt, { maxTokens: 200 }).then(stripEmDashes),
    ])

    // ── Load products from DB (cold-start safe) ─────────────────────────────

    const products = includeProducts
      ? await getProductRecommendationsFromDB(category, 4)
      : []

    // ══════════════════════════════════════════════════════════════════════════
    // PROGRAMMATIC ASSEMBLY
    // ══════════════════════════════════════════════════════════════════════════

    // Parse section headings for navigation. Generic sequential anchor IDs so
    // Google can't index descriptive "#heading-slug" fragments; nav labels stay descriptive.
    const headingMatches = Array.from(bodyContent.matchAll(/<h2[^>]*(?:id="([^"]*)")?[^>]*>(.*?)<\/h2>/gi))
    const navItems: { id: string; text: string }[] = []
    headingMatches.forEach((match, i) => {
      const text = match[2].replace(/<[^>]+>/g, "").trim()
      if (text) navItems.push({ id: `section-${i + 1}`, text })
    })

    // Rewrite each heading to carry only its generic ID.
    let processedContent = bodyContent
    navItems.forEach((nav) => {
      const escapedText = nav.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const headingRegex = new RegExp(`<h2[^>]*>\\s*${escapedText}\\s*</h2>`, "i")
      processedContent = processedContent.replace(headingRegex, `<h2 id="${nav.id}">${nav.text}</h2>`)
    })

    // ── Overview / Hero section ──────────────────────────────────────────────

    const heroImageHtml = body.heroImageUrl
      ? `<img class="ppw-hero-image" src="${body.heroImageUrl}" alt="${title}" />`
      : `<div class="ppw-hero-placeholder"><!-- HERO_IMAGE: ${keyword} --></div>`

    const overviewHtml = `<section id="overview" class="ppw-section">
<div class="ppw-kicker">${categoryLabel}</div>
<h1>${title}</h1>
<p class="ppw-subtitle">${subtitle.trim()}</p>
<div class="ppw-meta"><span>By Peak Primal Wellness</span><span class="ppw-dot"></span><span>${readTime} min read</span></div>
${heroImageHtml}
</section>`

    // ── Quick Answer box ─────────────────────────────────────────────────────

    const cleanedQuickAnswer = quickAnswerRaw
      .replace(/^["']|["']$/g, "")
      .replace(/```html?\n?/g, "")
      .replace(/```/g, "")
      .trim()

    const quickAnswerHtml = `<div class="ppw-quick-answer">
<div class="ppw-quick-answer-header"><span>⚡</span> Quick Answer</div>
<div class="ppw-quick-answer-text">${cleanedQuickAnswer}</div>
</div>`

    // ── Video embed (if provided) ────────────────────────────────────────────

    const videoHtml = body.videoUrl ? buildVideoEmbedHtml(body.videoUrl, title) : ""

    // ── Featured Products section (deterministic HTML) ───────────────────────
    // Split: immersive hero for #1 product + grid cards for alternatives

    let productHeroHtml = ""
    let productsGridHtml = ""
    if (includeProducts && products.length > 0) {
      // Immersive dark CTA for the top product
      productHeroHtml = buildProductHeroHtml(products[0], category)

      // Grid cards for remaining products (2-4)
      if (products.length > 1) {
        const alternateProducts = products.slice(1, 4)
        const cards = alternateProducts
          .map((p, i) => buildProductCard(p, i + 1, products, category))
          .join("\n")
        productsGridHtml = `\n<section id="featured-products" class="ppw-section">
<h2 class="ppw-center">More ${categoryLabel} Options</h2>
<div class="ppw-grid cols-${Math.min(alternateProducts.length, 3)}">
${cards}
</div>
</section>`
      }
    }

    // Insert product hero after Key Takeaways (first </section>), grid cards after second section
    let bodyWithProducts = processedContent
    if (productHeroHtml) {
      const firstSectionEnd = processedContent.indexOf("</section>")
      if (firstSectionEnd !== -1) {
        const insertAt = firstSectionEnd + "</section>".length
        bodyWithProducts =
          processedContent.slice(0, insertAt) + productHeroHtml + processedContent.slice(insertAt)
      } else {
        bodyWithProducts = productHeroHtml + processedContent
      }
    }

    // ── In-content collection links (standing rule: 1-2 per post) ────────────
    // Tops up to 2 contextual /collections/ links. 2+ already present = no-op.
    const linkInjection = injectCollectionLinks(bodyWithProducts, {
      category: category || "",
      keyword: keyword || "",
      title: titleTag || keyword || "",
      seed: existingHandle || keyword || "",
    })
    bodyWithProducts = linkInjection.html
    if (linkInjection.added.length > 0) {
      console.log(
        "[revamp/finalize] Injected collection links:",
        linkInjection.added.map((a) => `${a.handle} (${a.method})`).join(", ")
      )
    }

    // ── Bottom "Shop The Collection" CTA (was missing from this route) ───────
    // This is the single door the reader-visible Shop button goes through, so
    // the handle is checked against Shopify here rather than trusted. A handle
    // that has been renamed or deleted otherwise generates, publishes and 404s
    // in silence, which is how 29 vertical climber articles shipped pointing at
    // /collections/vertical-climbers. Shopify unreachable means no check, not a
    // failed revamp.
    let ctaCollectionHandle = linkInjection.primaryHandle || collectionSlug || "all"
    if (ctaCollectionHandle !== "all") {
      try {
        const { handles: liveHandles } = await listLiveCollectionHandles()
        if (liveHandles.size && !liveHandles.has(ctaCollectionHandle.toLowerCase())) {
          console.warn(
            `[revamp/finalize] Shop CTA handle "${ctaCollectionHandle}" is not a live collection, falling back to /collections/all`,
          )
          ctaCollectionHandle = "all"
        }
      } catch (e) {
        console.warn("[revamp/finalize] could not validate the Shop CTA handle:", e instanceof Error ? e.message : e)
      }
    }
    const ctaHtml = `\n<section class="ppw-section ppw-center">
<a href="/collections/${ctaCollectionHandle}" class="ppw-cta">Shop The Collection</a>
</section>`

    // ── Related Articles footer ──────────────────────────────────────────────

    const relatedHtml = buildRelatedArticlesHtml(relatedArticles || [])

    // ── Navigation (built from final assembled content) ──────────────────────

    const fullBodyForNav = `${bodyWithProducts}${faqHtml}`
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

    // ── Scientific References section (from citations) ─────────────────────

    // House rule: citations go inline next to the claim they support, not in a
    // bibliography at the foot of the article. buildReferencesHtml is kept for
    // now but is no longer emitted.
    const referencesHtml = ""

    // ══════════════════════════════════════════════════════════════════════════
    // FINAL ASSEMBLY
    // ══════════════════════════════════════════════════════════════════════════

    // Assemble all sections, then post-process to add ppw- classes
    const assembledHtml = `${buildArticleDocumentHtml(`
${navHtml}

${overviewHtml}
${quickAnswerHtml}
${videoHtml}
${bodyWithProducts}
${faqHtml}
${productsGridHtml}
${TRUST_BADGES_HTML}
${ctaHtml}
${referencesHtml}
${relatedHtml}
`)}
${faqSchema.length > 0 ? `\n<script type="application/ld+json">\n${faqSchema}\n</script>` : ""}`

    // Post-process: add ppw-body/ppw-h1/ppw-h2/ppw-h3 classes to all plain tags
    const finalHtml = postProcessHtml(assembledHtml).trim()
    const bodyHtml = normalizeArticleBodyHtml(finalHtml)

    console.log("[revamp/finalize] NN article assembled, total length:", finalHtml.length)

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

    const finalTitleTag = titleTag ?? title
    const finalMetaDescription = metaDescription ?? subtitle.trim().slice(0, 160)

    // Preserve the original Shopify blog (e.g. "supplements") so the publish
    // flow can update the article in place instead of defaulting to "news".
    const shopifyBlogTag = sourceUrl?.match(/\/blogs\/([^/]+)\//)?.[1] ?? null

    const [savedArticle] = await sql`
      INSERT INTO articles (
        title, slug, keyword, category, status,
        html_content, word_count,
        title_tag, meta_description,
        source_type, original_shopify_id, shopify_blog_tag,
        created_at, updated_at
      ) VALUES (
        ${title}, ${slug}, ${keyword}, ${category}, 'draft',
        ${bodyHtml}, ${wordCountActual},
        ${finalTitleTag}, ${finalMetaDescription},
        'revamp', ${existingShopifyId ?? null}, ${shopifyBlogTag},
        NOW(), NOW()
      )
      ON CONFLICT (slug) DO UPDATE SET
        title             = EXCLUDED.title,
        html_content      = EXCLUDED.html_content,
        word_count        = EXCLUDED.word_count,
        title_tag         = EXCLUDED.title_tag,
        meta_description  = EXCLUDED.meta_description,
        source_type       = EXCLUDED.source_type,
        original_shopify_id = EXCLUDED.original_shopify_id,
        shopify_blog_tag  = COALESCE(EXCLUDED.shopify_blog_tag, articles.shopify_blog_tag),
        updated_at        = NOW()
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

    if (existingHandle) {
      await sql`
        UPDATE blog_post_tracking
        SET
          latest_revamp_article_id = ${dbId},
          status = 'revamped',
          last_reviewed_at = NOW(),
          updated_at = NOW()
        WHERE slug = ${existingHandle}
      `
    }

    // ── Build response ───────────────────────────────────────────────────────

    const article = {
      id: randomUUID(),
      dbId,
      title,
      slug,
      titleTag: finalTitleTag,
      metaDescription: finalMetaDescription,
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
      revampSourceId: revampSourceId ?? undefined,
      hasInternalLinks: false,
      hasImages: false,
      linkCount: 0,
      imageCount: 0,
    }

    logActivity("Revamp finalized", {
      category: "revamp",
      detail: titleTag || "Unknown",
    });

    // ── Workshop module drafts ────────────────────────────────────────────
    // Return structured draft data for each module so the Section Workshop
    // can let the user refine each section independently.
    const moduleDrafts = {
      products: {
        selectedProducts: products.map((p) => ({
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
      },
      faq: {
        items: faqItems || [],
        faqHtml: faqHtml || "",
        faqSchema: faqSchema || "",
      },
      email: {
        placement: "mid-article" as const,
        headline: "Get Expert Wellness Tips",
        description: "Join thousands of health-conscious readers. Get evidence-based wellness and recovery advice, exclusive deals, and new product launches delivered to your inbox.",
        ctaText: "Subscribe Free",
      },
      testimonials: {
        testimonials: [
          { id: "t1", stars: 5, quote: `The quality is unmatched. I've tried dozens of ${categoryLabel.toLowerCase()} products and nothing comes close to Peak Primal Wellness's transparency and purity.`, author: "Michael R.", verified: true },
          { id: "t2", stars: 5, quote: "Finally a brand that lists every single ingredient with no proprietary blends. The results speak for themselves.", author: "Sarah K.", verified: true },
          { id: "t3", stars: 5, quote: "Clean ingredients, fast shipping, and excellent customer service. I recommend Peak Primal Wellness to everyone at my gym.", author: "James T.", verified: true },
        ],
      },
    }

    return NextResponse.json({ article, moduleDrafts })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to finalize article"
    const isDBError = message.toLowerCase().includes('database') || message.toLowerCase().includes('sql') || message.toLowerCase().includes('insert') || message.toLowerCase().includes('unique')
    console.error("[revamp/generate/finalize] Error:", error)
    logActivity("Revamp finalization failed", {
      category: "revamp",
      status: "error",
      detail: message,
    });
    return NextResponse.json(
      {
        error: isDBError
          ? `Database error during final save: ${message}. The article was generated but could not be saved.`
          : `Final assembly failed: ${message}`,
        step: "polishing",
      },
      { status: 500 }
    )
  }
}
