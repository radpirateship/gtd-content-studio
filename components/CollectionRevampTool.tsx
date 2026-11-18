// components/CollectionRevampTool.tsx
// Full collection revamp workflow:
//   1. Pick collection (live Shopify list)
//   2. Load full body_html + SEO fields from Shopify Admin API
//   3. Run SEO grade
//   4. Manage keywords (expand to 8+)
//   5. Run Claude AI gap analysis → review suggestions
//   6. Apply approved suggestions to HTML
//   7. Edit HTML freely + edit SEO fields
//   8. Publish to Shopify + mark optimized in DB
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, ChevronDown, ChevronUp, Check, X, Loader2, ExternalLink, Plus, Trash2 } from 'lucide-react'
import type { KeywordSuggestion } from '@/app/api/collections/analyze/route'
import { PREVIEW_HEAD } from '@/lib/theme-css'

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyCollection {
  id: number
  handle: string
  title: string
  body_html: string
  seo_title: string
  seo_description: string
  collection_type: string
  updated_at: string
}

interface DBCollection {
  slug: string
  primary_keyword: string
  secondary_keywords: string[]
  title_tag: string
  meta_description: string
  url: string
  is_optimized: boolean
  improve_notes?: { skipped?: string[]; manual?: string[]; at?: string } | null
}

interface GradeBreakdown {
  total: number
  breakdown: {
    primary_keyword: { score: number; max: number; detail: { inTitle: boolean; inMeta: boolean; inH1orOpening: boolean; inH2: boolean } }
    keyword_coverage: { score: number; max: number; present: number; total: number; keywords: Array<{ keyword: string; present: boolean; inH2: boolean }> }
    technical: { score: number; max: number; detail: { title_length: number; title_ok: boolean; meta_length: number; meta_ok: boolean; word_count: number; content_ok: boolean } }
    article_links: { score: number; max: number; has_any_article_link: boolean; has_hub_article_link: boolean }
  }
  meta: { h1: string; h2_count: number; h2s: string[]; word_count: number }
}

interface SuggestionState extends KeywordSuggestion {
  approved: boolean | null  // null = undecided
}

interface Props {
  initialHandle?: string | null
  onBack?: () => void
  onHandleConsumed?: () => void
}

// ── Helper components ────────────────────────────────────────────────────────

function ScoreBadge({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? score / max : 0
  const color = pct >= 0.8 ? '#38a169' : pct >= 0.6 ? '#d4930a' : '#e53e3e'
  return (
    <span style={{ fontWeight: 700, color, fontSize: 13 }}>{score}/{max}</span>
  )
}

function GradeRing({ total }: { total: number }) {
  const color = total >= 80 ? '#38a169' : total >= 60 ? '#d4930a' : '#e53e3e'
  const label = total >= 80 ? 'Good' : total >= 60 ? 'Fair' : 'Needs Work'
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        border: `6px solid ${color}`, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', margin: '0 auto',
      }}>
        <span style={{ fontSize: 22, fontWeight: 800, color }}>{total}</span>
      </div>
      <div style={{ fontSize: 12, color, fontWeight: 600, marginTop: 6 }}>{label}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────


// Defensive JSON parse: gateway timeouts and cold-start crashes return empty
// or HTML bodies — res.json() then throws "Unexpected end of JSON input"
// with no clue which call failed. This names the endpoint and status instead.
async function safeJson(res: Response, label: string): Promise<any> {
  const text = await res.text()
  if (!text.trim()) {
    if (!res.ok) throw new Error(`${label}: server error ${res.status} (empty response — likely a timeout, try again)`)
    return {}
  }
  try { return JSON.parse(text) } catch {
    throw new Error(`${label}: server returned non-JSON (${res.status}): ${text.slice(0, 120)}`)
  }
}

export function CollectionRevampTool({ initialHandle, onHandleConsumed, onBack }: Props) {
  // Collection picker
  const [allCollections, setAllCollections] = useState<Array<{ handle: string; title: string }>>([])
  const [pickSearch, setPickSearch] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [selectedHandle, setSelectedHandle] = useState<string>('')
  const pickerRef = useRef<HTMLDivElement>(null)

  // Loaded data
  const [shopifyCol, setShopifyCol] = useState<ShopifyCollection | null>(null)
  const [dbCol, setDbCol] = useState<DBCollection | null>(null)
  const [loadingCol, setLoadingCol] = useState(false)
  const [loadError, setLoadError] = useState('')

  // Working state
  const [bodyHtml, setBodyHtml] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [newKw, setNewKw] = useState('')

  // Grade
  const [grade, setGrade] = useState<GradeBreakdown | null>(null)
  const [grading, setGrading] = useState(false)

  // AI analysis
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestions, setSuggestions] = useState<SuggestionState[]>([])
  const [analyzeError, setAnalyzeError] = useState('')

  // Publishing
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<{ success: boolean; message: string } | null>(null)
  const [improveDraft, setImproveDraft] = useState<{ bodyHtml: string; seoTitle: string; seoDescription: string; scoreBefore?: number; scoreAfter?: number } | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [fixingNote, setFixingNote] = useState<string | null>(null)
  const [fixedNotes, setFixedNotes] = useState<Record<string, string>>({})

  const noteAction = (note: string): string | null => {
    if (/^T\d+ /.test(note)) return null // task verdicts: fix root cause, then rerun Improve
    if (/featured products|product tiles/i.test(note)) return 'featured-products'
    if (/banned phrases/i.test(note)) return 'banned-phrases'
    return null
  }

  const runNoteFix = async (note: string) => {
    const action = noteAction(note)
    if (!action || !selectedHandle) return
    setFixingNote(note)
    try {
      const res = await fetch('/api/collections/fix-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: selectedHandle, action, bodyHtml, collectionTitle: shopifyCol?.title || '' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fix failed')
      if (data.changed && data.html) {
        setBodyHtml(data.html)
        setFixedNotes((prev) => ({ ...prev, [note]: data.message }))
        setActiveSection('preview')
      } else {
        setFixedNotes((prev) => ({ ...prev, [note]: data.message || 'Nothing to change' }))
      }
    } catch (e) {
      setFixedNotes((prev) => ({ ...prev, [note]: `Failed: ${e instanceof Error ? e.message : 'error'}` }))
    } finally {
      setFixingNote(null)
    }
  }

  // Active section tabs
  type Section = 'grade' | 'keywords' | 'suggestions' | 'editor' | 'seo' | 'preview'
  const [activeSection, setActiveSection] = useState<Section>('grade')

  // Load live Shopify collection list once
  useEffect(() => {
    fetch('/api/shopify/collections')
      .then(r => r.json())
      .then(data => setAllCollections(data.collections || []))
      .catch(console.error)
  }, [])

  // Handle initialHandle from audit queue
  useEffect(() => {
    if (initialHandle && initialHandle !== selectedHandle) {
      setSelectedHandle(initialHandle)
      onHandleConsumed?.()
    }
  }, [initialHandle]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load when handle changes
  useEffect(() => {
    if (selectedHandle) loadCollection(selectedHandle)
  }, [selectedHandle]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const loadCollection = useCallback(async (handle: string) => {
    setLoadingCol(true)
    setLoadError('')
    setGrade(null)
    setSuggestions([])
    setPublishResult(null)
    setImproveDraft(null)
    setDraftLoaded(false)
    setActiveSection('grade')

    try {
      // Fetch from Shopify and DB in parallel
      const [shopifyRes, dbRes] = await Promise.all([
        fetch(`/api/shopify/collection-revamp/${handle}`),
        fetch(`/api/collections/${handle}`),
      ])

      const shopifyData: ShopifyCollection = await safeJson(shopifyRes, 'Load collection from Shopify')
      if (!shopifyRes.ok) throw new Error((shopifyData as any).error || `Failed to load from Shopify (${shopifyRes.status})`)
      setShopifyCol(shopifyData)
      setBodyHtml(shopifyData.body_html || '')
      // Unpublished Improve draft available?
      fetch(`/api/collections/improve?slug=${encodeURIComponent(handle)}`)
        .then((r) => (r.ok ? safeJson(r, 'Load Improve draft') : null))
        .then((d) => { if (d && d.bodyHtml) setImproveDraft(d) })
        .catch(() => {})
      setSeoTitle(shopifyData.seo_title || shopifyData.title || '')
      setSeoDescription(shopifyData.seo_description || '')

      // DB data (optional — collection may not be in ppw_collections yet)
      // Track locally so we can pass to runGrade before React state settles
      let dbColForGrade: DBCollection | null = null
      if (dbRes.ok) {
        const dbData = await safeJson(dbRes, 'Load collection record')
        const col: DBCollection = dbData.collection
        dbColForGrade = col
        setDbCol(col)
        // Seed keywords from DB: primary first, then secondaries
        const kwList = col.primary_keyword
          ? [col.primary_keyword, ...(col.secondary_keywords || [])]
          : col.secondary_keywords || []
        setKeywords([...new Set(kwList.filter(Boolean))])
        // Use DB seo fields if Shopify ones are empty
        if (!shopifyData.seo_title && col.title_tag) setSeoTitle(col.title_tag)
        if (!shopifyData.seo_description && col.meta_description) setSeoDescription(col.meta_description)
      } else {
        setDbCol(null)
        setKeywords([])
      }

      // Auto-run grade (pass dbColForGrade directly — keywords state hasn't settled yet)
      await runGrade(
        shopifyData.body_html || '',
        shopifyData.seo_title || shopifyData.title || '',
        shopifyData.seo_description || '',
        dbColForGrade
      )
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load collection')
    } finally {
      setLoadingCol(false)
    }
  }, [])

  const runGrade = async (
    html: string,
    title: string,
    meta: string,
    dbColData?: DBCollection | null
  ) => {
    const kwToUse = dbColData
      ? [dbColData.primary_keyword, ...(dbColData.secondary_keywords || [])].filter(Boolean)
      : keywords
    if (!kwToUse.length) return

    setGrading(true)
    try {
      const res = await fetch('/api/collections/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_html: html,
          seo_title: title,
          seo_description: meta,
          primary_keyword: kwToUse[0],
          keywords: kwToUse,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setGrade(data)

      }
    } catch (err) {
      console.error('Grade error:', err)
    } finally {
      setGrading(false)
    }
  }

  const reGrade = () => runGrade(bodyHtml, seoTitle, seoDescription)

  const addKeyword = () => {
    const kw = newKw.trim()
    if (kw && !keywords.includes(kw)) {
      setKeywords(prev => [...prev, kw])
    }
    setNewKw('')
  }

  const removeKeyword = (kw: string) => setKeywords(prev => prev.filter(k => k !== kw))

  // ── Ahrefs secondary-keyword scan ─────────────────────────────────────────
  const [kwScanning, setKwScanning] = useState(false)
  const [kwSuggestions, setKwSuggestions] = useState<Array<{ keyword: string; volume: number | null; difficulty: number | null; opportunity: number }>>([])
  const [kwScanError, setKwScanError] = useState<string | null>(null)

  const scanSecondaryKeywords = async () => {
    const seed = keywords[0]
    if (!seed) { setKwScanError('Set a primary keyword first (the first keyword in the list).'); return }
    setKwScanning(true); setKwScanError(null); setKwSuggestions([])
    try {
      const res = await fetch('/api/collections/keyword-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, exclude: keywords }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')
      setKwSuggestions(data.suggestions || [])
      if (!data.suggestions?.length) setKwScanError('No new keyword opportunities found for that seed.')
    } catch (e) {
      setKwScanError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setKwScanning(false)
    }
  }

  const addSuggestedKeyword = (kw: string) => {
    if (kw && !keywords.includes(kw)) setKeywords(prev => [...prev, kw])
    setKwSuggestions(prev => prev.filter(s => s.keyword !== kw))
  }

  // Reorder keywords — position 0 IS the primary (saved as primary_keyword on
  // publish/save). Used by drag-drop, the ★ make-primary button, and ▲▼.
  const kwDragIdx = useRef<number | null>(null)
  const moveKeyword = (from: number, to: number) => {
    if (to < 0 || from === to) return
    setKeywords(prev => {
      if (from >= prev.length || to >= prev.length) return prev
      const next = [...prev]
      const [k] = next.splice(from, 1)
      next.splice(to, 0, k)
      return next
    })
  }

  // Persist the keyword list to the collections DB independently of publishing.
  const [savingKeywords, setSavingKeywords] = useState(false)
  const [saveKwMsg, setSaveKwMsg] = useState<string | null>(null)
  const saveKeywords = async () => {
    if (!selectedHandle) return
    setSavingKeywords(true); setSaveKwMsg(null)
    try {
      const res = await fetch(`/api/collections/${selectedHandle}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_keyword: keywords[0] || '', secondary_keywords: keywords.slice(1) }),
      })
      if (res.ok) { setSaveKwMsg('Keywords saved'); }
      else {
        const err = await res.json().catch(() => ({}))
        setSaveKwMsg(res.status === 404 ? 'No DB record yet - keywords will save on first publish.' : (err.error || 'Save failed'))
      }
    } catch (e) { setSaveKwMsg(e instanceof Error ? e.message : 'Save failed') }
    finally { setSavingKeywords(false) }
  }

  // Title + meta tag generator (2 options each from all keywords)
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [titleOptions, setTitleOptions] = useState<string[]>([])
  const [descOptions, setDescOptions] = useState<string[]>([])
  const generateSeo = async () => {
    setGenLoading(true); setGenError(null); setTitleOptions([]); setDescOptions([])
    try {
      const res = await fetch('/api/collections/seo-suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection_title: selectedTitle || selectedHandle, keywords, current_title: seoTitle, current_description: seoDescription }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setTitleOptions(data.titles || []); setDescOptions(data.descriptions || [])
      if (!(data.titles?.length || data.descriptions?.length)) setGenError('No options generated.')
    } catch (e) { setGenError(e instanceof Error ? e.message : 'Generation failed') }
    finally { setGenLoading(false) }
  }

  const runAnalysis = async () => {
    if (!shopifyCol || !grade) return
    const missing = grade.breakdown.keyword_coverage.keywords
      .filter(k => !k.present)
      .map(k => k.keyword)
    if (!missing.length) {
      setAnalyzeError('No missing keywords to analyze — all keywords are already present!')
      return
    }
    const present = grade.breakdown.keyword_coverage.keywords
      .filter(k => k.present)
      .map(k => k.keyword)

    setAnalyzing(true)
    setAnalyzeError('')
    setSuggestions([])
    setActiveSection('suggestions')

    try {
      const res = await fetch('/api/collections/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_html: bodyHtml,
          collection_title: shopifyCol.title,
          primary_keyword: keywords[0] || '',
          missing_keywords: missing,
          present_keywords: present,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Analysis failed')
      }
      const data = await res.json()
      setSuggestions((data.suggestions || []).map((s: KeywordSuggestion) => ({ ...s, approved: null })))
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const approveSuggestion = (idx: number, approved: boolean) => {
    setSuggestions(prev => prev.map((s, i) => i === idx ? { ...s, approved } : s))
  }

  const applyApproved = () => {
    let html = bodyHtml
    const approved = suggestions.filter(s => s.approved === true)
    for (const s of approved) {
      if (s.type === 'new_paragraph') {
        // Append before the last closing tag or at the end
        html = html.replace(/(<\/section>|<\/div>)\s*$/, `\n<p>${s.suggested_text}</p>\n$1`)
        if (!html.includes(s.suggested_text)) {
          html += `\n<p>${s.suggested_text}</p>`
        }
      } else if (s.original_text && s.original_text.length > 0) {
        html = html.replace(s.original_text, s.suggested_text)
      }
    }
    setBodyHtml(html)
    setActiveSection('editor')
    // Re-run grade with updated html
    setTimeout(() => runGrade(html, seoTitle, seoDescription), 300)
  }

  const publish = async () => {
    if (!selectedHandle) return
    setPublishing(true)
    setPublishResult(null)

    try {
      // 1. Update Shopify
      const shopifyRes = await fetch(`/api/shopify/collection-revamp/${selectedHandle}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_html: bodyHtml, seo_title: seoTitle, seo_description: seoDescription }),
      })
      if (!shopifyRes.ok) {
        const err = await shopifyRes.json()
        throw new Error(err.error || 'Shopify update failed')
      }

      // 2. Update DB record if it exists
      if (dbCol) {
        await fetch(`/api/collections/${selectedHandle}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title_tag: seoTitle,
            meta_description: seoDescription,
            primary_keyword: keywords[0] || '',
            secondary_keywords: keywords.slice(1),
            is_optimized: true,
          }),
        })
      }

      setPublishResult({ success: true, message: 'Published to Shopify ✓' })
      // If we published a loaded Improve draft, clear it so the queue's DRAFT chip goes away.
      if (draftLoaded) {
        fetch(`/api/collections/improve?slug=${encodeURIComponent(selectedHandle)}`, { method: 'DELETE' }).catch(() => {})
        setImproveDraft(null)
        setDraftLoaded(false)
      }
      // Re-grade locally, then push the refreshed score to the Audit Queue by
      // re-auditing just this collection (so its queue score + rank update).
      await runGrade(bodyHtml, seoTitle, seoDescription)
      try {
        await fetch(`/api/collections/grade-all?slug=${encodeURIComponent(selectedHandle)}`, { method: 'POST' })
      } catch { /* queue refresh is best-effort */ }
    } catch (err) {
      setPublishResult({ success: false, message: err instanceof Error ? err.message : 'Publish failed' })
    } finally {
      setPublishing(false)
    }
  }

  // ── Filtered picker list ──────────────────────────────────────────────────
  const filteredCollections = allCollections.filter(c =>
    !pickSearch || c.handle.includes(pickSearch.toLowerCase()) || c.title.toLowerCase().includes(pickSearch.toLowerCase())
  ).slice(0, 50)

  const selectedTitle = allCollections.find(c => c.handle === selectedHandle)?.title

  // ── Missing keyword count ─────────────────────────────────────────────────
  const missingCount = grade?.breakdown.keyword_coverage.keywords.filter(k => !k.present).length ?? 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, maxWidth: 1100, fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ppw-accent)' }}>Collection Revamp</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text3)', fontSize: 13 }}>
          Load a Shopify collection, grade its SEO, inject missing keywords with AI, then publish.
        </p>
      </div>

      {/* ── Collection picker ── */}
      <div style={{ marginBottom: 24, position: 'relative' }} ref={pickerRef}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>
          Collection
        </label>
        <div
          onClick={() => setShowPicker(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 7,
            background: 'var(--bg)', cursor: 'pointer', fontSize: 14, color: 'var(--text1)',
            minWidth: 400,
          }}
        >
          <span style={{ color: selectedHandle ? 'var(--text1)' : 'var(--text4)' }}>
            {selectedHandle ? `${selectedHandle}${selectedTitle ? ` — ${selectedTitle}` : ''}` : 'Select a collection…'}
          </span>
          {showPicker ? <ChevronUp className="h-4 w-4" style={{ color: 'var(--text3)', flexShrink: 0 }} /> : <ChevronDown className="h-4 w-4" style={{ color: 'var(--text3)', flexShrink: 0 }} />}
        </div>

        {showPicker && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 4,
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', width: 480,
          }}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
              <input
                autoFocus
                placeholder="Search collections…"
                value={pickSearch}
                onChange={e => setPickSearch(e.target.value)}
                style={{
                  width: '100%', padding: '6px 10px', border: '1px solid var(--border)',
                  borderRadius: 5, fontSize: 13, background: 'var(--surface)', color: 'var(--text1)',
                }}
              />
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {filteredCollections.map(c => (
                <div
                  key={c.handle}
                  onClick={() => { setSelectedHandle(c.handle); setShowPicker(false); setPickSearch('') }}
                  style={{
                    padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                    background: selectedHandle === c.handle ? 'var(--ppw-accent-light)' : undefined,
                    color: selectedHandle === c.handle ? 'var(--ppw-accent)' : 'var(--text1)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                  onMouseEnter={e => { if (selectedHandle !== c.handle) (e.currentTarget as HTMLElement).style.background = 'var(--surface)' }}
                  onMouseLeave={e => { if (selectedHandle !== c.handle) (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.handle}</span>
                  <span style={{ color: 'var(--text3)', fontSize: 11, marginLeft: 12 }}>{c.title}</span>
                </div>
              ))}
              {filteredCollections.length === 0 && (
                <div style={{ padding: '20px 14px', color: 'var(--text4)', fontSize: 13 }}>No collections found</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Loading state ── */}
      {loadingCol && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text3)', padding: '20px 0' }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span style={{ fontSize: 13 }}>Loading collection from Shopify…</span>
        </div>
      )}

      {loadError && (
        <div style={{ padding: '12px 16px', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 7, color: '#c53030', fontSize: 13, marginBottom: 16 }}>
          {loadError}
        </div>
      )}

      {/* ── Content (shown once collection is loaded) ── */}
      {shopifyCol && !loadingCol && (
        <>
          {/* Collection meta bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20,
            padding: '10px 14px', background: 'var(--surface)', borderRadius: 7,
            border: '1px solid var(--border)', fontSize: 13,
          }}>
            <span style={{ fontWeight: 600, color: 'var(--text1)' }}>{shopifyCol.title}</span>
            <span style={{ color: 'var(--text4)' }}>·</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>{selectedHandle}</span>
            <span style={{ color: 'var(--text4)' }}>·</span>
            <span style={{ fontSize: 11, color: 'var(--text4)' }}>{shopifyCol.collection_type} collection</span>
            {shopifyCol.updated_at && (
              <>
                <span style={{ color: 'var(--text4)' }}>·</span>
                <span style={{ fontSize: 11, color: 'var(--text4)' }}>
                  Last updated {new Date(shopifyCol.updated_at).toLocaleDateString()}
                </span>
              </>
            )}
            <a
              href={`https://peakprimalwellness.com/collections/${selectedHandle}`}
              target="_blank" rel="noreferrer"
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--ppw-accent)', fontSize: 12, textDecoration: 'none' }}
            >
              View live <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {onBack && (
            <button
              onClick={onBack}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 14 }}
            >
              &larr; Back to Audit Queue
            </button>
          )}

          {/* Unpublished Improve draft — load into the editor for review */}
          {improveDraft && !draftLoaded && (
            <div style={{ border: '1px solid #1d4ed855', background: 'rgba(29,78,216,0.07)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>Improve draft ready for review{improveDraft.scoreBefore != null ? ` (score ${improveDraft.scoreBefore} → ${improveDraft.scoreAfter})` : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>The editor below still shows the LIVE page. Load the draft to review and finish it here — nothing publishes until you publish.</div>
              </div>
              <button
                onClick={() => {
                  setBodyHtml(improveDraft.bodyHtml)
                  if (improveDraft.seoTitle) setSeoTitle(improveDraft.seoTitle)
                  if (improveDraft.seoDescription) setSeoDescription(improveDraft.seoDescription)
                  setDraftLoaded(true)
                  setActiveSection('preview')
                }}
                style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
              >
                Load draft into editor
              </button>
            </div>
          )}
          {draftLoaded && (
            <div style={{ fontSize: 11, color: '#1d4ed8', marginBottom: 12 }}>Improve draft loaded — editing the draft, not the live page. Publishing pushes the draft (with your edits) live.</div>
          )}

          {/* Leftover work carried over from the Improve run */}
          {dbCol?.improve_notes && ((dbCol.improve_notes.skipped?.length || 0) + (dbCol.improve_notes.manual?.length || 0) > 0) && (
            <div style={{ border: '1px solid #f59e0b55', background: 'rgba(245,158,11,0.08)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 4 }}>
                Left over from Improve{dbCol.improve_notes.at ? ` (${new Date(dbCol.improve_notes.at).toLocaleDateString()})` : ''} — finish these here:
              </div>
              {[...(dbCol.improve_notes.skipped || []).map((x) => ({ x, icon: '✗' })), ...(dbCol.improve_notes.manual || []).map((x) => ({ x, icon: '✋' }))].map(({ x, icon }, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text1)', padding: '3px 0' }}>
                  <span style={{ flex: 1 }}>{fixedNotes[x] ? '✓ ' : icon + ' '}{x}{fixedNotes[x] ? <span style={{ color: '#15803d', fontWeight: 600 }}> — {fixedNotes[x]}</span> : null}</span>
                  {noteAction(x) && !fixedNotes[x] && (
                    <button
                      onClick={() => runNoteFix(x)}
                      disabled={fixingNote !== null}
                      style={{ flexShrink: 0, background: '#b45309', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                    >
                      {fixingNote === x ? 'Fixing...' : 'Fix'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Section tabs */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
            {([
              { id: 'grade', label: `SEO Grade${grade ? ` (${grade.total})` : ''}` },
              { id: 'keywords', label: `Keywords (${keywords.length})` },
              { id: 'suggestions', label: `AI Suggestions${suggestions.length ? ` (${suggestions.filter(s => s.approved === null).length} pending)` : ''}` },
              { id: 'editor', label: 'HTML Editor' },
              { id: 'preview', label: 'Page Preview' },
              { id: 'seo', label: 'SEO Fields' },
            ] as { id: Section; label: string }[]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                style={{
                  padding: '8px 16px', fontSize: 13, border: 'none', cursor: 'pointer',
                  borderBottom: activeSection === tab.id ? '2px solid var(--ppw-accent)' : '2px solid transparent',
                  background: 'transparent',
                  color: activeSection === tab.id ? 'var(--ppw-accent)' : 'var(--text3)',
                  fontWeight: activeSection === tab.id ? 600 : 400,
                  marginBottom: -1,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab: SEO Grade ── */}
          {activeSection === 'grade' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text1)' }}>SEO Grade</h3>
                <button
                  onClick={reGrade}
                  disabled={grading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '6px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                    background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)',
                  }}
                >
                  {grading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Re-grade
                </button>
              </div>

              {grading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Grading…</div>}

              {grade && !grading && (
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 24, alignItems: 'start' }}>
                  {/* Score ring */}
                  <GradeRing total={grade.total} />

                  {/* Breakdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Primary keyword */}
                    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>Primary Keyword</span>
                        <ScoreBadge score={grade.breakdown.primary_keyword.score} max={40} />
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[
                          { label: 'Title Tag', ok: grade.breakdown.primary_keyword.detail.inTitle },
                          { label: 'Meta Description', ok: grade.breakdown.primary_keyword.detail.inMeta },
                          { label: 'H1 / Opening', ok: grade.breakdown.primary_keyword.detail.inH1orOpening },
                          { label: 'H2', ok: grade.breakdown.primary_keyword.detail.inH2 },
                        ].map(({ label, ok }) => (
                          <span key={label} style={{
                            display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                            padding: '2px 8px', borderRadius: 10,
                            background: ok ? '#c6f6d5' : '#fff5f5',
                            color: ok ? '#276749' : '#c53030',
                          }}>
                            {ok ? '✓' : '✗'} {label}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Keyword coverage */}
                    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>
                          Keyword Coverage — {grade.breakdown.keyword_coverage.present}/{grade.breakdown.keyword_coverage.total} present
                        </span>
                        <ScoreBadge score={grade.breakdown.keyword_coverage.score} max={30} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {grade.breakdown.keyword_coverage.keywords.map(k => (
                          <span key={k.keyword} style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 10,
                            background: k.present ? '#c6f6d5' : '#fff5f5',
                            color: k.present ? '#276749' : '#c53030',
                          }}>
                            {k.present ? '✓' : '✗'} {k.keyword}
                            {k.inH2 && <span style={{ opacity: 0.7 }}> (H2)</span>}
                          </span>
                        ))}
                      </div>
                      {missingCount > 0 && (
                        <button
                          onClick={runAnalysis}
                          disabled={analyzing}
                          style={{
                            marginTop: 10, display: 'flex', alignItems: 'center', gap: 6,
                            padding: '7px 14px', fontSize: 12, fontWeight: 600,
                            background: 'var(--ppw-accent)', color: '#fff',
                            border: 'none', borderRadius: 6, cursor: analyzing ? 'wait' : 'pointer',
                          }}
                        >
                          {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          {analyzing ? 'Analyzing…' : `Analyze ${missingCount} missing keyword${missingCount !== 1 ? 's' : ''} with AI`}
                        </button>
                      )}
                      {missingCount === 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#276749', fontWeight: 600 }}>
                          ✓ All keywords present in page content
                        </div>
                      )}
                    </div>

                    {/* Technical */}
                    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>Technical</span>
                        <ScoreBadge score={grade.breakdown.technical.score} max={15} />
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: grade.breakdown.technical.detail.title_ok ? '#c6f6d5' : '#fff5f5', color: grade.breakdown.technical.detail.title_ok ? '#276749' : '#c53030' }}>
                          Title: {grade.breakdown.technical.detail.title_length} chars {grade.breakdown.technical.detail.title_ok ? '✓' : '(aim 40–70)'}
                        </span>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: grade.breakdown.technical.detail.meta_ok ? '#c6f6d5' : '#fff5f5', color: grade.breakdown.technical.detail.meta_ok ? '#276749' : '#c53030' }}>
                          Meta: {grade.breakdown.technical.detail.meta_length} chars {grade.breakdown.technical.detail.meta_ok ? '✓' : '(aim 100–165)'}
                        </span>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: grade.breakdown.technical.detail.content_ok ? '#c6f6d5' : '#fff5f5', color: grade.breakdown.technical.detail.content_ok ? '#276749' : '#c53030' }}>
                          Content: {grade.breakdown.technical.detail.word_count.toLocaleString()} words {grade.breakdown.technical.detail.content_ok ? '✓' : '(aim 350+)'}
                        </span>
                      </div>
                    </div>

                    {/* Article links */}
                    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>Internal Article Links</span>
                        <ScoreBadge score={grade.breakdown.article_links.score} max={15} />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: grade.breakdown.article_links.has_any_article_link ? '#c6f6d5' : '#fff5f5', color: grade.breakdown.article_links.has_any_article_link ? '#276749' : '#c53030' }}>
                          {grade.breakdown.article_links.has_any_article_link ? '✓' : '✗'} Article link in body
                        </span>
                      </div>
                    </div>

                    {/* H2 info */}
                    {grade.meta.h2s.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 0' }}>
                        <strong style={{ color: 'var(--text2)' }}>H2s ({grade.meta.h2_count}):</strong>{' '}
                        {grade.meta.h2s.join(' · ')}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Keywords ── */}
          {activeSection === 'keywords' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text1)' }}>Target Keywords</h3>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {keywords.length} keywords · first is primary
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, maxWidth: 560 }}>
                {keywords.map((kw, idx) => {
                  const gradeKw = grade?.breakdown.keyword_coverage.keywords.find(k => k.keyword === kw)
                  return (
                    <div key={kw}
                      draggable
                      onDragStart={() => { kwDragIdx.current = idx }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => { if (kwDragIdx.current !== null) moveKeyword(kwDragIdx.current, idx); kwDragIdx.current = null }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', background: 'var(--bg)',
                        border: '1px solid var(--border)', borderRadius: 7, cursor: 'grab',
                      }}>
                      <span title="Drag to reorder — first keyword is the primary" style={{ color: 'var(--text4)', fontSize: 13, letterSpacing: 1, userSelect: 'none' }}>⠿</span>
                      <span style={{ fontSize: 11, color: 'var(--text4)', fontFamily: 'monospace', width: 20 }}>{idx + 1}</span>
                      {idx === 0 && (
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: 'var(--ppw-accent-light)', color: 'var(--ppw-accent)', fontWeight: 700 }}>
                          PRIMARY
                        </span>
                      )}
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--text1)' }}>{kw}</span>
                      {gradeKw && (
                        <span style={{
                          fontSize: 11, padding: '1px 7px', borderRadius: 8,
                          background: gradeKw.present ? '#c6f6d5' : '#fff5f5',
                          color: gradeKw.present ? '#276749' : '#c53030',
                        }}>
                          {gradeKw.present ? '✓ present' : '✗ missing'}
                        </span>
                      )}
                      {idx > 0 && (
                        <button onClick={() => moveKeyword(idx, 0)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b3903f', padding: 2, fontSize: 14, lineHeight: 1 }}
                          title="Make this the PRIMARY keyword">★</button>
                      )}
                      <button onClick={() => moveKeyword(idx, idx - 1)} disabled={idx === 0}
                        style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? 'var(--border)' : 'var(--text3)', padding: 2, fontSize: 12, lineHeight: 1 }}
                        title="Move up">▲</button>
                      <button onClick={() => moveKeyword(idx, idx + 1)} disabled={idx === keywords.length - 1}
                        style={{ background: 'none', border: 'none', cursor: idx === keywords.length - 1 ? 'default' : 'pointer', color: idx === keywords.length - 1 ? 'var(--border)' : 'var(--text3)', padding: 2, fontSize: 12, lineHeight: 1 }}
                        title="Move down">▼</button>
                      <button
                        onClick={() => removeKeyword(kw)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', padding: 2 }}
                        title="Remove keyword"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>

              {/* Add keyword */}
              <div style={{ display: 'flex', gap: 8, maxWidth: 560 }}>
                <input
                  placeholder="Add a keyword…"
                  value={newKw}
                  onChange={e => setNewKw(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addKeyword() }}
                  style={{
                    flex: 1, padding: '8px 12px', border: '1px solid var(--border)',
                    borderRadius: 7, fontSize: 13, background: 'var(--bg)', color: 'var(--text1)',
                  }}
                />
                <button
                  onClick={addKeyword}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '8px 14px', background: 'var(--ppw-accent)', color: '#fff',
                    border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>

              {/* Ahrefs secondary-keyword scan */}
              <div style={{ marginTop: 20, maxWidth: 560 }}>
                <button
                  onClick={scanSecondaryKeywords}
                  disabled={kwScanning || keywords.length === 0}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                    fontSize: 13, borderRadius: 7, fontWeight: 600,
                    cursor: kwScanning || keywords.length === 0 ? 'default' : 'pointer',
                    background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text1)',
                    opacity: kwScanning ? 0.7 : 1,
                  }}
                >
                  {kwScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {kwScanning ? 'Scanning Ahrefs…' : 'Scan Ahrefs for secondary keywords'}
                </button>
                <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
                  Finds keywords related to your primary keyword ({keywords[0] || '—'}) that you don&apos;t already target, ranked by opportunity.
                </p>

                {kwScanError && <p style={{ fontSize: 12, color: '#c53030', marginTop: 8 }}>{kwScanError}</p>}

                {kwSuggestions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                    {kwSuggestions.map(s => (
                      <div key={s.keyword} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 12px', background: 'var(--bg)',
                        border: '1px solid var(--border)', borderRadius: 7,
                      }}>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--text1)' }}>{s.keyword}</span>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>vol {s.volume ?? '—'}</span>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>KD {s.difficulty ?? '—'}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ppw-accent)' }}>opp {s.opportunity}</span>
                        <button
                          onClick={() => addSuggestedKeyword(s.keyword)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                            fontSize: 12, background: 'var(--ppw-accent)', color: '#fff',
                            border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" /> Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={reGrade}
                  disabled={grading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                    fontSize: 12, borderRadius: 6, cursor: 'pointer',
                    background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)',
                  }}
                >
                  {grading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Re-grade with updated keywords
                </button>
                <button
                  onClick={saveKeywords}
                  disabled={savingKeywords || keywords.length === 0}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                    fontSize: 12, borderRadius: 6, fontWeight: 600,
                    cursor: savingKeywords || keywords.length === 0 ? 'default' : 'pointer',
                    background: 'var(--ppw-accent)', border: 'none', color: '#fff',
                  }}
                >
                  {savingKeywords ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Save keywords to database
                </button>
                {saveKwMsg && <span style={{ fontSize: 12, color: 'var(--text3)' }}>{saveKwMsg}</span>}
              </div>
            </div>
          )}

          {/* ── Tab: AI Suggestions ── */}
          {activeSection === 'suggestions' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text1)' }}>AI Keyword Suggestions</h3>
                {suggestions.length > 0 && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setSuggestions(prev => prev.map(s => ({ ...s, approved: true })))}
                      style={{ fontSize: 12, padding: '5px 10px', borderRadius: 5, border: '1px solid #9ae6b4', background: '#c6f6d5', color: '#276749', cursor: 'pointer' }}
                    >
                      Approve all
                    </button>
                    <button
                      onClick={() => setSuggestions(prev => prev.map(s => ({ ...s, approved: false })))}
                      style={{ fontSize: 12, padding: '5px 10px', borderRadius: 5, border: '1px solid #fed7d7', background: '#fff5f5', color: '#c53030', cursor: 'pointer' }}
                    >
                      Reject all
                    </button>
                  </div>
                )}
              </div>

              {analyzing && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text3)', padding: '20px 0' }}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span style={{ fontSize: 13 }}>Claude is analyzing the page content…</span>
                </div>
              )}

              {analyzeError && (
                <div style={{ padding: '12px 16px', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 7, color: '#c53030', fontSize: 13, marginBottom: 16 }}>
                  {analyzeError}
                </div>
              )}

              {!analyzing && suggestions.length === 0 && (
                <div style={{ color: 'var(--text3)', fontSize: 13, padding: '20px 0' }}>
                  {!grade ? (
                    <span>Run the SEO Grade first (SEO Grade tab), then come back here to analyze.</span>
                  ) : (
                    <div>
                      <p style={{ marginBottom: 12 }}>Run the AI analysis to find where to insert your missing keywords into the page content.</p>
                      <button
                        onClick={runAnalysis}
                        disabled={analyzing}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                          background: 'var(--ppw-accent)', color: '#fff', border: 'none', borderRadius: 7,
                          fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Run AI analysis
                      </button>
                    </div>
                  )}
                </div>
              )}

              {suggestions.map((s, idx) => (
                <div key={idx} style={{
                  marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8,
                  background: s.approved === true ? '#f0fff4' : s.approved === false ? '#fff5f5' : 'var(--bg)',
                  borderColor: s.approved === true ? '#9ae6b4' : s.approved === false ? '#fed7d7' : 'var(--border)',
                  overflow: 'hidden',
                }}>
                  {/* Suggestion header */}
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 700,
                      background: '#ebf8ff', color: '#2b6cb0',
                    }}>
                      {s.type.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ppw-accent)' }}>{s.keyword}</span>
                    <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 4 }}>{s.location}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => approveSuggestion(idx, true)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', borderRadius: 5, border: '1px solid #9ae6b4',
                          background: s.approved === true ? '#276749' : '#c6f6d5',
                          color: s.approved === true ? '#fff' : '#276749',
                          fontSize: 12, cursor: 'pointer', fontWeight: 600,
                        }}
                      >
                        <Check className="h-3 w-3" /> Approve
                      </button>
                      <button
                        onClick={() => approveSuggestion(idx, false)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', borderRadius: 5, border: '1px solid #fed7d7',
                          background: s.approved === false ? '#c53030' : '#fff5f5',
                          color: s.approved === false ? '#fff' : '#c53030',
                          fontSize: 12, cursor: 'pointer', fontWeight: 600,
                        }}
                      >
                        <X className="h-3 w-3" /> Reject
                      </button>
                    </div>
                  </div>

                  {/* Diff */}
                  <div style={{ padding: '10px 14px' }}>
                    {s.original_text && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#c53030', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Before</div>
                        <div style={{ padding: '8px 10px', background: '#fff5f5', borderRadius: 5, fontSize: 12, color: '#744210', lineHeight: 1.6, borderLeft: '3px solid #fc8181' }}>
                          {s.original_text}
                        </div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#276749', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {s.type === 'new_paragraph' ? 'New paragraph to add' : s.original_text ? 'After' : 'New sentence to add'}
                      </div>
                      <div style={{ padding: '8px 10px', background: '#f0fff4', borderRadius: 5, fontSize: 12, color: '#276749', lineHeight: 1.6, borderLeft: '3px solid #68d391' }}>
                        {s.suggested_text}
                      </div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text4)', fontStyle: 'italic' }}>
                      {s.rationale}
                    </div>
                  </div>
                </div>
              ))}

              {suggestions.length > 0 && (
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button
                    onClick={applyApproved}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '9px 18px', background: 'var(--ppw-accent)', color: '#fff',
                      border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    <Check className="h-4 w-4" />
                    Apply {suggestions.filter(s => s.approved === true).length} approved changes
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>
                    {suggestions.filter(s => s.approved === null).length} undecided · {suggestions.filter(s => s.approved === false).length} rejected
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: HTML Editor ── */}
          {activeSection === 'editor' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text1)' }}>HTML Body</h3>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {bodyHtml.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length} words
                </span>
              </div>
              <textarea
                value={bodyHtml}
                onChange={e => setBodyHtml(e.target.value)}
                style={{
                  width: '100%', minHeight: 500, padding: '12px 14px',
                  border: '1px solid var(--border)', borderRadius: 7,
                  fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7,
                  background: 'var(--bg)', color: 'var(--text1)', resize: 'vertical',
                }}
              />
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={reGrade}
                  disabled={grading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                    background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)',
                  }}
                >
                  {grading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Re-grade after edits
                </button>
              </div>
            </div>
          )}

          {/* ── Tab: SEO Fields ── */}
          {activeSection === 'preview' && (
            <div>
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: '0 0 8px' }}>
                Live render of the HTML in the editor (including unpublished edits). Approved AI suggestions appear here once applied.
              </p>
              <iframe
                title="Collection page preview"
                sandbox=""
                srcDoc={`<!doctype html><html><head>${PREVIEW_HEAD}<style>body{font-family:Poppins,system-ui,sans-serif;margin:0 auto;max-width:1080px;color:#222;line-height:1.65}img{max-width:100%}</style></head><body>${bodyHtml}</body></html>`}
                style={{ width: '100%', height: '70vh', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}
              />
            </div>
          )}

          {activeSection === 'seo' && (
            <div style={{ maxWidth: 680 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, color: 'var(--text1)' }}>SEO Fields</h3>

              <div style={{ marginBottom: 20, padding: 14, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--text2)' }}>Generate title and meta options from all {keywords.length} keywords</span>
                  <button
                    onClick={generateSeo}
                    disabled={genLoading || keywords.length === 0}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', color: '#fff', background: 'var(--ppw-accent)', cursor: genLoading || keywords.length === 0 ? 'default' : 'pointer', opacity: genLoading ? 0.7 : 1 }}
                  >
                    {genLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {genLoading ? 'Generating...' : 'Generate options'}
                  </button>
                </div>
                {genError && <p style={{ fontSize: 12, color: '#c53030', marginTop: 8 }}>{genError}</p>}
                {titleOptions.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Title tag options</div>
                    {titleOptions.map((t, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 6 }}>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--text1)' }}>{t} <span style={{ color: 'var(--text4)', fontSize: 11 }}>({t.length})</span></span>
                        <button onClick={() => setSeoTitle(t)} style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, border: '1px solid var(--ppw-accent)', background: 'transparent', color: 'var(--ppw-accent)', borderRadius: 5, cursor: 'pointer' }}>Use</button>
                      </div>
                    ))}
                  </div>
                )}
                {descOptions.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 6 }}>Meta description options</div>
                    {descOptions.map((d, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 6 }}>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--text1)' }}>{d} <span style={{ color: 'var(--text4)', fontSize: 11 }}>({d.length})</span></span>
                        <button onClick={() => setSeoDescription(d)} style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, border: '1px solid var(--ppw-accent)', background: 'transparent', color: 'var(--ppw-accent)', borderRadius: 5, cursor: 'pointer' }}>Use</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>
                  Title Tag
                  <span style={{ marginLeft: 8, fontWeight: 400, color: seoTitle.length > 70 ? '#e53e3e' : seoTitle.length >= 40 ? '#38a169' : '#d4930a' }}>
                    {seoTitle.length}/70
                  </span>
                </label>
                <input
                  value={seoTitle}
                  onChange={e => setSeoTitle(e.target.value)}
                  style={{
                    width: '100%', padding: '9px 12px', border: `1px solid ${seoTitle.length > 70 ? '#fc8181' : 'var(--border)'}`,
                    borderRadius: 7, fontSize: 14, background: 'var(--bg)', color: 'var(--text1)',
                  }}
                />
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text4)' }}>
                  Preview: <em>{seoTitle || '(empty)'}</em>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>
                  Meta Description
                  <span style={{ marginLeft: 8, fontWeight: 400, color: seoDescription.length > 165 ? '#e53e3e' : seoDescription.length >= 100 ? '#38a169' : '#d4930a' }}>
                    {seoDescription.length}/165
                  </span>
                </label>
                <textarea
                  value={seoDescription}
                  onChange={e => setSeoDescription(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%', padding: '9px 12px', border: `1px solid ${seoDescription.length > 165 ? '#fc8181' : 'var(--border)'}`,
                    borderRadius: 7, fontSize: 13, background: 'var(--bg)', color: 'var(--text1)', resize: 'vertical',
                  }}
                />
              </div>

              {/* DB fields for reference */}
              {dbCol && (dbCol.title_tag || dbCol.meta_description) && (
                <div style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 7, fontSize: 12, color: 'var(--text3)', border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>From keyword research doc</div>
                  {dbCol.title_tag && <div><strong>Title:</strong> {dbCol.title_tag}</div>}
                  {dbCol.meta_description && <div style={{ marginTop: 4 }}><strong>Meta:</strong> {dbCol.meta_description}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {dbCol.title_tag && (
                      <button
                        onClick={() => setSeoTitle(dbCol.title_tag)}
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', color: 'var(--text2)' }}
                      >
                        Use doc title
                      </button>
                    )}
                    {dbCol.meta_description && (
                      <button
                        onClick={() => setSeoDescription(dbCol.meta_description)}
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', color: 'var(--text2)' }}
                      >
                        Use doc meta
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Publish bar ── */}
          <div style={{
            marginTop: 32, padding: '16px 20px',
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 8, display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <button
              onClick={publish}
              disabled={publishing}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 22px', background: publishing ? 'var(--text4)' : 'var(--ppw-accent)',
                color: '#fff', border: 'none', borderRadius: 7,
                fontSize: 14, fontWeight: 700, cursor: publishing ? 'wait' : 'pointer',
              }}
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {publishing ? 'Publishing…' : 'Publish to Shopify'}
            </button>

            {publishResult && (
              <span style={{
                fontSize: 13, fontWeight: 600,
                color: publishResult.success ? '#276749' : '#c53030',
              }}>
                {publishResult.message}
              </span>
            )}

            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text4)' }}>
              Updates body_html + seo_title + seo_description on Shopify and marks collection as optimized in the database.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
