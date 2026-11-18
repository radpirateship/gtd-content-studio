'use client'

import { useState, useRef, useEffect } from 'react'
import { Layers, Upload, FileSpreadsheet, Plus, Trash2, Play, Loader2, Check, AlertCircle, X, Download, Eye, RotateCcw, Send, ArrowLeft, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GeneratedArticle, Product, WellnessCategory } from '@/lib/types'
import { COLLECTION_NAMES, COLLECTION_TO_CATEGORY } from '@/lib/collections'
import type { ImageModel } from '@/lib/imageGeneration'

interface BulkItem {
  id: string
  title: string
  keyword: string
  collection: string
  /** Live Shopify handle carried from content_brain.collection_slug. */
  collectionSlug?: string
  secondaryCollection?: string
  brand?: string
  articleType?: string
  audience?: string
  tone?: string
  wordCount?: number
  includeComparisonTable?: boolean
  specialInstructions?: string
  priority?: string
  titleTag?: string
  metaDescription?: string
  shopifySlug?: string
  ultimateGuideUrl?: string
  ultimateGuideTitle?: string
  status: 'queued' | 'running' | 'done' | 'error'
  step?: string
  article?: GeneratedArticle
  error?: string
  // Back-reference to the content_brain row this item originated from.
  // When the article finishes generating we flip content_brain.status='live'
  // via this id. Undefined for manually added / CSV imported items.
  contentBrainId?: number
}

interface BulkUploadViewProps {
  onArticleGenerated: (article: GeneratedArticle) => void
  onOpenArticle?: (article: GeneratedArticle) => void
  generateSlug: (title: string) => string
  generateSchemaMarkup: (article: GeneratedArticle) => string
  saveArticleToDb: (article: GeneratedArticle) => Promise<number | null>
  /** Externally-pushed items (e.g. from Content Brain Review Queue).
   *  Merged into the queue on change, then onPrefillConsumed() is called. */
  prefillItems?: BulkItem[]
  onPrefillConsumed?: () => void
}

// Collections and mapping imported from lib/collections.ts (master list)
// The static label list is no longer rendered; the picker is fed live from Shopify.
const COLLECTIONS = COLLECTION_NAMES // eslint-disable-line @typescript-eslint/no-unused-vars

/** Convert a content_brain DB row into a BulkItem for the queue. Exported
 *  so the Content Brain Review Queue can use the same mapping when pushing. */
export function brainRowToBulkItem(r: {
  id: number
  title: string
  keyword: string | null
  collection: string | null
  cluster_group: string | null
  article_type: string | null
  audience: string | null
  tone: string | null
  word_count: number | null
  special_instructions: string | null
  priority: string | null
  target_subcollection?: string | null
  target_brand?: string | null
  meta_title?: string | null
  description?: string | null
  url_slug?: string | null
  ultimate_guide_url?: string | null
  ultimate_guide_title?: string | null
}): BulkItem {
  const articleType = (r.article_type || '').toLowerCase()
  const defaultIncludeTable = ['buyers-guide', 'comparison', 'brand-review'].includes(articleType)
  return {
    id: `brain-${r.id}-${Date.now().toString(36)}`,
    contentBrainId: r.id,
    title: r.title,
    keyword: r.keyword || '',
    collection: r.collection || r.cluster_group || '',
    articleType: r.article_type || undefined,
    audience: r.audience || 'general',
    tone: r.tone || 'educational',
    // Enforce a 2,500-word minimum — TAP values like 1,000 / 1,200 are
    // planning estimates, not production targets. Claude targets the number
    // you give it, so 1,000 → ~1,400 output words.
    wordCount: Math.max(r.word_count || 2500, 2500),
    includeComparisonTable: defaultIncludeTable,
    specialInstructions: r.special_instructions || undefined,
    priority: r.priority || 'P2',
    secondaryCollection: r.target_subcollection || undefined,
    brand: r.target_brand || undefined,
    titleTag: r.meta_title || undefined,
    metaDescription: r.description || undefined,
    // The slug planned in the brain is the slug the article publishes under,
    // and the one other articles in the batch link to.
    shopifySlug: r.url_slug || undefined,
    ultimateGuideUrl: r.ultimate_guide_url || undefined,
    ultimateGuideTitle: r.ultimate_guide_title || undefined,
    status: 'queued',
  }
}

/** The BulkItem interface is defined above — re-exported for the Content
 *  Brain push to build typed payloads. */
export type { BulkItem }

export function BulkUploadView({
  onArticleGenerated,
  onOpenArticle,
  generateSlug,
  generateSchemaMarkup,
  saveArticleToDb,
  prefillItems,
  onPrefillConsumed,
}: BulkUploadViewProps) {
  const [items, setItems] = useState<BulkItem[]>([])
  // Live Shopify collections for the searchable "Products" cell.
  const [liveCollections, setLiveCollections] = useState<{ handle: string; title: string; hub?: string }[]>([])
  // Rows arrive from the brain and from CSVs carrying the collection as a label
  // ("Cold Plunges"), a handle ("cold-plunges") or the old static label. The
  // picker's values are handles, so a label that never gets translated shows
  // as an empty select even though the row is fine. Translate once, here.
  const toHandle = (value: string | null | undefined): string => {
    const v = (value || '').trim()
    if (!v) return ''
    const lower = v.toLowerCase()
    const live = liveCollections.find(c => c.handle.toLowerCase() === lower || c.title.toLowerCase() === lower)
    if (live) return live.handle
    const legacy = Object.keys(COLLECTION_TO_CATEGORY).find(k => k.toLowerCase() === lower)
    if (legacy) return COLLECTION_TO_CATEGORY[legacy]
    return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  }
  useEffect(() => {
    fetch('/api/shopify/collections')
      .then(r => r.json())
      .then(d => setLiveCollections(d.collections || []))
      .catch(() => {})
  }, [])

  // Consume prefill items pushed from Content Brain. Dedupe by id so repeat
  // navigation doesn't duplicate rows already in the queue.
  useEffect(() => {
    if (!prefillItems || prefillItems.length === 0) return
    setItems((prev) => {
      const existingIds = new Set(prev.map((p) => p.id))
      // Keep upload/CSV order: sort incoming rows by their Content Brain id
      // (ascending) so the queue isn't in the API's newest-first order.
      const fresh = prefillItems
        .filter((p) => !existingIds.has(p.id))
        .slice()
        .sort((a, b) => ((a.contentBrainId ?? 0) - (b.contentBrainId ?? 0)))
      return [...prev, ...fresh]
    })
    onPrefillConsumed?.()
  }, [prefillItems, onPrefillConsumed])

  // Resume articles the user previously pushed but didn't finish generating.
  // Any content_brain row with status='in-queue' that isn't already in the
  // queue gets fetched and added on demand.
  const [resuming, setResuming] = useState(false)
  const resumeInQueue = async () => {
    setResuming(true)
    try {
      const res = await fetch('/api/content-brain/ideas?status=in-queue&limit=200')
      if (!res.ok) return
      const data = await res.json()
      // Sort by id ascending so the queue follows upload/CSV order, not the
      // API's newest-first (created_at DESC) default.
      const rows = (Array.isArray(data.ideas) ? data.ideas : [])
        .slice()
        .sort((a: { id: number }, b: { id: number }) => (a.id ?? 0) - (b.id ?? 0))
      const existingBrainIds = new Set(items.map((i) => i.contentBrainId).filter(Boolean))
      const toAdd: BulkItem[] = rows
        .filter((r: { id: number }) => !existingBrainIds.has(r.id))
        .map((r: Parameters<typeof brainRowToBulkItem>[0]) => brainRowToBulkItem(r))
      if (toAdd.length > 0) {
        setItems((prev) => [...prev, ...toAdd])
      }
    } finally {
      setResuming(false)
    }
  }
  const [isRunning, setIsRunning] = useState(false)
  const [completedCount, setCompletedCount] = useState(0)
  const [phase, setPhase] = useState<'setup' | 'review'>('setup')
  const [selectedForPublish, setSelectedForPublish] = useState<Set<string>>(new Set())
  const [startTime, setStartTime] = useState<number | null>(null)
  const [endTime, setEndTime] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef(false)

  // ââ Manual add row ââ
  const addRow = () => {
    setItems(prev => [...prev, {
      id: `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: '', keyword: '', collection: '', status: 'queued',
    }])
  }

  const updateRow = (id: string, field: keyof BulkItem, value: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item))
  }

  const removeRow = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id))
  }

  // ââ CSV parsing ââ
  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (!text) return

      const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
      const parseLine = (line: string): string[] => {
        const result: string[] = []
        let current = ''
        let inQuotes = false
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '"') {
            inQuotes = !inQuotes
          } else if (line[i] === ',' && !inQuotes) {
            result.push(current.trim())
            current = ''
          } else {
            current += line[i]
          }
        }
        result.push(current.trim())
        return result
      }

      // Detect header row and map column indices
      const hasHeader = lines[0]?.toLowerCase().includes('title')
      const startIdx = hasHeader ? 1 : 0
      const headerCols = hasHeader ? parseLine(lines[0]).map(h => h.toLowerCase()) : []
      const colIdx = (name: string) => { const i = headerCols.indexOf(name.toLowerCase()); return i >= 0 ? i : -1 }
      const col = {
        title: Math.max(colIdx('title'), 0),
        keyword: Math.max(colIdx('keyword'), 1),
        collection: colIdx('collection') >= 0 ? colIdx('collection') : 2,
        secondaryCollection: colIdx('secondarycollection'),
        brand: colIdx('brand'),
        articleType: colIdx('articletype'),
        audience: colIdx('audience'),
        tone: colIdx('tone'),
        wordCount: colIdx('wordcount'),
        includeComparisonTable: colIdx('includecomparisontable'),
        specialInstructions: colIdx('specialinstructions'),
        priority: colIdx('priority'),
        titleTag: colIdx('titletag'),
        metaDescription: colIdx('metadescription'),
        shopifySlug: colIdx('shopifyslug'),
      }

      const getCol = (parts: string[], idx: number) => idx >= 0 ? (parts[idx] || '').trim() : ''

      const newItems: BulkItem[] = []

      for (let i = startIdx; i < lines.length && i < 51; i++) {
        const parts = parseLine(lines[i])
        if (parts.length >= 2) {
          const rawWordCount = getCol(parts, col.wordCount).replace(/,/g, '')
          const rawComparison = getCol(parts, col.includeComparisonTable).toLowerCase()
          newItems.push({
            id: `bulk-${Date.now()}-${i}`,
            title: parts[col.title] || '',
            keyword: parts[col.keyword] || '',
            collection: parts[col.collection] || '',
            secondaryCollection: getCol(parts, col.secondaryCollection) || undefined,
            brand: getCol(parts, col.brand) || undefined,
            articleType: getCol(parts, col.articleType) || undefined,
            audience: getCol(parts, col.audience) || undefined,
            tone: getCol(parts, col.tone) || undefined,
            wordCount: rawWordCount ? parseInt(rawWordCount, 10) || undefined : undefined,
            includeComparisonTable: rawComparison === 'true' || rawComparison === 'yes' || rawComparison === '1' || undefined,
            specialInstructions: getCol(parts, col.specialInstructions) || undefined,
            priority: getCol(parts, col.priority) || undefined,
            titleTag: getCol(parts, col.titleTag) || undefined,
            metaDescription: getCol(parts, col.metaDescription) || undefined,
            shopifySlug: getCol(parts, col.shopifySlug) || undefined,
            status: 'queued',
          })
        }
      }

      if (newItems.length > 0) {
        setItems(prev => [...prev, ...newItems])
      }
    }
    reader.readAsText(file)
    // Reset input so same file can be selected again
    e.target.value = ''
  }

  // ââ Download CSV template ââ
  const downloadTemplate = () => {
    const csv = 'title,keyword,collection,secondaryCollection,articleType,wordCount\nAuroom Sauna Review: Every Model Compared,auroom sauna,Saunas,Auroom Saunas,brand-review,2500\nBest Infrared Saunas for Home Use,best infrared saunas,Saunas,Infrared Saunas,buyers-guide,2500\nCold Plunge Benefits for Recovery,cold plunge benefits,Recovery,Cold Plunges,benefit-deep-dive,1800\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ppw-bulk-upload-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ââ Process single article (full auto-run) ââ
  const processItem = async (item: BulkItem): Promise<GeneratedArticle | null> => {
    // The main collection is any LIVE Shopify handle. Resolve in this order:
    // live handle, live title, legacy label map, raw slug. The generate route
    // resolves the handle against the synced collections table, so anything
    // live works end to end. The old static map turned every collection it
    // did not know (home-gym-equipment, for one) into general-wellness.
    // The brain carries the live handle in collection_slug. Use it first.
    // Deriving a handle from the display label is what broke this: 205 brain
    // rows carry a label that does not match the Shopify title, so
    // "Saunum Sauna Systems" slugified to saunum-sauna-systems and
    // "Home Gym Equipment for Every Workout" to a handle that 404s, and the
    // generate route then fell all the way back to /collections/all. The right
    // handle was sitting in collection_slug the whole time.
    // general-wellness is not a live collection either; home-wellness is.
    const category = toHandle(item.collectionSlug) || toHandle(item.collection) || 'home-wellness'
    // Internal links come from the PRIMARY collection; products come from the
    // SECONDARY ("product collection"), falling back to primary, then hub category.
    const toSlug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const primarySlug = toHandle(item.collectionSlug) || toHandle(item.collection)
    const productCollection = item.secondaryCollection || item.collection || ''
    const prodSlug = productCollection ? (toHandle(productCollection) || toSlug(productCollection)) : ''

    // Update status
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'running', step: 'Checking slug...' } : i))

    try {
      // Bulk Upload is for NEW articles. If a live article already owns this
      // slug, this is a revamp, and running it here produces the wrong result:
      // no images carried, no Updated line, no grade, and a publish that either
      // fails on the duplicate handle or mints a mangled URL. Stop before
      // burning a generation and point at the right screen.
      // The trailing -<13 digit epoch> is residue from the old /api/articles
      // collision bug. Left on, the live check looks up a handle that is free
      // by definition, so the guard passes and a duplicate URL gets published.
      const existingSlug = ((item.shopifySlug || '').replace(/^\/blogs\/[^/]+\//, '') || generateSlug(item.title)).replace(/-\d{13}$/, '')
      if (existingSlug) {
        try {
          const liveCheck = await fetch(`/api/shopify/blog-read/fetch?handle=${encodeURIComponent(existingSlug)}`)
          if (liveCheck.ok) {
            throw new Error(
              `Already live at /blogs/wellness/${existingSlug}. Revamp it from the Revamp tab (Revamp now) so it keeps its images, URL and publish date.`
            )
          }
        } catch (checkErr) {
          // Only the "already live" case should stop the run. A failed lookup
          // (network, auth) must not block new content from generating.
          if (checkErr instanceof Error && checkErr.message.startsWith('Already live')) throw checkErr
        }
      }

      setItems(prev => prev.map(i => i.id === item.id ? { ...i, step: 'Generating outline...' } : i))
      // Outline
      const outlineRes = await fetch('/api/generate/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: item.title, keyword: item.keyword, category }),
      })
      if (!outlineRes.ok) throw new Error('Outline failed')
      const { outline } = await outlineRes.json()

      // Products
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, step: 'Finding products...' } : i))
      let products: Product[] = []
      try {
        const pRes = await fetch(`/api/products?category=${category}&collection=${prodSlug || category}${prodSlug ? `&subcollection=${prodSlug}` : ''}${item.brand ? `&brand=${encodeURIComponent(item.brand)}` : ''}&search=${encodeURIComponent(item.keyword)}&limit=4${/\bbrands?\b/i.test(`${item.title} ${item.keyword}`) && !item.brand ? '&vendorCap=1' : ''}`)
        if (pRes.ok) { const d = await pRes.json(); products = d.products || [] }
      } catch {}

      // Topical authority
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, step: 'Fetching resources...' } : i))
      let internalLinks: { title: string; url: string; description?: string }[] = []
      let relatedArticles: { title: string; url: string; description: string }[] = []
      try {
        // Scope by collection slug â no fuzzy matching needed
        const rRes = await fetch(`/api/resources?type=topical-authority&collection=${primarySlug || category}`)
        if (rRes.ok) {
          const data = await rRes.json()
          const allTopics = data.items || []

          // Exclude the current article, keep only rows with a URL
          const withUrls = allTopics.filter((t: any) =>
            t.existingUrl && t.title?.toLowerCase() !== item.title.toLowerCase()
          )
          internalLinks = withUrls.slice(0, 15).map((t: any) => ({ title: t.title, url: t.existingUrl, description: t.metaDescription || '' }))
          // Related articles: rank by relevance to THIS article (shared words with
          // its title/keyword), then shuffle a top pool so we don't show the same
          // 3 every time (the candidate list comes back in a fixed order).
          const cluster = withUrls.filter((t: any) => !t.title?.toLowerCase().includes('ultimate guide'))
          const stop = new Set(['the','a','an','for','and','of','to','in','with','your','how','best','guide','vs','is','are','what','why','can','does'])
          const terms = new Set(
            `${item.title} ${item.keyword}`.toLowerCase().split(/[^a-z0-9]+/).filter((w: string) => w.length > 2 && !stop.has(w))
          )
          const scored = cluster
            .map((t: any) => {
              const words = (t.title || '').toLowerCase().split(/[^a-z0-9]+/)
              const score = words.reduce((n: number, w: string) => n + (terms.has(w) ? 1 : 0), 0)
              return { t, score }
            })
            .sort((a: any, b: any) => b.score - a.score)
          const pool = scored.slice(0, Math.max(3, Math.min(8, scored.length)))
          for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
          relatedArticles = pool.slice(0, 3).map(({ t }: any) => ({ title: t.title, url: t.existingUrl, description: t.metaDescription || '' }))
        }
      } catch {}

      // The content brain is where planning happens now, so the cluster's
      // PLANNED articles are link targets too: the batch publishes together
      // under these slugs. Merged after topical_authority, deduped by URL.
      try {
        const cRes = await fetch(`/api/content-brain/cluster-links?collection=${encodeURIComponent(primarySlug || category)}${item.contentBrainId ? `&exclude=${item.contentBrainId}` : ''}`)
        if (cRes.ok) {
          const c = await cRes.json()
          const have = new Set(internalLinks.map(l => l.url.replace(/^https?:\/\/(www\.)?peakprimalwellness\.com/i, '').replace(/\/+$/, '').toLowerCase()))
          const mine = item.title.toLowerCase()
          for (const l of (c.links || []) as { title: string; url: string; description?: string; planned?: boolean; cluster?: boolean }[]) {
            const key = l.url.replace(/\/+$/, '').toLowerCase()
            if (have.has(key) || (l.title || '').toLowerCase() === mine) continue
            have.add(key)
            // cluster:true rides along. content_brain.status says "live" the
            // moment an article is generated, so the planned flag alone cannot
            // tell a batch member from a published article, and the generate
            // route was dropping the whole batch for not being on Shopify yet.
            internalLinks.push({ title: l.title, url: l.url, description: l.description || '', planned: !!l.planned, cluster: true } as any)
          }
          if (relatedArticles.length < 3) {
            // The rest of this batch counts. A 15-article bulk run publishes
            // together, so its members are each other's Keep reading tiles the
            // same way they are each other's body links. Live siblings first,
            // then the planned ones from this run.
            const all = (c.links || []) as { title: string; url: string; description?: string; planned?: boolean }[]
            for (const l of [...all.filter(l => !l.planned), ...all.filter(l => l.planned)]) {
              if (relatedArticles.length >= 3) break
              if (relatedArticles.some(r => r.url === l.url)) continue
              relatedArticles.push({ title: l.title, url: l.url, description: l.description || '' })
            }
          }
          console.log(`[bulk] cluster links for ${primarySlug || category}: ${c.live} live, ${c.planned} planned, inventory now ${internalLinks.length}`)
        }
      } catch {}
      internalLinks = internalLinks.slice(0, 30)

      // Generate content
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, step: 'Writing article...' } : i))
      const contentRes = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title, keyword: item.keyword, category,
          collection: item.collection,
          articleType: item.articleType,
          audience: item.audience || 'general',
          tone: item.tone || 'educational',
          wordCount: Math.max(item.wordCount || 2500, 2500),
          includeComparisonTable: item.includeComparisonTable || false,
          specialInstructions: item.specialInstructions || '',
          products: products.map(p => ({
            title: p.title, description: p.description, price: p.price, imageUrl: p.imageUrl,
            url: p.handle ? `https://peakprimalwellness.com/products/${p.handle}` : p.url, handle: p.handle,
            vendor: p.vendor,
          })),
          relatedArticles,
          internalLinks,
          ultimateGuide: item.ultimateGuideUrl ? { url: item.ultimateGuideUrl, title: item.ultimateGuideTitle || '' } : undefined,
        }),
      })
      if (!contentRes.ok) throw new Error('Content generation failed')
      const { content, metaDescription: generatedMeta } = await contentRes.json()

      // Strip <style> and <script> blocks first so their contents don't inflate
      // the word count — the embedded CSS alone adds ~1,000 phantom words.
      const contentNoInert = content
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      const textContent = contentNoInert.replace(/<[^>]*>/g, ' ')
      const wordCount = textContent.split(/\s+/).filter(Boolean).length
      const rawSlug = (item.shopifySlug || '').replace(/^\/blogs\/[^/]+\//, '')
    const slug = rawSlug || generateSlug(item.title)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const article: any = {
        id: `article-${Date.now()}`,
        title: item.title, slug,
        titleTag: item.titleTag || undefined,
        metaDescription: item.metaDescription || generatedMeta || `Learn about ${item.keyword}.`.slice(0, 160),
        shopifySlug: item.shopifySlug || slug,
        content: textContent, htmlContent: content,
        featuredImage: undefined, contentImages: [],
        products: products.map(p => ({ ...p, tags: typeof (p as any).tags === 'string' ? (p as any).tags.split(',').map((t: string) => t.trim()) : (p as any).tags || [], url: p.handle ? `https://peakprimalwellness.com/products/${p.handle}` : '#', isAvailable: true })),
        faqs: outline?.faq?.map((f: any) => ({ question: f.question, answer: f.briefAnswer })) || [],
        schemaMarkup: '', category: category as WellnessCategory, keyword: item.keyword,
        shopifyBlogTag: item.collection as any,
        articleType: item.articleType,
        wordCount, createdAt: new Date(), status: 'draft',
        hasInternalLinks: false, hasImages: false, linkCount: 0, imageCount: 0,
      }
      // v2 writes its links during generation. Count them now so the row
      // does not read "0 internal links" when the scan step finds nothing
      // new to add.
      {
        const hrefs = (content.match(/href=["'](?:https?:\/\/(?:www\.)?peakprimalwellness\.com)?\/(?:blogs|collections)\/[^"'#?]+/gi) || [])
        const n = new Set(hrefs.map((h: string) => h.toLowerCase().replace(/\/+$/, ''))).size
        article.linkCount = n
        article.hasInternalLinks = n > 0
      }
      article.schemaMarkup = generateSchemaMarkup(article)
      const dbId = await saveArticleToDb(article)
      if (dbId) article.dbId = dbId

      // Auto-apply links via the lightweight two-step pipeline:
      //  1) scan-links: AI proposes ~10 anchor/URL pairs from the plain text
      //     (tiny output, fast — avoids the old add-links full-body rewrite that
      //     timed out and hung for minutes on full-size articles).
      //  2) apply-links: deterministically wraps those anchors in the HTML.
      if (internalLinks.length > 0) {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, step: 'Adding links...' } : i))
        try {
          const scanRes = await fetch('/api/articles/scan-links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              htmlContent: article.htmlContent,
              internalLinks,
              articleTitle: item.title,
              articleKeyword: item.keyword,
              category,
            }),
          })
          if (scanRes.ok) {
            const scan = await scanRes.json()
            const suggestions = scan.suggestions || []
            if (suggestions.length > 0) {
              const applyRes = await fetch('/api/articles/apply-links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  articleId: article.dbId,
                  htmlContent: article.htmlContent,
                  approvedLinks: suggestions,
                }),
              })
              if (applyRes.ok) {
                const d = await applyRes.json()
                article.htmlContent = d.htmlContent
                article.linkCount = Math.max(article.linkCount || 0, d.linkCount || 0)
                article.hasInternalLinks = article.linkCount > 0
              }
            }
          }
        } catch {}
      }

      return article
    } catch (err) {
      throw err
    }
  }

  // ââ Run all items sequentially ââ
  const runAll = async () => {
    // Process strictly in queue order (top to bottom, as shown) — do NOT
    // re-sort by priority. The queue is already in upload/CSV order.
    const validItems = items
      .filter(i => i.title && i.keyword && (i.status === 'queued' || i.status === 'error'))
    if (validItems.length === 0) return

    // Reset errored items to queued
    setItems(prev => prev.map(i => i.status === 'error' ? { ...i, status: 'queued', error: undefined } : i))

    setIsRunning(true)
    setCompletedCount(0)
    setStartTime(Date.now())
    setEndTime(null)
    abortRef.current = false

    for (const item of validItems) {
      if (abortRef.current) break

      try {
        const article = await processItem(item)
        if (article) {
          setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'done', step: `${article.wordCount?.toLocaleString()} words`, article } : i))
          onArticleGenerated(article)
          setCompletedCount(prev => prev + 1)
          // If this item originated from the Content Brain, flip its DB row
          // to status='live' so the Content Map + Article Database reflect it.
          if (item.contentBrainId) {
            fetch('/api/content-brain/ideas', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: item.contentBrainId,
                status: 'live',
                traffic_light: 'green',
              }),
            }).catch(() => { /* best-effort — don't block generation on sync */ })
          }
        }
      } catch (err) {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'error', step: undefined, error: err instanceof Error ? err.message : 'Failed' } : i))
      }
    }

    setIsRunning(false)
    setEndTime(Date.now())

    // Switch to review phase once processing finishes
    setPhase('review')
    // Pre-select all completed items for publish
    setSelectedForPublish(new Set(items.filter(i => i.status === 'done').map(i => i.id)))
  }

  const stopRun = () => { abortRef.current = true }

  const validCount = items.filter(i => i.title && i.keyword).length
  const doneCount = items.filter(i => i.status === 'done').length
  const errorCount = items.filter(i => i.status === 'error').length
  // "Skipped" used to count every row still in 'queued', so nine rows pushed
  // after a one-article test run showed as "Skipped: 9" before anything had
  // been asked to run. Queued is queued. Skipped is a row the run loop will
  // not pick up because it is missing a title or keyword.
  const queuedCount = items.filter(i => i.status === 'queued' && i.title && i.keyword).length
  const skippedCount = items.filter(i => i.status === 'queued' && !(i.title && i.keyword)).length
  const totalTime = startTime && endTime ? Math.round((endTime - startTime) / 1000) : 0
  const avgTime = doneCount > 0 ? Math.round(totalTime / doneCount) : 0

  // Toggle selection for publish
  const toggleSelect = (id: string) => {
    setSelectedForPublish(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    const completedIds = items.filter(i => i.status === 'done').map(i => i.id)
    if (selectedForPublish.size === completedIds.length) setSelectedForPublish(new Set())
    else setSelectedForPublish(new Set(completedIds))
  }

  // Retry failed items
  const retryFailed = () => {
    setPhase('setup')
    runAll()
  }

  // --- REVIEW PHASE ---
  if (phase === 'review') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Review header */}
        <div className="flex items-center justify-between border-b px-6 py-3" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4" style={{ color: 'var(--ppw-accent)' }} />
            <h1 className="font-serif text-[17px] font-semibold" style={{ color: 'var(--text1)' }}>Bulk Review</h1>
          </div>
          <button
            onClick={() => setPhase('setup')}
            className="flex items-center gap-1.5 text-[12px] font-medium"
            style={{ color: 'var(--text3)' }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Queue
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-6 border-b px-6 py-2.5" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <StatItem label="Total" value={String(items.length)} />
          <StatItem label="Completed" value={String(doneCount)} color="var(--ppw-accent)" />
          {errorCount > 0 && <StatItem label="Failed" value={String(errorCount)} color="#c53030" />}
          {queuedCount > 0 && <StatItem label="Queued" value={String(queuedCount)} />}
          {skippedCount > 0 && <StatItem label="Skipped (no title/keyword)" value={String(skippedCount)} color="#b8860b" />}
          <StatItem label="Total Time" value={`${Math.floor(totalTime / 60)}m ${totalTime % 60}s`} />
          <StatItem label="Avg/Article" value={`${Math.floor(avgTime / 60)}m ${avgTime % 60}s`} />
        </div>

        {/* Review table */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* Select all */}
          <div className="flex items-center gap-3 px-2 pb-2 border-b mb-1" style={{ borderColor: 'var(--border)' }}>
            <input
              type="checkbox"
              checked={selectedForPublish.size === items.filter(i => i.status === 'done').length && doneCount > 0}
              onChange={toggleSelectAll}
              className="h-3.5 w-3.5 rounded"
            />
            <span className="text-[9px] font-mono font-medium tracking-[1px] uppercase" style={{ color: 'var(--text4)' }}>
              Select All ({selectedForPublish.size} of {doneCount})
            </span>
          </div>

          {items.map(item => (
            <div
              key={item.id}
              className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-black/[0.02] transition-colors"
            >
              {item.status === 'done' && (
                <input
                  type="checkbox"
                  checked={selectedForPublish.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  className="h-3.5 w-3.5 rounded flex-shrink-0"
                />
              )}
              {item.status !== 'done' && <div className="w-3.5 flex-shrink-0" />}

              {/* Status icon */}
              <div className="flex-shrink-0">
                {item.status === 'done' && <Check className="h-4 w-4" style={{ color: 'var(--ppw-accent)' }} />}
                {item.status === 'error' && <AlertCircle className="h-4 w-4" style={{ color: '#c53030' }} />}
                {item.status === 'queued' && <div className="h-4 w-4 rounded-full border" style={{ borderColor: 'var(--text4)' }} />}
              </div>

              {/* Title + meta */}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate" style={{ color: item.status === 'error' ? '#c53030' : 'var(--text1)' }}>
                  {item.title}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px]" style={{ color: 'var(--text3)' }}>
                  {item.article && <span>{item.article.wordCount?.toLocaleString()} words</span>}
                  {item.error && <span style={{ color: '#c53030' }}>{item.error}</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {item.status === 'done' && item.article && onOpenArticle && (
                  <button
                    onClick={() => onOpenArticle(item.article!)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium border"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text2)' }}
                  >
                    <Eye className="h-3 w-3" />
                    Review
                  </button>
                )}
                {item.status === 'error' && (
                  <button
                    onClick={() => {
                      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'queued', error: undefined } : i))
                    }}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium border"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: '#c53030' }}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Retry
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom action bar */}
        <div className="flex items-center justify-between border-t px-6 py-3" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            {errorCount > 0 && (
              <Button
                variant="outline" size="sm"
                onClick={retryFailed}
                className="gap-1.5 text-[12px]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry All Failed ({errorCount})
              </Button>
            )}
          </div>
          <Button
            size="sm"
            disabled={selectedForPublish.size === 0}
            className="gap-1.5 text-[12px]"
            style={{ background: 'var(--ppw-accent)', color: '#fff' }}
          >
            <Send className="h-3.5 w-3.5" />
            Publish {selectedForPublish.size} Selected to Shopify
          </Button>
        </div>
      </div>
    )
  }

  // --- SETUP/PROCESSING PHASE ---
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b px-6 py-3" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4" style={{ color: 'var(--ppw-accent)' }} />
          <h1 className="font-serif text-[17px] font-semibold" style={{ color: 'var(--text1)' }}>Bulk Upload</h1>
          {items.length > 0 && (
            <span className="ml-2 text-[11px] font-mono rounded px-1.5 py-0.5" style={{ background: 'var(--surface)', color: 'var(--text3)' }}>
              {items.length} article{items.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isRunning ? (
            <>
              <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5 text-[12px]">
                <Download className="h-3.5 w-3.5" />
                CSV Template
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5 text-[12px]"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Upload CSV
              </Button>
              <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSV} className="hidden" />
              <Button
                size="sm"
                disabled={validCount === 0}
                onClick={runAll}
                className="gap-1.5 text-[12px]"
                style={{ background: 'var(--ppw-accent)', color: '#fff' }}
              >
                <Play className="h-3.5 w-3.5" />
                Run All ({validCount})
              </Button>
            </>
          ) : (
            <Button size="sm" variant="destructive" onClick={stopRun} className="gap-1.5 text-[12px]">
              <X className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar when running */}
      {isRunning && validCount > 0 && (
        <div className="h-1 w-full" style={{ background: 'var(--surface)' }}>
          <div
            className="h-full transition-all duration-500"
            style={{ background: 'var(--ppw-accent)', width: `${(completedCount / validCount) * 100}%` }}
          />
        </div>
      )}

      {/* Table area */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
            <div className="rounded-full p-4" style={{ background: 'var(--surface)' }}>
              <FileSpreadsheet className="h-8 w-8" style={{ color: 'var(--text4)' }} />
            </div>
            <div>
              <p className="text-[14px] font-medium" style={{ color: 'var(--text2)' }}>No articles queued</p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text4)' }}>
                Upload a CSV or manually add articles to generate in batch.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                Upload CSV
              </Button>
              <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add Manually
              </Button>
              <Button variant="outline" size="sm" onClick={resumeInQueue} disabled={resuming} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                {resuming ? 'Loading…' : 'Resume Content Brain'}
              </Button>
            </div>
            <p className="text-[10px] font-mono" style={{ color: 'var(--text4)' }}>
              CSV format: title, keyword, collection (optional) · &ldquo;Resume Content Brain&rdquo; pulls any articles you pushed from the Review Queue but haven&apos;t generated yet.
            </p>
          </div>
        ) : (
          <div className="px-4 py-3">
            {/* Table header */}
            <div className="grid gap-2 px-2 pb-2 border-b mb-1" style={{ gridTemplateColumns: '1fr 1fr 130px 130px 60px 90px 36px', borderColor: 'var(--border)' }}>
              <span className="text-[9px] font-mono font-medium tracking-[1px] uppercase" style={{ color: 'var(--text4)' }}>Title</span>
              <span className="text-[9px] font-mono font-medium tracking-[1px] uppercase" style={{ color: 'var(--text4)' }}>Keyword</span>
              <span className="text-[9px] font-mono font-medium tracking-[1px] uppercase" style={{ color: 'var(--text4)' }}>Collection <span style={{ opacity: 0.6 }}>(links)</span></span>
              <span className="text-[9px] font-mono font-medium tracking-[1px] uppercase" style={{ color: 'var(--text4)' }}>Products</span>
              <span className="text-[9px] font-mono font-medium tracking-[1px] uppercase" style={{ color: 'var(--text4)' }}>Words</span>
              <span className="text-[9px] font-mono font-medium tracking-[1px] uppercase" style={{ color: 'var(--text4)' }}>Status</span>
              <span />
            </div>

            <datalist id="ppw-bulk-product-collections">
              {liveCollections.map(c => <option key={c.handle} value={c.handle}>{c.title}</option>)}
            </datalist>
            <datalist id="ppw-bulk-main-collections">
              {liveCollections.map(c => <option key={c.handle} value={c.handle}>{c.title}{c.hub ? ` · ${c.hub}` : ''}</option>)}
            </datalist>

            {/* Rows */}
            {items.map(item => (
              <div key={item.id} className="rounded-md hover:bg-black/[0.02] transition-colors">
              <div
                className="grid gap-2 items-center px-2 py-1.5"
                style={{ gridTemplateColumns: '1fr 1fr 130px 130px 60px 90px 36px' }}
              >
                <input
                  type="text"
                  value={item.title}
                  onChange={e => updateRow(item.id, 'title', e.target.value)}
                  disabled={item.status !== 'queued'}
                  placeholder="Article title..."
                  className="rounded border px-2 py-1.5 text-[12px] outline-none"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
                <input
                  type="text"
                  value={item.keyword}
                  onChange={e => updateRow(item.id, 'keyword', e.target.value)}
                  disabled={item.status !== 'queued'}
                  placeholder="Target keyword..."
                  className="rounded border px-2 py-1.5 text-[12px] outline-none"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
                <input
                  type="text"
                  list="ppw-bulk-main-collections"
                  value={item.collection}
                  onChange={e => updateRow(item.id, 'collection', e.target.value)}
                  onBlur={e => { const h = toHandle(e.target.value); if (h && h !== e.target.value) updateRow(item.id, 'collection', h) }}
                  disabled={item.status !== 'queued'}
                  placeholder="Search…"
                  title="Main collection: breadcrumb, hub, shop button and link cluster. Type to search every live Shopify collection; the value is the handle."
                  className="rounded border px-2 py-1.5 text-[12px] outline-none"
                  style={{
                    background: 'var(--bg)',
                    // Red border when the value does not resolve to a live collection.
                    borderColor: item.collection && liveCollections.length > 0 && !liveCollections.some(c => c.handle === toHandle(item.collection)) ? '#dc2626' : 'var(--border)',
                    color: 'var(--text1)',
                  }}
                />
                <input
                  type="text"
                  list="ppw-bulk-product-collections"
                  value={item.secondaryCollection || ''}
                  onChange={e => updateRow(item.id, 'secondaryCollection', e.target.value)}
                  disabled={item.status !== 'queued'}
                  placeholder="Search…"
                  title="Product collection — featured products come from here (leave blank to use Collection)"
                  className="rounded border px-2 py-1.5 text-[12px] outline-none"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
                <input
                  type="number"
                  value={item.wordCount ?? 2500}
                  min={500}
                  max={8000}
                  step={500}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v)) setItems(prev => prev.map(i => i.id === item.id ? { ...i, wordCount: v } : i))
                  }}
                  disabled={item.status !== 'queued'}
                  title="Target word count"
                  className="rounded border px-2 py-1.5 text-[12px] outline-none text-center"
                  style={{ background: (item.wordCount ?? 2500) < 2000 ? '#fff4d6' : 'var(--bg)', borderColor: (item.wordCount ?? 2500) < 2000 ? '#d69e2e' : 'var(--border)', color: 'var(--text1)' }}
                />
                <div className="flex items-center gap-1.5">
                  {item.status === 'queued' && <Circle className="h-3 w-3" style={{ color: 'var(--text4)' }} />}
                  {item.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" style={{ color: 'var(--ppw-accent)' }} />}
                  {item.status === 'done' && <Check className="h-3 w-3" style={{ color: 'var(--ppw-accent)' }} />}
                  {item.status === 'error' && <AlertCircle className="h-3 w-3" style={{ color: '#c53030' }} />}
                  <span className="text-[11px] truncate" style={{
                    color: item.status === 'running' ? 'var(--ppw-accent)' : item.status === 'error' ? '#c53030' : 'var(--text3)',
                  }}>
                    {item.status === 'queued' ? 'Queued' : item.status === 'running' ? (item.step || 'Running...') : item.status === 'done' ? (item.step || 'Done') : (item.error || 'Error')}
                  </span>
                </div>
                <button
                  onClick={() => removeRow(item.id)}
                  disabled={item.status === 'running'}
                  className="flex items-center justify-center rounded p-1 hover:bg-black/5 transition-colors disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--text4)' }} />
                </button>
              </div>
              {(item.articleType || item.tone || item.audience || item.includeComparisonTable || item.priority || item.specialInstructions) && (
                <div className="px-2 pb-1 text-[10px] font-mono" style={{ color: 'var(--text4)' }}>
                  {item.articleType ? `type: ${item.articleType}` : ''}
                  {item.tone ? ` · tone: ${item.tone}` : ''}
                  {item.audience ? ` · aud: ${item.audience}` : ''}
                  {item.includeComparisonTable ? ' · +table' : ''}
                  {item.priority ? ` · ${item.priority}` : ''}
                  {item.specialInstructions ? ` · note: ${item.specialInstructions.slice(0, 70)}` : ''}
                </div>
              )}
              </div>
            ))}

            {/* Add row button */}
            {!isRunning && (
              <button
                onClick={addRow}
                className="flex items-center gap-1.5 px-2 py-2 mt-1 text-[12px] rounded-md hover:bg-black/[0.02] transition-colors w-full"
                style={{ color: 'var(--text3)' }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add row
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer stats */}
      {items.length > 0 && (
        <div className="flex items-center justify-between border-t px-6 py-2.5" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-4 text-[11px]" style={{ color: 'var(--text3)' }}>
            <span>{validCount} valid</span>
            {doneCount > 0 && <span style={{ color: 'var(--ppw-accent)' }}>{doneCount} completed</span>}
            {errorCount > 0 && <span style={{ color: '#c53030' }}>{errorCount} failed</span>}
          </div>
          <span className="text-[10px] font-mono" style={{ color: 'var(--text4)' }}>
            ~{Math.round(validCount * 3)} min estimated
          </span>
        </div>
      )}
    </div>
  )
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-mono uppercase tracking-[1px]" style={{ color: 'var(--text4)' }}>{label}</span>
      <span className="text-[14px] font-semibold" style={{ color: color || 'var(--text1)' }}>{value}</span>
    </div>
  )
}
