'use client'

import { useState, useMemo } from 'react'
import { Plus, Trash2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { RevampGenerationProgress } from './revamp-generation-progress'
import { RevampStepper, type RevampStep } from './revamp-stepper'
import type { GeneratedArticle, OutlineSection } from '@/lib/types'
import { apiFetch } from '@/lib/api-client'

interface Claim {
  text: string
  citationIndex?: number
}

interface SuggestedOutlineSection {
  heading: string
  keyPoints: string[]
  isNew: boolean
}

interface AnalysisData {
  wordCount: number
  headings: string[]
  links: number
  images: number
  claims: Claim[]
  suggestedOutline?: SuggestedOutlineSection[]
}

interface Citation {
  url: string
  title: string
  author?: string
}

interface RevampAnalysisViewProps {
  analysis: AnalysisData
  originalContent: string
  citations: Citation[]
  settings: {
    category: string
    keyword: string
    tone: string
    wordCount: number
    existingTitle?: string
    existingHandle?: string
    existingShopifyId?: number
    existingAuthor?: string | null
    sourceUrl?: string
    trackingStatus?: string
    trackingNotes?: string
    revampReason?: string
    revampSourceId?: number
    includeProducts?: boolean
    includeFAQ?: boolean
    includeSchema?: boolean
    includeImages?: boolean
    videoUrl?: string
  }
  onGenerateComplete: (article: GeneratedArticle, moduleDrafts?: any) => void
  onBack: () => void
  onStartOver: () => void
  generateSlug: (title: string) => string
  generateSchemaMarkup: (article: Partial<GeneratedArticle>) => string
  saveArticleToDb: (article: GeneratedArticle) => Promise<string | null>
}

interface OutlineSectionState extends OutlineSection {
  id: string
  isNew: boolean
}

export function RevampAnalysisView({
  analysis,
  originalContent,
  citations,
  settings,
  onGenerateComplete,
  onBack,
  onStartOver,
  generateSlug: _generateSlug,
  generateSchemaMarkup,
  saveArticleToDb: _saveArticleToDb,
}: RevampAnalysisViewProps) {
  // Populate outline from AI analysis suggestedOutline (P0 fix)
  const initialOutline: OutlineSectionState[] = analysis.suggestedOutline?.length
    ? analysis.suggestedOutline.map((s: SuggestedOutlineSection, index: number) => ({
        id: String(index + 1),
        heading: s.heading,
        keyPoints: s.keyPoints || ['Key point'],
        estimatedWords: Math.round((settings.wordCount || 2500) / (analysis.suggestedOutline?.length || 6)),
        isNew: s.isNew ?? false,
      }))
    : (() => {
        console.warn('[revamp-analysis] No suggestedOutline from AI — using content-aware fallback')
        const targetWords = settings.wordCount || 2500
        const bodyWords = Math.max(200, targetWords - 400)
        return [
          { id: '1', heading: 'Introduction', keyPoints: ['Introduce the topic and why it matters', 'Establish credibility with a key fact or statistic', 'Preview what the reader will learn'], estimatedWords: 200, isNew: false },
          { id: '2', heading: 'Core Benefits & Science', keyPoints: ['Primary benefit backed by research', 'How the mechanism works in the body', 'Dosage or usage recommendations'], estimatedWords: Math.round(bodyWords * 0.4), isNew: false },
          { id: '3', heading: 'Practical Application', keyPoints: ['Practical setup and use', 'Common mistakes to avoid', 'How to fit it into a weekly routine'], estimatedWords: Math.round(bodyWords * 0.35), isNew: false },
          { id: '4', heading: 'FAQs & Misconceptions', keyPoints: ['Address the most common question', 'Debunk a popular myth', 'Clarify safety or side-effect concerns'], estimatedWords: Math.round(bodyWords * 0.25), isNew: false },
          { id: '5', heading: 'Conclusion & Next Steps', keyPoints: ['Recap key takeaways', 'Recommend a specific product or action', 'Encourage the reader to explore further'], estimatedWords: 200, isNew: false },
        ]
      })()

  const usingFallbackOutline = !analysis.suggestedOutline?.length
  const [outline, setOutline] = useState<OutlineSectionState[]>(initialOutline)

  const [outlineExpanded, setOutlineExpanded] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStep, setGenerationStep] = useState<'idle' | 'content' | 'faq' | 'polishing' | 'linking' | 'saving' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [failedStep, setFailedStep] = useState<'content' | 'faq' | 'polishing' | 'linking' | 'saving' | undefined>(undefined)

  const citationMapping = useMemo(() => {
    if (!analysis?.claims || !Array.isArray(analysis.claims)) return []
    return analysis.claims.map((claim) => ({
      claim: claim.text,
      citationIndex: claim.citationIndex ?? -1,
      citation: claim.citationIndex !== undefined && claim.citationIndex >= 0 ? citations[claim.citationIndex] : null,
    }))
  }, [analysis?.claims, citations])

  const updateSectionHeading = (id: string, newHeading: string) => {
    setOutline(outline.map(s => (s.id === id ? { ...s, heading: newHeading } : s)))
  }

  const updateKeyPoint = (sectionId: string, pointIndex: number, newText: string) => {
    setOutline(
      outline.map(s =>
        s.id === sectionId
          ? {
              ...s,
              keyPoints: s.keyPoints.map((p, i) => (i === pointIndex ? newText : p)),
            }
          : s
      )
    )
  }

  const addKeyPoint = (sectionId: string) => {
    setOutline(
      outline.map(s =>
        s.id === sectionId
          ? {
              ...s,
              keyPoints: [...s.keyPoints, 'New point'],
            }
          : s
      )
    )
  }

  const removeKeyPoint = (sectionId: string, pointIndex: number) => {
    setOutline(
      outline.map(s =>
        s.id === sectionId
          ? {
              ...s,
              keyPoints: s.keyPoints.filter((_, i) => i !== pointIndex),
            }
          : s
      )
    )
  }

  const deleteSection = (id: string) => {
    setOutline(outline.filter(s => s.id !== id))
  }

  const addSection = () => {
    const newId = Math.max(...outline.map(s => parseInt(s.id)), 0) + 1
    setOutline([
      ...outline,
      {
        id: String(newId),
        heading: 'New Section',
        keyPoints: ['Point 1', 'Point 2'],
        estimatedWords: 300,
        isNew: true,
      },
    ])
  }

  // Research/reference domains whose links are worth preserving from the original article.
  // These are study citations that may not have been captured in the formal citations array.
  const RESEARCH_DOMAINS = [
    'pubmed.ncbi.nlm.nih.gov',
    'ncbi.nlm.nih.gov',
    'nih.gov',
    'doi.org',
    'examine.com',
    'sciencedirect.com',
    'nature.com',
    'springer.com',
    'academic.oup.com',
    'biomedcentral.com',
    'journals.physiology.org',
    'mayoclinic.org',
    'healthline.com',
    'medicalnewstoday.com',
  ]

  // Extract internal links AND external research/study links from original article HTML.
  // Deduplicates by URL, skips short/empty anchor text, and filters out URLs already
  // covered by the formal citations array (to avoid double-referencing).
  function extractOriginalLinks(
    html: string,
    existingCitationUrls: Set<string>
  ): { title: string; url: string }[] {
    const links: { title: string; url: string }[] = []
    const seen = new Set<string>()
    const linkRe = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let m: RegExpExecArray | null
    while ((m = linkRe.exec(html)) !== null) {
      const href = m[1]
      const anchorText = m[2].replace(/<[^>]+>/g, '').trim()
      if (!anchorText || anchorText.length < 4) continue
      if (seen.has(href)) continue
      if (existingCitationUrls.has(href)) continue // already in citations pipeline

      const isInternal =
        href.includes('greenthumbdepot.com') ||
        /^\/(blogs|products|collections)\//.test(href)
      const isResearch = RESEARCH_DOMAINS.some(domain => href.includes(domain))

      if (!isInternal && !isResearch) continue
      seen.add(href)
      links.push({ title: anchorText, url: href })
    }
    return links
  }

  const handleGenerate = async () => {
    setError(null)
    setFailedStep(undefined)

    // Validate
    if (outline.some(s => !s.heading.trim())) {
      setError('All section headings must be filled')
      return
    }

    // Extract internal + research links from the original article before generation starts.
    // These will be re-injected into the new content after assembly.
    // Citation URLs are excluded here since they're already woven in via the [1][2] pipeline.
    const citationUrls = new Set(citations.map(c => c.url))
    const originalInternalLinks = extractOriginalLinks(originalContent, citationUrls)

    setIsGenerating(true)
    setGenerationStep('content')

    try {
      // Step 1: Generate body content
      const contentRes = await apiFetch('/api/revamp/generate/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existingContent: originalContent,
          approvedOutline: outline.map(s => ({
            heading: s.heading,
            keyPoints: s.keyPoints,
            isNew: s.isNew,
          })),
          citations,
          category: settings.category,
          keyword: settings.keyword,
          tone: settings.tone,
          wordCount: settings.wordCount,
          includeEmailCapture: false,
        }),
      })

      if (!contentRes.ok) {
        const errorData = await contentRes.json().catch(() => ({}))
        setFailedStep('content')
        throw new Error(errorData.error || 'Content generation failed')
      }

      const { bodyContent } = await contentRes.json()

      // Step 2: FAQ generation
      // NOTE: Images are intentionally NOT generated here. They are added manually
      // via the Workshop > Images module after the article is written, giving full
      // control over placement and quality.
      setGenerationStep('faq')

      const [imageResult, faqResult] = await Promise.all([
        // Images: always skipped at generation time — use Workshop Images module instead
        Promise.resolve({ bodyContent, images: [] }),

        // FAQ generation
        (async () => {
          const faqRes = await apiFetch('/api/revamp/generate/faq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              keyword: settings.keyword,
              category: settings.category,
              titleTag: settings.existingTitle || settings.keyword,
            }),
          })
          if (!faqRes.ok) {
            const errorData = await faqRes.json().catch(() => ({}))
            setFailedStep('faq')
            throw new Error(errorData.error || 'FAQ generation failed')
          }
          return faqRes.json()
        })(),
      ])

      // Use image-enhanced body content if available
      const finalBodyContent = imageResult?.bodyContent || bodyContent
      const { faqHtml, faqItems, faqSchema } = faqResult

      // Step 3: Finalize (assembly + polishing)
      setGenerationStep('polishing')
      const finalRes = await apiFetch('/api/revamp/generate/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bodyContent: finalBodyContent,
          faqHtml: faqHtml || '',
          faqItems: faqItems || [],
          faqSchema: faqSchema || '',
          keyword: settings.keyword,
          category: settings.category,
          titleTag: settings.existingTitle || settings.keyword,
          metaDescription: '',
          existingHandle: settings.existingHandle,
          existingShopifyId: settings.existingShopifyId,
          existingAuthor: settings.existingAuthor || null,
          revampSourceId: settings.revampSourceId,
          sourceUrl: settings.sourceUrl || undefined,
          includeProducts: settings.includeProducts ?? true,
          citations: citations || [],
          tone: settings.tone,
          wordCount: settings.wordCount,
          videoUrl: settings.videoUrl || undefined,
        }),
      })

      if (!finalRes.ok) {
        const errorData = await finalRes.json().catch(() => ({}))
        setFailedStep('polishing')
        throw new Error(errorData.error || 'Assembly failed')
      }

      const finalData = await finalRes.json()
      const serverArticle = finalData.article
      const serverModuleDrafts = finalData.moduleDrafts || undefined

      // Step 4: Re-inject original internal links
      // The rewrite intentionally strips internal links during generation.
      // Here we extract the original links and ask the add-links AI to find
      // natural placements in the new content — without forcing any in.
      setGenerationStep('linking')

      if (originalInternalLinks.length > 0 && serverArticle.dbId && serverArticle.htmlContent) {
        try {
          const linkRes = await apiFetch('/api/articles/add-links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              articleId: serverArticle.dbId,
              htmlContent: serverArticle.htmlContent,
              internalLinks: originalInternalLinks,
            }),
          })
          if (linkRes.ok) {
            const linkData = await linkRes.json()
            if (linkData.htmlContent) {
              serverArticle.htmlContent = linkData.htmlContent
              serverArticle.hasInternalLinks = true
              serverArticle.linkCount = linkData.linkCount || 0
            }
          } else {
            // Non-fatal — log and continue without links
            console.warn('[revamp] Link re-injection failed (non-fatal):', await linkRes.text().catch(() => ''))
          }
        } catch (linkErr) {
          // Non-fatal — article is already saved, linking is a best-effort step
          console.warn('[revamp] Link re-injection error (non-fatal):', linkErr)
        }
      }

      // Step 5: Saving to database
      setGenerationStep('saving')

      // Build article object
      const article: GeneratedArticle = {
        id: serverArticle.id,
        dbId: serverArticle.dbId,
        title: serverArticle.title,
        slug: serverArticle.slug,
        titleTag: serverArticle.titleTag || `${serverArticle.title} | Green Thumb Depot`,
        metaDescription: serverArticle.metaDescription || analysis.claims?.[0]?.text || serverArticle.title,
        content: serverArticle.content || '',
        htmlContent: serverArticle.htmlContent || '',
        featuredImage: serverArticle.featuredImage,
        contentImages: serverArticle.contentImages || [],
        products: serverArticle.products || [],
        faqs: serverArticle.faqs || [],
        schemaMarkup:
          serverArticle.schemaMarkup ||
          generateSchemaMarkup({
            title: serverArticle.title,
            keyword: settings.keyword,
            category: settings.category as any,
          }),
        category: (serverArticle.category || settings.category) as any,
        keyword: serverArticle.keyword || settings.keyword,
        wordCount: serverArticle.wordCount || analysis.wordCount,
        createdAt: new Date(serverArticle.createdAt || Date.now()),
        status: serverArticle.status || 'draft',
        articleType: 'revamp',
        hasInternalLinks: serverArticle.hasInternalLinks || false,
        hasImages: serverArticle.hasImages || false,
        linkCount: serverArticle.linkCount || 0,
        imageCount: serverArticle.imageCount || 0,
        sourceType: 'revamp' as const,
        originalShopifyId: serverArticle.originalShopifyId || settings.existingShopifyId,
        revampSourceId: serverArticle.revampSourceId || settings.revampSourceId,
      }

      setGenerationStep('done')

      // Brief pause to show "done" state before callback
      setTimeout(() => {
        onGenerateComplete(article, serverModuleDrafts)
      }, 1000)
    } catch (err) {
      // If no specific failed step was set, use whatever step was active when the error occurred
      setFailedStep(prev => {
        if (prev) return prev
        // generationStep still holds the active step at time of error
        return undefined
      })
      setGenerationStep('error')
      const message = err instanceof Error ? err.message : 'Generation failed'
      console.error('[revamp] Generation error:', message, err)
      setError(message)
      setIsGenerating(false)
    }
  }

  const stepperStep: RevampStep = isGenerating
    ? (generationStep === 'done' ? 'done' : 'generating')
    : 'review'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Progress Stepper */}
      <div className="flex-shrink-0 border-b px-6" style={{ borderColor: 'var(--border)', background: 'var(--bg-warm)' }}>
        <RevampStepper currentStep={stepperStep} />
      </div>

    <div className="flex flex-1 gap-6 overflow-hidden">
      {isGenerating ? (
        // Progress view
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-6">
          <RevampGenerationProgress currentStep={generationStep} errorMessage={error || undefined} failedStep={failedStep} />

          {/* Retry button for errors */}
          {generationStep === 'error' && (
            <div className="mt-8 flex gap-3">
              <button
                onClick={onBack}
                className="px-4 py-2 rounded-lg border text-[13px] font-medium"
                style={{ color: 'var(--text2)', borderColor: 'var(--border)' }}
              >
                Back to input
              </button>
              <button
                onClick={() => {
                  setError(null)
                  setGenerationStep('idle')
                  setIsGenerating(false)
                }}
                className="px-4 py-2 rounded-lg border text-[13px] font-medium"
                style={{ color: 'var(--text2)', borderColor: 'var(--border)' }}
              >
                Edit outline
              </button>
              <button
                onClick={handleGenerate}
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-white"
                style={{ background: 'var(--gtd-accent)' }}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Left column: Analysis Summary & Citation Mapping */}
          <div className="w-80 flex-shrink-0 overflow-y-auto border-r px-6 py-6" style={{ borderColor: 'var(--border)' }}>
            {/* Source URL */}
            {settings.sourceUrl && (
              <div className="mb-4 p-2 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-warm)' }}>
                <p className="text-[10px] font-mono uppercase tracking-[0.5px] mb-1" style={{ color: 'var(--text4)' }}>Source URL</p>
                <a
                  href={settings.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-mono break-all hover:underline"
                  style={{ color: 'var(--gtd-accent)' }}
                >
                  {settings.sourceUrl}
                </a>
              </div>
            )}

            {/* Analysis Summary */}
            <div className="mb-6">
              <h2 className="text-[11px] font-mono font-medium tracking-[1px] uppercase mb-3" style={{ color: 'var(--text3)' }}>
                Analysis Summary
              </h2>
              <div className="space-y-2">
                <div className="flex justify-between text-[13px]" style={{ color: 'var(--text2)' }}>
                  <span>Word Count:</span>
                  <span className="font-mono font-medium" style={{ color: 'var(--text1)' }}>
                    {(analysis.wordCount ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-[13px]" style={{ color: 'var(--text2)' }}>
                  <span>Headings:</span>
                  <span className="font-mono font-medium" style={{ color: 'var(--text1)' }}>
                    {analysis.headings?.length ?? 0}
                  </span>
                </div>
                <div className="flex justify-between text-[13px]" style={{ color: 'var(--text2)' }}>
                  <span>Links:</span>
                  <span className="font-mono font-medium" style={{ color: 'var(--text1)' }}>
                    {analysis.links}
                  </span>
                </div>
                <div className="flex justify-between text-[13px]" style={{ color: 'var(--text2)' }}>
                  <span>Images:</span>
                  <span className="font-mono font-medium" style={{ color: 'var(--text1)' }}>
                    {analysis.images}
                  </span>
                </div>
                <div className="flex justify-between text-[13px]" style={{ color: 'var(--text2)' }}>
                  <span>Claims:</span>
                  <span className="font-mono font-medium" style={{ color: 'var(--text1)' }}>
                    {analysis.claims?.length ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* Citation Mapping */}
            <div>
              <h2 className="text-[11px] font-mono font-medium tracking-[1px] uppercase mb-3" style={{ color: 'var(--text3)' }}>
                Citation Mapping
              </h2>
              <div className="space-y-3">
                {citationMapping.length > 0 ? (
                  citationMapping.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded border p-2.5 text-[12px]"
                      style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                    >
                      <p className="mb-1.5" style={{ color: 'var(--text1)' }}>
                        {item.claim}
                      </p>
                      {item.citation ? (
                        <div className="text-[11px]" style={{ color: 'var(--text3)' }}>
                          <p className="font-medium truncate">{item.citation.title}</p>
                          <p className="truncate">{item.citation.url}</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px]" style={{ color: '#d69e2e' }}>
                          <AlertCircle className="h-3 w-3" />
                          <span>No source assigned</span>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-[12px]" style={{ color: 'var(--text3)' }}>
                    No claims identified
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right column: Generate CTA + Collapsible Outline */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* ── Top action bar: primary CTA ─────────────────────────────── */}
            <div
              className="flex-shrink-0 px-8 py-5 border-b"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text1)' }}>
                    Ready to generate
                  </p>
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--text3)' }}>
                    {outline.length} section{outline.length !== 1 ? 's' : ''} &middot; ~{outline.reduce((acc, s) => acc + (s.estimatedWords || 0), 0).toLocaleString()} words
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={onBack}
                    className="px-4 py-2 rounded-lg border text-[13px] font-medium"
                    style={{ color: 'var(--text2)', borderColor: 'var(--border)' }}
                    disabled={isGenerating}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleGenerate}
                    className="px-5 py-2.5 rounded-lg text-[14px] font-semibold text-white"
                    style={{ background: 'var(--gtd-accent)', minWidth: '160px' }}
                    disabled={isGenerating}
                  >
                    Generate Article
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 mt-3 text-[12px]" style={{ color: '#c53030' }}>
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>

            {/* ── Collapsible outline section ──────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
              {/* Toggle row */}
              <button
                onClick={() => setOutlineExpanded(v => !v)}
                className="w-full flex items-center justify-between px-8 py-3 border-b text-left"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-warm)' }}
              >
                <span className="text-[13px] font-medium" style={{ color: 'var(--text2)' }}>
                  Edit Outline
                </span>
                <div className="flex items-center gap-1.5" style={{ color: 'var(--text3)' }}>
                  <span className="text-[12px]">{outlineExpanded ? 'Collapse' : 'Expand'}</span>
                  {outlineExpanded
                    ? <ChevronDown className="h-4 w-4" />
                    : <ChevronRight className="h-4 w-4" />
                  }
                </div>
              </button>

              {outlineExpanded && (
                <div className="px-8 py-6">
                  {usingFallbackOutline && (
                    <div
                      className="flex items-start gap-3 rounded-lg border px-4 py-3 mb-5 text-[13px]"
                      style={{ background: '#fef9ec', borderColor: '#f0d78c', color: '#7a5c1e' }}
                    >
                      <AlertCircle size={16} className="mt-0.5 shrink-0" style={{ color: '#b8860b' }} />
                      <div>
                        <span className="font-semibold">Default outline generated.</span>{' '}
                        The AI analysis didn&apos;t return a structured outline for this content, so a standard Green Thumb Depot template has been applied.
                        Feel free to edit the headings and key points below before generating.
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    {outline.map(section => (
                      <div
                        key={section.id}
                        className="rounded-lg border p-4"
                        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                      >
                        {/* Heading */}
                        <div className="flex items-center gap-2 mb-4">
                          <input
                            type="text"
                            value={section.heading}
                            onChange={e => updateSectionHeading(section.id, e.target.value)}
                            className="flex-1 bg-transparent text-[16px] font-semibold outline-none"
                            style={{ color: 'var(--text1)' }}
                          />
                          {section.isNew && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#e8f4f8', color: '#0f6a88' }}>
                              NEW
                            </span>
                          )}
                          {!section.isNew && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#f0f0f0', color: '#666' }}>
                              ORIGINAL
                            </span>
                          )}
                          <button
                            onClick={() => deleteSection(section.id)}
                            className="p-1 rounded hover:bg-red-100"
                            style={{ color: '#c53030' }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        {/* Key Points */}
                        <div className="space-y-2 mb-3">
                          {section.keyPoints.map((point, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="text-[12px] font-mono" style={{ color: 'var(--text4)' }}>
                                •
                              </span>
                              <input
                                type="text"
                                value={point}
                                onChange={e => updateKeyPoint(section.id, idx, e.target.value)}
                                className="flex-1 bg-transparent text-[13px] outline-none"
                                style={{ color: 'var(--text2)' }}
                              />
                              <button
                                onClick={() => removeKeyPoint(section.id, idx)}
                                className="p-0.5 rounded hover:bg-red-100"
                                style={{ color: '#c53030' }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Add Key Point */}
                        <button
                          onClick={() => addKeyPoint(section.id)}
                          className="flex items-center gap-1 text-[12px] px-2 py-1 rounded"
                          style={{ color: 'var(--gtd-accent)' }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add point
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add Section */}
                  <button
                    onClick={addSection}
                    className="mt-6 flex items-center gap-2 px-4 py-2 rounded-lg border-2"
                    style={{ color: 'var(--gtd-accent)', borderColor: 'var(--gtd-accent)' }}
                  >
                    <Plus className="h-4 w-4" />
                    Add Section
                  </button>
                </div>
              )}
            </div>

            {/* ── Footer: secondary actions ────────────────────────────────── */}
            <div
              className="flex-shrink-0 border-t px-8 py-3 flex items-center"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-warm)' }}
            >
              <button
                onClick={onStartOver}
                className="text-[12px] font-medium hover:underline"
                style={{ color: 'var(--text4)' }}
                disabled={isGenerating}
              >
                Start over
              </button>
            </div>
          </div>
        </>
      )}
    </div>
    </div>
  )
}
