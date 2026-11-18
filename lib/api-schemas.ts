import { z } from "zod"

const optionalString = z.string().trim().optional()
const nullableOptionalString = z.string().trim().nullable().optional()
const nullableJsonRecord = z.record(z.string(), z.unknown()).nullable().optional()

/** Valid article statuses — must match ArticleStatus in types.ts */
const articleStatusEnum = z.enum(["draft", "reviewing", "approved", "published", "failed", "archived"])
const backlogStatusEnum = z.enum(["new", "triaged", "ready", "in-progress", "revamped", "published", "skipped"])
const backlogPriorityEnum = z.enum(["low", "normal", "high"])
const productInputSchema = z.object({
  title: z.string().trim().min(1),
  description: optionalString,
  price: optionalString,
  imageUrl: optionalString,
  url: optionalString,
  handle: optionalString,
  vendor: optionalString,
  tags: optionalString,
  id: optionalString,
  productType: optionalString,
  compareAtPrice: optionalString,
})

export const generateArticleRequestSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  keyword: z.string().trim().min(1, "keyword is required"),
  category: optionalString,
  tone: optionalString,
  wordCount: z.coerce.number().int().positive().max(6000).optional(),
  products: z.array(productInputSchema).optional(),
  relatedArticles: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        url: z.string().trim().min(1),
        description: z.string().trim().min(1),
      })
    )
    .optional(),
  internalLinks: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        url: z.string().trim().min(1),
        description: z.string().trim().optional(),
      })
    )
    .optional(),
  articleType: optionalString,
  audience: optionalString,
  collection: optionalString,
  specialInstructions: optionalString,
  includeComparisonTable: z.boolean().optional(),
})

export const revampGenerateRequestSchema = z.object({
  existingContent: z.string().trim().min(1, "existingContent is required"),
  existingShopifyId: z.number().int().positive().optional(),
  existingHandle: optionalString,
  category: z.string().trim().min(1, "category is required"),
  keyword: z.string().trim().min(1, "keyword is required"),
  tone: optionalString,
  wordCount: z.coerce.number().int().positive().max(6000).optional(),
  includeProducts: z.boolean().optional(),
  includeFAQ: z.boolean().optional(),
  includeEmailCapture: z.boolean().optional(),
  includeCalculator: z.boolean().optional(),
  calculatorType: optionalString,
  includeComparisonTable: z.boolean().optional(),
  specialInstructions: optionalString,
  titleTag: optionalString,
  metaDescription: optionalString,
  approvedOutline: z
    .array(
      z.object({
        heading: z.string().trim().min(1),
        keyPoints: z.array(z.string().trim()).default([]),
        isNew: z.boolean().default(false),
      })
    )
    .default([]),
  citations: z
    .array(
      z.object({
        id: optionalString,
        url: z.string().trim().url("citation url must be a valid URL"),
        title: optionalString,
        notes: optionalString,
      })
    )
    .default([]),
  revampSourceId: z.number().int().positive().optional(),
  sourceUrl: optionalString,
  collection: optionalString,
  relatedArticles: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        url: z.string().trim().min(1),
        description: z.string().trim().min(1),
      })
    )
    .optional(),
})

export const shopifyPublishRequestSchema = z.object({
  articleId: z.string().uuid().optional(),
  title: z.string().trim().min(1, "title is required"),
  bodyHtml: z.string().trim().min(1, "bodyHtml is required"),
  summary: optionalString,
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  author: optionalString,
  handle: optionalString,
  metafields: z
    .array(
      z.object({
        namespace: z.string().trim().min(1),
        key: z.string().trim().min(1),
        value: z.string(),
        type: z.string().trim().min(1),
      })
    )
    .optional(),
  blogId: z.union([z.number().int().positive(), z.string().trim().min(1)]).optional(),
  published: z.boolean().optional(),
  featuredImageUrl: optionalString,
  featuredImageAlt: optionalString,
  category: optionalString,
})

// Schema for PUT /api/shopify/blog/update. Validates shape, enforces length
// caps, and requires `fields` to contain at least one editable key — so a
// malformed request fails fast with a 400 instead of silently corrupting a
// live Shopify article (e.g. writing `undefined` into body_html).
export const shopifyUpdateRequestSchema = z.object({
  shopifyArticleId: z.union([
    z.number().int().positive(),
    z.string().trim().min(1),
  ]),
  blogId: z
    .union([z.number().int().positive(), z.string().trim().min(1)])
    .optional(),
  // When provided, used to resolve the correct blog instead of the hardcoded
  // wellness/news fallback. Required for articles in non-wellness blogs
  // (e.g. 'supplements' for creatine articles).
  blogHandle: optionalString,
  fields: z
    .object({
      title: z.string().trim().min(1).max(500).optional(),
      // Shopify's body_html can be long — cap at ~2MB to prevent runaway
      // payloads from burning API quota without rejecting legitimate articles.
      body_html: z.string().max(2_000_000).optional(),
      summary_html: z.string().max(10_000).optional(),
      tags: z.string().max(5_000).optional(),
      image: z
        .object({
          src: z.string().url("image.src must be a valid URL"),
          alt: z.string().max(500).optional(),
        })
        .optional(),
    })
    .refine(
      (f) => Object.keys(f).length > 0,
      "fields must include at least one editable key (title, body_html, summary_html, tags, or image)"
    ),
})

export const revampBacklogPatchSchema = z.object({
  slug: z.string().trim().min(1, "slug is required"),
  status: backlogStatusEnum.optional(),
  priority: backlogPriorityEnum.optional(),
  notes: z.string().optional(),
  revampReason: z.string().optional(),
  lastReviewedAt: optionalString,
  openedForRevampAt: optionalString,
  latestRevampArticleId: z.string().uuid().optional(),
  publishedAt: optionalString,
})

export const revampBacklogSyncSchema = z.object({
  slugs: z.array(z.string().trim().min(1)).min(1).max(20),
})

export const createArticleSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  slug: z.string().trim().min(1, "slug is required"),
  category: nullableOptionalString,
  keyword: nullableOptionalString,
  html_content: z.string().trim().min(1, "html_content is required"),
  meta_description: nullableOptionalString,
  schema_markup: nullableOptionalString,
  featured_image_url: nullableOptionalString,
  word_count: z.coerce.number().int().min(0).optional(),
  status: articleStatusEnum.default("draft"),
  tone: nullableOptionalString,
  article_type: nullableOptionalString,
  shopify_blog_tag: nullableOptionalString,
  image_storyboard: nullableJsonRecord,
})

// ---------------------------------------------------------------------------
// Ultimate Guides
// ---------------------------------------------------------------------------

const nullableJsonArray = z.array(z.unknown()).nullable().optional()

export const createGuideSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  slug: z.string().trim().min(1, "slug is required"),
  topic_short: z.string().trim().min(1, "topic_short is required"),
  topic_short_plural: optionalString,
  topic_full: optionalString,
  breadcrumb_l2_name: optionalString,
  breadcrumb_l2_slug: optionalString,
  collection_slug: optionalString,
  hero_image_url: nullableOptionalString,
  date_published: optionalString,
  read_time_mins: z.coerce.number().int().positive().optional(),
  related_guides: nullableJsonArray,
})

export const updateGuideSchema = z
  .object({
    id: z.string().trim().min(1),
    title: nullableOptionalString,
    slug: nullableOptionalString,
    topic_short: nullableOptionalString,
    topic_short_plural: nullableOptionalString,
    topic_full: nullableOptionalString,
    breadcrumb_l2_name: nullableOptionalString,
    breadcrumb_l2_slug: nullableOptionalString,
    collection_slug: nullableOptionalString,
    hero_image_url: nullableOptionalString,
    hero_image_cdn_url: nullableOptionalString,
    date_published: nullableOptionalString,
    read_time_mins: z.coerce.number().int().positive().nullable().optional(),
    related_guides: z.unknown().optional(),
    selected_products: z.unknown().optional(),
    html_content: nullableOptionalString,
    meta_description: nullableOptionalString,
    key_takeaways: z.unknown().optional(),
    faq_pairs: z.unknown().optional(),
    cluster_links: z.unknown().optional(),
    has_images: z.boolean().nullable().optional(),
    image_count: z.coerce.number().int().min(0).nullable().optional(),
    config_complete: z.boolean().nullable().optional(),
    products_complete: z.boolean().nullable().optional(),
    content_complete: z.boolean().nullable().optional(),
    images_complete: z.boolean().nullable().optional(),
    status: nullableOptionalString,
    section_content: z.unknown().optional(),
    section_versions: z.unknown().optional(),
    shopify_page_id: nullableOptionalString,
    published_at: nullableOptionalString,
  })
  .refine((body) => body.id !== undefined && body.id !== null && String(body.id).trim().length > 0, {
    message: "id is required",
    path: ["id"],
  })

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

export const updateArticleSchema = z
  .object({
    id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
    title: nullableOptionalString,
    slug: nullableOptionalString,
    category: nullableOptionalString,
    keyword: nullableOptionalString,
    html_content: nullableOptionalString,
    meta_description: nullableOptionalString,
    title_tag: nullableOptionalString,
    schema_markup: nullableOptionalString,
    featured_image_url: nullableOptionalString,
    word_count: z.coerce.number().int().min(0).optional(),
    status: articleStatusEnum.nullable().optional(),
    tone: nullableOptionalString,
    article_type: nullableOptionalString,
    shopify_blog_tag: nullableOptionalString,
    image_storyboard: nullableJsonRecord,
    products: z.array(productInputSchema).nullable().optional(),
  })
  .refine((body) => body.id !== undefined && body.id !== null && String(body.id).trim().length > 0, {
    message: "id is required",
    path: ["id"],
  })
