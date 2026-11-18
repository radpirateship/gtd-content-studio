// Article Generation Types
export interface ArticleInput {
  title: string
  keyword: string
  category: WellnessCategory
  tone?: ArticleTone
  wordCount?: number
  includeProducts?: boolean
  includeFAQ?: boolean
  includeSchema?: boolean
  shopifySlug?: string
  shopifyBlogTag?: ShopifyBlogTag
  // New wireframe fields
  articleType?: string
  audience?: string
  collection?: string
  // Tree targeting: primary = collection above; optional secondary collection + brand.
  secondaryCollection?: string
  brand?: string
  specialInstructions?: string
  includeComparisonTable?: boolean
  includeInternalLinks?: boolean
  includeAIImages?: boolean
  titleTag?: string
  metaDescription?: string
}

export type ShopifyBlogTag =
  | 'saunas'
  | 'sensory-deprivation-tanks'
  | 'cold-plunges'
  | 'red-light-therapy'
  | 'hyperbaric-chambers'
  | 'massage-equipment'
  | 'recovery'
  | 'wellness'
  | 'steam'

export const SHOPIFY_BLOG_TAG_LABELS: Record<ShopifyBlogTag, string> = {
  'saunas': 'Saunas',
  'sensory-deprivation-tanks': 'Sensory Deprivation Tanks',
  'cold-plunges': 'Cold Plunge',
  'red-light-therapy': 'Red Light Therapy',
  'hyperbaric-chambers': 'Hyperbaric Chambers',
  'massage-chairs': 'Massage Equipment',
  'recovery': 'Recovery',
  'wellness': 'General Wellness',
  'steam': 'Steam',
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Single source of truth for collections ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// To add a new collection: add the slug to WellnessCategory, then add the label to CATEGORY_LABELS.
// All UI components and API routes import from here.
export type WellnessCategory = 
  | 'sensory-deprivation-tanks'
  | 'saunas'
  | 'barrel-saunas'
  | 'cold-plunges'
  | 'red-light-therapy'
  | 'hyperbaric-chambers'
  | 'hydrogen-water'
  | 'water-ionizers'
  | 'sauna-heaters'
  | 'sauna-accessories'
  | 'hybrid-saunas'
  | 'massage-equipment'
  | 'steam'
  | 'elliptical-machines'
  | 'exercise-bikes'
  | 'treadmills'
  | 'stair-climbers'
  | 'vertical-climbers'
  | 'pilates'
  | 'compression-boots'
  | 'air-purifiers'
  | 'air-filters'  // legacy — keep for backwards compat

export type ArticleTone = 'educational' | 'conversational' | 'authoritative' | 'scientific'

export interface ArticleOutline {
  title: string
  metaDescription: string
  sections: OutlineSection[]
  suggestedProducts: Product[]
  internalLinks: InternalLink[]
  faqQuestions: FAQItem[]
}

export interface OutlineSection {
  heading: string
  subheadings?: string[]
  keyPoints: string[]
  estimatedWords: number
}

export interface GeneratedArticle {
  id: string
  dbId?: number // Database ID for persistence
  title: string
  slug: string
  titleTag?: string
  metaDescription: string
  content: string
  htmlContent: string
  featuredImage?: GeneratedImage
  contentImages: GeneratedImage[]
  products: Product[]
  faqs: FAQItem[]
  schemaMarkup: string
  category: WellnessCategory
  keyword: string
  wordCount: number
  createdAt: Date
  status: ArticleStatus
  shopifyBlogTag?: ShopifyBlogTag
  articleType?: string
  // Enrichment tracking
  hasInternalLinks?: boolean
  hasImages?: boolean
  linkCount?: number
  imageCount?: number
  sourceType?: string
  revampSourceId?: number
  originalShopifyId?: number
  sourceUrl?: string
  hasFaq?: boolean
  imageStoryboard?: unknown
}

export type ArticleStatus = 'draft' | 'reviewing' | 'approved' | 'published' | 'failed'

// Product Types
export interface Product {
  id: string
  handle: string
  title: string
  description: string
  vendor: string
  productType: string
  tags: string[]
  price: string
  compareAtPrice?: string
  imageUrl?: string
  url: string
  category: WellnessCategory
  isAvailable: boolean
}

export interface ProductCatalog {
  products: Product[]
  lastUpdated: Date
  totalCount: number
}

// Image Generation Types
export interface GeneratedImage {
  id: string
  prompt: string
  url: string
  altText: string
  placement: 'featured' | 'inline' | 'product'
}

// Content Planning Types
export interface TopicalAuthority {
  pillarPages: PillarPage[]
  clusters: ContentCluster[]
  internalLinks: InternalLink[]
}

export interface PillarPage {
  title: string
  url: string
  category: WellnessCategory
  targetKeyword: string
}

export interface ContentCluster {
  pillarId: string
  supportingArticles: SupportingArticle[]
}

export interface SupportingArticle {
  title: string
  keyword: string
  url?: string
  status: 'planned' | 'draft' | 'published'
}

export interface InternalLink {
  anchorText: string
  url: string
  relevanceScore: number
}

export interface FAQItem {
  question: string
  answer: string
}

// Link Suggestion from AI scan
export interface LinkSuggestion {
  id: string
  anchorText: string
  targetUrl: string
  targetTitle: string
  rationale: string
  status: 'pending' | 'approved' | 'rejected'
  editedUrl?: string
  editedAnchor?: string
}

// Image Concept from AI
export interface ImageConcept {
  id: string
  label: string // e.g., "Figure 1: Vasoconstriction Diagram"
  prompt: string // The AI-drafted prompt
  editedPrompt?: string // User-edited version
  imageUrl?: string // After generation
  altText?: string // Descriptive alt text for accessibility/SEO, e.g. "Cross-section diagram showing cold plunge water circulation system"
  status: 'draft' | 'generating' | 'generated' | 'error'
  placeholderKey?: string // legacy ÃÂ¢ÃÂÃÂ maps to [IMAGE_PLACEHOLDER_N]
  targetSectionId?: string // H2 id to inject image after, e.g. "kohler-invigoration-overview"
  type?: 'featured' | 'technical' // featured = cinematic featured image (Shopify featured_image), technical = diagram/infographic
}

// Wizard step tracking
export type WizardStep = 1 | 2 | 3

// Shopify Types
export interface ShopifyBlogPost {
  title: string
  body_html: string
  author: string
  tags: string
  published: boolean
  image?: {
    src: string
    alt: string
  }
  metafields?: ShopifyMetafield[]
}

export interface ShopifyMetafield {
  namespace: string
  key: string
  value: string
  type: string
}

export interface ShopifyPublishResult {
  success: boolean
  articleId?: string
  articleUrl?: string
  error?: string
}

// App State Types
export interface GenerationProgress {
  step: GenerationStep
  progress: number
  message: string
}

export type GenerationStep = 
  | 'idle'
  | 'generating-outline'
  | 'writing-content'
  | 'optimizing-html'
  | 'ready-for-review'
  | 'adding-links'
  | 'adding-images'
  | 'publishing'
  | 'complete'
  | 'error'

// CATEGORY_LABELS is now derived from the master list in lib/collections.ts
export { CATEGORY_LABELS } from '@/lib/collections'

export const TONE_LABELS: Record<ArticleTone, string> = {
  'educational': 'Educational - Clear explanations for beginners',
  'conversational': 'Conversational - Friendly and approachable',
  'authoritative': 'Authoritative - Expert industry voice',
  'scientific': 'Scientific - Research-backed and technical'
}

export const ARTICLE_TONES = [
  { value: 'educational' as const, label: 'Educational' },
  { value: 'conversational' as const, label: 'Conversational' },
  { value: 'authoritative' as const, label: 'Authoritative' },
  { value: 'scientific' as const, label: 'Scientific' },
]
export type RevampBacklogStatus =
  | 'new'
  | 'triaged'
  | 'ready'
  | 'in-progress'
  | 'revamped'
  | 'published'
  | 'skipped'

export type RevampBacklogPriority = 'low' | 'normal' | 'high'

export interface RevampBacklogItem {
  slug: string
  title: string
  sourceUrl: string
  category: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  status: RevampBacklogStatus
  priority: RevampBacklogPriority
  revampReason?: string | null
  notes?: string | null
  lastReviewedAt?: string | null
  lastShopifySyncAt?: string | null
  openedForRevampAt?: string | null
  publishedAt?: string | null
  latestRevampArticleId?: string | null
  shopifyArticleId?: number | null
  shopifyPublishedAt?: string | null
  shopifyUpdatedAt?: string | null
  hasImage: boolean
  hasContentImages: boolean
  hasInternalLinks: boolean
  hasProducts: boolean
  hasFaq: boolean
  lastImportedAt?: string | null
  gradeScore?: number | null
  gradeFailures?: string[]
  collectionLinks?: number | null
  voiceScore?: number | null
  gradedAt?: string | null
  // Audit layer (content_health table); null until the audit backfill ran
  segment?: string | null
  era?: string | null
  emDashes?: number | null
  aiTells?: number | null
  imagesKeepable?: boolean | null
  clusterId?: number | null
  cannibalQueries?: number
  cannibalImpAtStake?: number
  cannibalPartners?: string | null
  indexStatus?: string | null
  healthFlag?: string | null
  healthFlagReason?: string | null
}

export interface RevampBacklogSource {
  slug: string
  category: string
  keyword: string
  trackingStatus: RevampBacklogStatus
  trackingNotes?: string | null
  sourceUrl?: string
  currentTitle?: string
  existingShopifyId?: number | null
  revampReason?: string | null
}
