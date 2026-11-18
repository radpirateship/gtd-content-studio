'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Plus, X, Loader2, Upload, Info } from 'lucide-react'
import { toast } from 'sonner'
import { RevampStepper, type RevampStep } from './revamp-stepper'
import { apiFetch } from '@/lib/api-client'
import type { RevampBacklogSource } from '@/lib/types'
import { COLLECTION_SLUGS } from '@/lib/collections'

interface RevampArticleViewProps {
  initialSource?: RevampBacklogSource | null
  onAnalysisComplete: (
    analysis: any,
    originalContent: string,
    citations: { url: string; title?: string; notes?: string }[],
    settings: any
  ) => void
}

interface Citation {
  id: string
  url: string
  title?: string
  notes?: string
}

interface BlogPost {
  id: number
  url: string
  section: string
  slug: string
  category: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  created_at: string
}

interface ShopifySearchResult {
  id: string
  legacy_id?: number | null
  title: string
  handle: string
  tags?: string
  published_at?: string
  updated_at?: string
  has_image?: boolean
  has_content_images?: boolean
  has_internal_links?: boolean
  has_products?: boolean
  has_faq?: boolean
}

// GTD collection slugs (single source of truth in lib/collections.ts)
const GTD_CATEGORIES = COLLECTION_SLUGS

export function RevampArticleView({ initialSource, onAnalysisComplete }: RevampArticleViewProps) {
  const [activeTab, setActiveTab] = useState<'paste' | 'shopify' | 'browse'>('paste')
  const [articleContent, setArticleContent] = useState('')
  const [citations, setCitations] = useState<Citation[]>([{ id: '1', url: '', title: '', notes: '' }])
  const [category, setCategory] = useState(GTD_CATEGORIES[0])
  const [keyword, setKeyword] = useState('')
  const [tone, setTone] = useState('Educational')
  const [wordCount, setWordCount] = useState('2000')
  const [settings, setSettings] = useState({
    includeProducts: true,
    includeFAQ: true,
    includeComparisonTable: false,
    includeImages: true,
    videoUrl: '',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [shopifyQuery, setShopifyQuery] = useState('')
  const [shopifyResults, setShopifyResults] = useState<ShopifySearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>([])
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null)
  const [isLoadingBlogPosts, setIsLoadingBlogPosts] = useState(false)
  const [isUploadingCSV, setIsUploadingCSV] = useState(false)
  const [sourceContext, setSourceContext] = useState<{
    handle?: string
    shopifyId?: number
    title?: string
    sourceUrl?: string
    publishedAt?: string
    author?: string | null
    trackingStatus?: string
    trackingNotes?: string | null
    revampReason?: string | null
  } | null>(null)

  const addCitation = () => {
    setCitations([...citations, { id: Date.now().toString(), url: '', title: '', notes: '' }])
  }

  const extractHandleFromInput = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ''

    try {
      const url = new URL(trimmed)
      const parts = url.pathname.split('/').filter(Boolean)
      const blogsIndex = parts.findIndex(part => part === 'blogs')
      if (blogsIndex >= 0 && parts[blogsIndex + 2]) {
        return parts[blogsIndex + 2]
      }
    } catch {
      // Not a URL; fall through and treat it like a raw handle/query.
    }

    return trimmed
      .split('?')[0]
      .split('#')[0]
      .split('/')
      .filter(Boolean)
      .pop()
      ?.trim() || ''
  }

  const removeCitation = (id: string) => {
    setCitations(citations.filter(c => c.id !== id))
  }

  const updateCitation = (id: string, field: keyof Citation, value: string) => {
    setCitations(
      citations.map(c => (c.id === id ? { ...c, [field]: value } : c))
    )
  }

  const searchShopify = async () => {
    if (!shopifyQuery.trim()) return
    setIsSearching(true)
    try {
      const trimmedQuery = shopifyQuery.trim()
      const maybeHandle = extractHandleFromInput(trimmedQuery)
      const isDirectLookup =
        trimmedQuery.startsWith('http://') ||
        trimmedQuery.startsWith('https://') ||
        /^[a-z0-9-]+$/i.test(trimmedQuery)

      const response = await apiFetch(
        isDirectLookup
          ? `/api/shopify/blog-read/fetch?handle=${encodeURIComponent(maybeHandle)}`
          : `/api/shopify/blog-read/search?q=${encodeURIComponent(trimmedQuery)}`
      )
      if (response.ok) {
        const data = await response.json()
        if (isDirectLookup && data.body_html) {
          setArticleContent(data.body_html)
          setKeyword(data.handle?.replace(/-/g, ' ') || maybeHandle.replace(/-/g, ' '))
          setSourceContext(prev => ({
            handle: data.handle || prev?.handle,
            shopifyId: data.legacy_id || prev?.shopifyId,
            title: data.title || prev?.title,
            sourceUrl: data.online_store_url || prev?.sourceUrl,
            publishedAt: data.published_at || prev?.publishedAt,
            author: data.author || prev?.author,
            trackingStatus: prev?.trackingStatus,
            trackingNotes: prev?.trackingNotes,
            revampReason: prev?.revampReason,
          }))
          setActiveTab('paste')
          setShopifyResults([])
          toast.success('Article fetched from Shopify')
          return
        }

        setShopifyResults(data.articles || [])
        if (!data.articles?.length) {
          toast.message('No Shopify articles matched that query')
        }
      } else {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || 'Shopify search failed')
      }
    } catch (error) {
      console.error('Failed to search Shopify:', error)
      toast.error('Shopify search failed', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setIsSearching(false)
    }
  }

  const fetchFromShopify = async (articleId: string) => {
    try {
      const response = await apiFetch(`/api/shopify/blog-read/fetch?id=${encodeURIComponent(articleId)}`)
      if (response.ok) {
        const data = await response.json()
        setArticleContent(data.body_html || '')
        setKeyword(data.handle?.replace(/-/g, ' ') || '')
        setSourceContext(prev => ({
          handle: data.handle || prev?.handle,
          shopifyId: data.legacy_id || prev?.shopifyId,
          title: data.title || prev?.title,
          sourceUrl: prev?.sourceUrl || data.online_store_url || (data.handle ? `https://greenthumbdepot.com/blogs/${data.blog_handle || 'news'}/${data.handle}` : undefined),
          publishedAt: data.published_at || prev?.publishedAt,
          author: data.author || prev?.author,
          trackingStatus: prev?.trackingStatus,
          trackingNotes: prev?.trackingNotes,
          revampReason: prev?.revampReason,
        }))
        setActiveTab('paste')
        setShopifyResults([])
        toast.success('Article fetched from Shopify')
      } else {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || 'Failed to fetch article from Shopify')
      }
    } catch (error) {
      console.error('Failed to fetch article from Shopify:', error)
      toast.error('Failed to fetch article', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  const fetchBlogPosts = async () => {
    setIsLoadingBlogPosts(true)
    try {
      const response = await apiFetch('/api/blog-posts?sort=clicks&limit=100')
      if (response.ok) {
        const data = await response.json()
        setBlogPosts(data.data || [])
        setLastImportedAt(data.lastImportedAt || null)
      }
    } catch (error) {
      console.error('Failed to fetch blog posts:', error)
    } finally {
      setIsLoadingBlogPosts(false)
    }
  }

  const handleCSVUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    // Every upload wipes and replaces the existing GSC snapshot. Confirm before
    // overwriting so accidental uploads (wrong export, partial data) don't
    // silently destroy a good dataset.
    if (blogPosts.length > 0) {
      const ok = window.confirm(
        `Uploading will replace the existing ${blogPosts.length} blog posts with the contents of this CSV. Continue?`
      )
      if (!ok) {
        event.target.value = ''
        return
      }
    }

    setIsUploadingCSV(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await apiFetch('/api/blog-posts', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        await fetchBlogPosts()
      } else {
        console.error('Failed to upload CSV')
      }
    } catch (error) {
      console.error('CSV upload failed:', error)
    } finally {
      setIsUploadingCSV(false)
      event.target.value = ''
    }
  }

  const [isFetchingBlogPost, setIsFetchingBlogPost] = useState(false)

  const revampBlogPost = async (post: BlogPost) => {
    setCategory(post.category)
    setKeyword(post.slug.replace(/-/g, ' '))
    setIsFetchingBlogPost(true)

    try {
      // Try to fetch the article HTML directly from Shopify by slug/handle
      const response = await apiFetch(`/api/shopify/blog-read/fetch?handle=${encodeURIComponent(post.slug)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.body_html) {
          setArticleContent(data.body_html)
          setSourceContext({
            handle: data.handle || post.slug,
            shopifyId: data.legacy_id,
            title: data.title || formatSlugToTitle(post.slug),
            sourceUrl: data.online_store_url || post.url,
            publishedAt: data.published_at,
          })
          setActiveTab('paste')
          return
        }
      }
    } catch (error) {
      console.error('Failed to auto-fetch blog post from Shopify:', error)
    } finally {
      setIsFetchingBlogPost(false)
    }

    // Fallback: switch to paste tab with instructions if auto-fetch failed
    setArticleContent('')
    setActiveTab('paste')
    setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Paste"]')
      if (textarea) {
        textarea.placeholder = `Could not auto-fetch: ${post.url}\n\nPaste the HTML manually from Shopify Admin → Blog posts → find this article → copy the HTML`
        textarea.focus()
      }
    }, 100)
  }

  const formatSlugToTitle = (slug: string): string => {
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const handleAnalyze = async () => {
    if (!articleContent.trim()) {
      toast.error('Please provide article content', { description: 'Paste HTML, enter a Shopify URL, or select a blog post.' })
      return
    }
    if (!keyword.trim()) {
      toast.error('Please enter a primary keyword', { description: 'The keyword is used for SEO analysis and link suggestions.' })
      return
    }

    setIsLoading(true)
    try {
      const validCitations = citations.filter(c => c.url.trim())
      const response = await apiFetch('/api/revamp/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existingContent: articleContent,
          citations: validCitations,
          category,
          keyword,
          existingHandle: sourceContext?.handle,
          existingShopifyId: sourceContext?.shopifyId,
          existingTitle: sourceContext?.title,
          sourceUrl: sourceContext?.sourceUrl,
          originalPublishedAt: sourceContext?.publishedAt,
          trackingStatus: sourceContext?.trackingStatus,
          revampReason: sourceContext?.revampReason,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to analyze article')
      }

      const responseData = await response.json()
      // API returns { analysis: { ... } } — unwrap the inner object
      const analysis = responseData.analysis || responseData
      const settingsData = {
        category,
        keyword,
        tone,
        wordCount: parseInt(wordCount),
        existingHandle: sourceContext?.handle,
        existingShopifyId: sourceContext?.shopifyId,
        existingAuthor: sourceContext?.author || null,
        sourceUrl: sourceContext?.sourceUrl,
        trackingStatus: sourceContext?.trackingStatus,
        trackingNotes: sourceContext?.trackingNotes,
        revampReason: sourceContext?.revampReason,
        revampSourceId: responseData.revampSourceId || undefined,
        ...settings,
      }

      onAnalysisComplete(analysis, articleContent, validCitations, settingsData)
    } catch (error) {
      console.error('[revamp] Analysis failed:', error)
      toast.error('Analysis failed', { description: error instanceof Error ? error.message : 'Please try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  const stepperStep: RevampStep = isLoading ? 'analyzing' : 'input'

  useEffect(() => {
    if (!initialSource?.slug) return

    setCategory(initialSource.category || GTD_CATEGORIES[0])
    setKeyword(initialSource.keyword || initialSource.slug.replace(/-/g, ' '))
    setSourceContext({
      handle: initialSource.slug,
      shopifyId: initialSource.existingShopifyId ?? undefined,
      title: initialSource.currentTitle || formatSlugToTitle(initialSource.slug),
      sourceUrl: initialSource.sourceUrl,
      trackingStatus: initialSource.trackingStatus,
      trackingNotes: initialSource.trackingNotes,
      revampReason: initialSource.revampReason,
    })
    setIsFetchingBlogPost(true)
    setActiveTab('shopify')

    apiFetch(`/api/shopify/blog-read/fetch?handle=${encodeURIComponent(initialSource.slug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to fetch article from Shopify')
        const data = await response.json()
        setArticleContent(data.body_html || '')
        setActiveTab('paste')
        setSourceContext((prev) => ({
          handle: data.handle || initialSource.slug,
          shopifyId: data.legacy_id || prev?.shopifyId,
          title: data.title || prev?.title,
          sourceUrl: prev?.sourceUrl || data.online_store_url || initialSource.sourceUrl,
          publishedAt: data.published_at || prev?.publishedAt,
          author: data.author || prev?.author,
          trackingStatus: prev?.trackingStatus,
          trackingNotes: prev?.trackingNotes,
          revampReason: prev?.revampReason,
        }))
      })
      .catch((error) => {
        console.error('[revamp] Failed to preload backlog source:', error)
        toast.warning('Could not auto-load Shopify content', {
          description: 'You can still fetch it manually or paste the article into the revamp form.',
        })
        setActiveTab('paste')
      })
      .finally(() => {
        setIsFetchingBlogPost(false)
      })
  }, [initialSource])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Progress Stepper */}
      <div className="flex-shrink-0 border-b px-6" style={{ borderColor: 'var(--border)', background: 'var(--bg-warm)' }}>
        <RevampStepper currentStep={stepperStep} />
      </div>

      <div className="flex flex-1 overflow-hidden">
      {/* Left Column: Article Input + Citations */}
      <div className="flex-1 flex flex-col overflow-hidden border-r" style={{ borderColor: 'var(--border)' }}>
        {/* Header */}
        <div className="flex-shrink-0 border-b px-6 py-4" style={{ borderColor: 'var(--border)' }}>
          <h1 className="font-serif text-[22px] font-semibold mb-1" style={{ color: 'var(--text1)' }}>
            Revamp Article
          </h1>
          {sourceContext?.sourceUrl ? (
            <a
              href={sourceContext.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-mono mb-1 hover:underline truncate max-w-full"
              style={{ color: 'var(--gtd-accent)' }}
              title={sourceContext.sourceUrl}
            >
              {sourceContext.sourceUrl}
            </a>
          ) : null}
          <p className="text-[13px] leading-[1.5]" style={{ color: 'var(--text3)' }}>
            Paste or fetch an existing article, then analyze it. You&apos;ll review the analysis —
            word count, heading structure, content gaps — and customize an improved outline before generating.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b px-6 flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => setActiveTab('paste')}
            className="px-4 py-2.5 text-[12px] font-medium border-b-[2px] transition-all"
            style={{
              color: activeTab === 'paste' ? 'var(--gtd-accent)' : 'var(--text3)',
              borderBottomColor: activeTab === 'paste' ? 'var(--gtd-accent)' : 'transparent',
            }}
          >
            Paste Content
          </button>
          <button
            onClick={() => setActiveTab('shopify')}
            className="px-4 py-2.5 text-[12px] font-medium border-b-[2px] transition-all"
            style={{
              color: activeTab === 'shopify' ? 'var(--gtd-accent)' : 'var(--text3)',
              borderBottomColor: activeTab === 'shopify' ? 'var(--gtd-accent)' : 'transparent',
            }}
          >
            Fetch from Shopify
          </button>
          <button
            onClick={() => {
              setActiveTab('browse')
              if (blogPosts.length === 0) {
                fetchBlogPosts()
              }
            }}
            className="px-4 py-2.5 text-[12px] font-medium border-b-[2px] transition-all"
            style={{
              color: activeTab === 'browse' ? 'var(--gtd-accent)' : 'var(--text3)',
              borderBottomColor: activeTab === 'browse' ? 'var(--gtd-accent)' : 'transparent',
            }}
          >
            Browse
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'paste' && (
            <div>
              <label className="block text-[12px] font-mono uppercase tracking-[0.5px] mb-2" style={{ color: 'var(--text3)' }}>
                Article Content <span style={{ color: '#c44' }}>*</span>
              </label>
              <textarea
                value={articleContent}
                onChange={e => setArticleContent(e.target.value)}
                placeholder="Paste your HTML or text content here..."
                className="w-full h-[200px] p-3 rounded-lg border resize-none"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
              />
            </div>
          )}

          {activeTab === 'shopify' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-mono uppercase tracking-[0.5px] mb-2" style={{ color: 'var(--text3)' }}>
                  Shopify Article Search
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shopifyQuery}
                    onChange={e => setShopifyQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        searchShopify()
                      }
                    }}
                    placeholder="Search by title, handle, or paste a blog URL"
                    className="flex-1 rounded-lg border px-3 py-2 text-[12px]"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                  />
                  <button
                    onClick={searchShopify}
                    disabled={isSearching || !shopifyQuery.trim()}
                    className="btn-primary px-3 py-2 text-[12px] disabled:opacity-50"
                  >
                    {isSearching ? 'Searching...' : 'Search'}
                  </button>
                </div>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text4)' }}>
                  Exact handles and full Green Thumb Depot blog URLs fetch immediately. Broader queries return a result list to choose from.
                </p>
              </div>

              {isSearching && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--text3)' }} />
                </div>
              )}

              {!isSearching && shopifyResults.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[13px] font-mono" style={{ color: 'var(--text2)' }}>
                    {shopifyResults.length} Shopify articles found
                  </div>

                  <div className="space-y-2 max-h-[520px] overflow-y-auto">
                    {shopifyResults.map(article => (
                      <div
                        key={article.id}
                        className="rounded-lg border p-3"
                        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-[13px] font-medium leading-snug" style={{ color: 'var(--text1)' }}>
                              {article.title}
                            </h3>
                            <div className="mt-1 text-[11px] font-mono" style={{ color: 'var(--text4)' }}>
                              {article.handle}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                              {article.has_content_images && (
                                <span className="rounded px-2 py-0.5" style={{ background: 'var(--surface)', color: 'var(--text2)' }}>
                                  Images
                                </span>
                              )}
                              {article.has_internal_links && (
                                <span className="rounded px-2 py-0.5" style={{ background: 'var(--surface)', color: 'var(--text2)' }}>
                                  Internal links
                                </span>
                              )}
                              {article.has_products && (
                                <span className="rounded px-2 py-0.5" style={{ background: 'var(--surface)', color: 'var(--text2)' }}>
                                  Products
                                </span>
                              )}
                              {article.has_faq && (
                                <span className="rounded px-2 py-0.5" style={{ background: 'var(--surface)', color: 'var(--text2)' }}>
                                  FAQ
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            onClick={() => fetchFromShopify(String(article.id))}
                            className="btn-primary px-2.5 py-1 text-[11px] flex-shrink-0"
                          >
                            Use Article
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isSearching && shopifyQuery.trim() && shopifyResults.length === 0 && (
                <div className="rounded-lg border p-4 text-center text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text3)' }}>
                  No search results yet. Try a broader title query, or paste the exact article URL/handle for a direct fetch.
                </div>
              )}
            </div>
          )}

          {activeTab === 'browse' && (
            <div className="space-y-4">
              {/* Upload Area */}
              <div className="p-4 rounded-lg border-2 border-dashed" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                <label className="block cursor-pointer">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCSVUpload}
                    disabled={isUploadingCSV}
                    className="hidden"
                  />
                  <div className="flex flex-col items-center justify-center py-4 text-center">
                    <Upload className="h-5 w-5 mb-2" style={{ color: 'var(--text3)' }} />
                    <div className="text-[13px] font-medium" style={{ color: 'var(--text2)' }}>
                      {isUploadingCSV ? 'Uploading...' : 'Upload GSC data (gtd-blog-posts.csv)'}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
                      Click to browse
                    </div>
                  </div>
                </label>
              </div>

              {/* Blog Posts List */}
              {blogPosts.length > 0 && (
                <div>
                  <div className="text-[13px] font-mono mb-3" style={{ color: 'var(--text2)' }}>
                    {blogPosts.length} blog posts loaded — sorted by clicks
                    {lastImportedAt && (
                      <span className="ml-2 text-[11px]" style={{ color: 'var(--text3)' }}>
                        · GSC data from {new Date(lastImportedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {blogPosts.map(post => (
                      <div
                        key={post.id}
                        className="p-3 rounded-lg border hover:border-opacity-100 transition-all"
                        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-[13px] font-medium leading-snug" style={{ color: 'var(--text1)' }}>
                              {formatSlugToTitle(post.slug)}
                            </h3>
                            {post.category && (
                              <div className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium" style={{ background: 'var(--surface)', color: 'var(--text2)' }}>
                                {post.category.replace(/-/g, ' ')}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => revampBlogPost(post)}
                            disabled={isFetchingBlogPost}
                            className="btn-primary px-2.5 py-1 text-[11px] flex-shrink-0"
                          >
                            {isFetchingBlogPost ? 'Loading...' : 'Revamp This'}
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-3 text-[11px] font-mono">
                          <div>
                            <div style={{ color: 'var(--text4)' }}>Clicks</div>
                            <div className="font-semibold" style={{ color: 'var(--text1)' }}>
                              {(post.clicks ?? 0).toLocaleString()}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text4)' }}>Impressions</div>
                            <div className="font-semibold" style={{ color: 'var(--text1)' }}>
                              {(post.impressions ?? 0).toLocaleString()}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text4)' }}>Position</div>
                            <div className="font-semibold" style={{ color: 'var(--text1)' }}>
                              {post.position > 0 ? post.position.toFixed(1) : '-'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isLoadingBlogPosts && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--text3)' }} />
                </div>
              )}

              {!isLoadingBlogPosts && blogPosts.length === 0 && (
                <div className="py-8 text-center" style={{ color: 'var(--text3)' }}>
                  <p className="text-[13px]">No blog posts loaded yet.</p>
                  <p className="text-[12px] mt-1">Upload a CSV file to get started.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Settings */}
      <div className="w-[340px] flex-shrink-0 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-[0.5px] mb-2" style={{ color: 'var(--text3)' }}>
              Category
            </label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-[12px]"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
            >
              {GTD_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {cat.replace(/-/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Primary Keyword */}
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-[0.5px] mb-2" style={{ color: 'var(--text3)' }}>
              Primary Keyword <span style={{ color: '#c44' }}>*</span>
            </label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="e.g., infrared sauna benefits"
              className="w-full px-3 py-2 rounded-lg border text-[12px]"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
            />
          </div>

          {/* Tone */}
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-[0.5px] mb-2" style={{ color: 'var(--text3)' }}>
              Tone
            </label>
            <select
              value={tone}
              onChange={e => setTone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-[12px]"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
            >
              {['Educational', 'Scientific', 'Conversational', 'Motivational'].map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Word Count */}
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-[0.5px] mb-1" style={{ color: 'var(--text3)' }}>
              Max Word Count
            </label>
            <p className="text-[10px] mb-2" style={{ color: 'var(--text3)' }}>
              Auto-scales by outline length. Override only if you need a hard cap.
            </p>
            <select
              value={wordCount}
              onChange={e => setWordCount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-[12px]"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
            >
              <option value="2500">Auto (outline-based)</option>
              {['1500', '2000', '2500', '3000', '3500'].map(wc => (
                <option key={wc} value={wc}>
                  Cap at {wc} words
                </option>
              ))}
            </select>
          </div>

          {/* Toggles */}
          <div className="space-y-2 pt-2">
            {[
              { key: 'includeProducts', label: 'Include Products' },
              { key: 'includeFAQ', label: 'Include FAQ' },
              { key: 'includeComparisonTable', label: 'Include Comparison Table' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings[key as keyof typeof settings] as boolean}
                  onChange={e =>
                    setSettings({ ...settings, [key]: e.target.checked })
                  }
                  className="rounded"
                />
                <span className="text-[12px]" style={{ color: 'var(--text2)' }}>
                  {label}
                </span>
              </label>
            ))}
          </div>

          {/* Video URL */}
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-[0.5px] mb-2" style={{ color: 'var(--text3)' }}>
              Video URL (YouTube/Vimeo)
            </label>
            <input
              type="url"
              value={settings.videoUrl}
              onChange={e => setSettings({ ...settings, videoUrl: e.target.value })}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full px-3 py-2 rounded-lg border text-[12px]"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
            />
          </div>


          {/* Citations */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-mono uppercase tracking-[0.5px]" style={{ color: 'var(--text3)' }}>
                Citations
              </label>
              <button
                onClick={addCitation}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-all"
                style={{ color: 'var(--gtd-accent)' }}
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            </div>

            <div className="space-y-2">
              {citations.map(citation => (
                <div key={citation.id} className="space-y-1.5 p-2.5 rounded-lg" style={{ background: 'var(--bg)' }}>
                  <input
                    type="url"
                    value={citation.url}
                    onChange={e => updateCitation(citation.id, 'url', e.target.value)}
                    placeholder="https://..."
                    className="w-full px-2 py-1.5 text-[11px] rounded border"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                  />
                  <div className="grid grid-cols-[1fr_auto] gap-1.5">
                    <input
                      type="text"
                      value={citation.title || ''}
                      onChange={e => updateCitation(citation.id, 'title', e.target.value)}
                      placeholder="Title (optional)"
                      className="px-2 py-1.5 text-[11px] rounded border"
                      style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                    />
                    <button
                      onClick={() => removeCitation(citation.id)}
                      className="px-2 py-1.5 rounded transition-all"
                      style={{ color: 'var(--text3)', background: 'var(--surface)' }}
                      aria-label="Remove citation"
                      title="Remove citation"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <textarea
                    value={citation.notes || ''}
                    onChange={e => updateCitation(citation.id, 'notes', e.target.value)}
                    placeholder="Notes (optional)"
                    className="w-full px-2 py-1.5 text-[11px] rounded border h-12 resize-none"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Special Instructions */}
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-[0.5px] mb-2" style={{ color: 'var(--text3)' }}>
              Special Instructions
            </label>
            <textarea
              placeholder="Any specific requirements for this rewrite..."
              className="w-full px-3 py-2 rounded-lg border text-[11px] h-24 resize-none"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
            />
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex-shrink-0 border-t p-4" style={{ borderColor: 'var(--border)' }}>
          <div
            className="flex items-start gap-2 mb-3 px-1 text-[11.5px] leading-[1.5]"
            style={{ color: 'var(--text4)' }}
          >
            <Info className="h-3.5 w-3.5 shrink-0 mt-[1px]" />
            <span>
              This will analyze the content and take you to a review page where you can
              adjust the outline, tone, and word count before generating the rewrite.
            </span>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={isLoading || (!articleContent.trim()) || (!keyword.trim())}
            className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-[13px]"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing content...
              </>
            ) : (
              <>
                Analyze Article
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
    </div>
  )
}
