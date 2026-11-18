// components/CollectionAuditQueue.tsx
// Collections ranked worst-first by their audit score (same score as the Revamp
// tool). Improved collections keep their new score and sink to the back. Run a
// full audit, resume an interrupted one ("Audit remaining"), or re-audit a
// single row. Scores persist to gtd_collections so the order survives reloads.
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, ExternalLink, ScanLine, Loader2, RotateCw, Wand2, Trash2, EyeOff, Eye, Tag } from 'lucide-react'
import { PREVIEW_HEAD } from '@/lib/theme-css'

interface CollectionRow {
  slug: string
  url: string
  category: string
  primary_keyword: string
  secondary_keywords: string[]
  search_volume: number
  kd: number
  is_optimized: boolean
  score: number | null
  audit_fail_count: number | null
  audit_top_issues: string[] | null
  audited_at: string | null
  word_count: number | null
  is_hidden: boolean | null
  collection_type: string | null
}

interface Props {
  onLaunchRevamp: (handle: string) => void
}

function scoreColor(score: number | null) {
  if (score == null) return '#888'
  if (score >= 80) return '#15803d'
  if (score >= 60) return '#d4930a'
  return '#e53e3e'
}

// Worst first: lowest score leads, un-audited (null) sinks to the bottom.
function compareRows(a: CollectionRow, b: CollectionRow) {
  const sa = a.score, sb = b.score
  if (sa == null && sb == null) return (b.search_volume || 0) - (a.search_volume || 0)
  if (sa == null) return 1
  if (sb == null) return -1
  if (sa !== sb) return sa - sb
  return (b.search_volume || 0) - (a.search_volume || 0)
}


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

export function CollectionAuditQueue({ onLaunchRevamp }: Props) {
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  // default ON: published (done) collections drop out of the queue; untick to review them
  const [hideDone, setHideDone] = useState(true)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [showHidden, setShowHidden] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | 'standard' | 'brand'>('all')

  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ processed: number; total: number } | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [reauditing, setReauditing] = useState<string | null>(null)
  const [improving, setImproving] = useState<string | null>(null)
  const [improvePreview, setImprovePreview] = useState<any | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [draftSlugs, setDraftSlugs] = useState<Set<string>>(new Set())
  // Stepped flow: keywords -> generate -> preview -> publish
  const [improveStep, setImproveStep] = useState<'keywords' | 'preview' | null>(null)
  const [kwSlug, setKwSlug] = useState<string>('')
  const [kwScore, setKwScore] = useState<number | null>(null)
  const [kwPrimary, setKwPrimary] = useState('')
  const [kwSecondary, setKwSecondary] = useState<string[]>([])
  const [kwSuggestions, setKwSuggestions] = useState<any[]>([])
  const [kwSelected, setKwSelected] = useState<Set<string>>(new Set())
  const [kwLoading, setKwLoading] = useState(false)
  const [kwError, setKwError] = useState<string | null>(null)
  const [kwFeatured, setKwFeatured] = useState('') // comma-separated product handles to PIN as featured picks

  // ── Bulk selection: checkbox per row + action bar for tag/hide en masse ──
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTagging, setBulkTagging] = useState(false)
  const toggleSelect = (slug: string) => setSelected((prev) => {
    const n = new Set(prev); if (n.has(slug)) n.delete(slug); else n.add(slug); return n
  })
  const bulkPatch = async (body: Record<string, unknown>, label: string) => {
    if (selected.size === 0) return
    setBulkTagging(true)
    let ok = 0, fail = 0
    for (const slug of selected) {
      try {
        const res = await fetch(`/api/collections/${encodeURIComponent(slug)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (res.ok) ok++; else fail++
      } catch { fail++ }
    }
    setBulkTagging(false)
    setSelected(new Set())
    load()
    if (fail > 0) window.alert(`${label}: ${ok} updated, ${fail} FAILED`)
  }

  const loadDraftList = useCallback(async () => {
    try {
      const d = await fetch('/api/collections/improve?list=1').then((r) => r.json())
      setDraftSlugs(new Set(d.slugs || []))
    } catch { /* non-fatal */ }
  }, [])

  // ── Bulk Improve: sequential DRAFT generation only, never publishes ──
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkCount, setBulkCount] = useState(10)
  const [bulkLog, setBulkLog] = useState<{ slug: string; ok: boolean; note: string }[]>([])
  const [bulkPos, setBulkPos] = useState<{ done: number; total: number } | null>(null)
  const bulkStop = useRef(false)

  const runBulkImprove = async (targets: CollectionRow[]) => {
    setBulkRunning(true)
    setBulkLog([])
    bulkStop.current = false
    setBulkPos({ done: 0, total: targets.length })
    for (let i = 0; i < targets.length; i++) {
      if (bulkStop.current) break
      const c = targets[i]
      try {
        const res = await fetch('/api/collections/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: c.slug }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'failed')
        const missed = (data.steps || []).filter((st: any) => st.status === 'skipped').length
        setBulkLog((prev) => [...prev, {
          slug: c.slug,
          ok: true,
          note: `${data.scoreBefore} -> ${data.scoreAfter}${missed ? ` · ${missed} step(s) NOT done` : ' · all steps clean'}`,
        }])
      } catch (e) {
        setBulkLog((prev) => [...prev, { slug: c.slug, ok: false, note: e instanceof Error ? e.message : 'failed' }])
      }
      setBulkPos({ done: i + 1, total: targets.length })
      // 5s breather between runs: lets Shopify's rate bucket refill so manual
      // publish clicks during a bulk run don't compete with the next burst
      await new Promise((r) => setTimeout(r, 5000))
    }
    setBulkRunning(false)
    await loadDraftList()
    await load()
  }

  const startBulk = () => {
    const targets = filtered.filter((c) => !draftSlugs.has(c.slug)).slice(0, bulkCount)
    if (targets.length === 0) { alert('No eligible collections in the current view (all have drafts already, or the filters exclude everything).'); return }
    if (!window.confirm(`Generate Improve DRAFTS for ${targets.length} collection(s), worst-first from your current view?\n\nNothing publishes — you review each draft before pushing live. Roughly a minute per collection.`)) return
    runBulkImprove(targets)
  }

  const openImprove = async (c: CollectionRow) => {
    if (draftSlugs.has(c.slug)) {
      const resume = window.confirm('A saved draft exists for this collection. OK = review the draft, Cancel = start over with fresh keywords.')
      if (resume) {
        const d = await fetch(`/api/collections/improve?slug=${encodeURIComponent(c.slug)}`).then((r) => safeJson(r, 'Load draft'))
        if (d && !d.error) {
          setImprovePreview(d)
          setImproveStep('preview')
          return
        }
      }
    }
    setKwSlug(c.slug)
    setKwScore(c.score)
    setKwPrimary(c.primary_keyword || '')
    setKwSecondary(Array.isArray(c.secondary_keywords) ? c.secondary_keywords : [])
    setKwFeatured(Array.isArray((c as any).featured_handles) ? (c as any).featured_handles.join(', ') : '')
    setKwSuggestions([])
    setKwSelected(new Set())
    setKwError(null)
    setImprovePreview(null)
    setImproveStep('keywords')
  }

  const pullAhrefs = async () => {
    if (!kwPrimary.trim()) { setKwError('Set a primary keyword first'); return }
    setKwLoading(true)
    setKwError(null)
    try {
      const res = await fetch('/api/collections/keyword-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: kwPrimary.trim(), exclude: [kwPrimary, ...kwSecondary], limit: 15 }),
      })
      const data = await safeJson(res, 'Ahrefs pull')
      if (!res.ok) throw new Error(data.error || 'Ahrefs pull failed')
      setKwSuggestions(data.suggestions || data.keywords || [])
      if ((data.suggestions || data.keywords || []).length === 0) setKwError('No new keyword opportunities found for this seed.')
    } catch (e) {
      setKwError(e instanceof Error ? e.message : 'Ahrefs pull failed')
    } finally {
      setKwLoading(false)
    }
  }

  const generateImprove = async (legacy = false) => {
    const finalSecondary = [...new Set([...kwSecondary, ...kwSelected])]
    setImproving(kwSlug)
    setKwError(null)
    try {
      // Save keywords first (research feeds generation), then generate.
      await fetch(`/api/collections/${encodeURIComponent(kwSlug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_keyword: kwPrimary.trim(),
          secondary_keywords: finalSecondary,
          // URLs, paths, or bare handles — split on newlines/commas/spaces and
          // normalize to clean handles before saving
          featured_handles: kwFeatured.split(/[\s,]+/)
            .map((s) => s.trim().toLowerCase().replace(/^https?:\/\/[^/]+/, '').replace(/^.*\/products\//, '').replace(/[?#].*$/, '').replace(/\/+$/, ''))
            .filter(Boolean),
        }),
      })
      const res = await fetch(legacy ? '/api/collections/improve' : '/api/collections/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: kwSlug }),
      })
      const data = await safeJson(res, legacy ? 'Improve (legacy patch)' : 'Generate page')
      if (!res.ok) throw new Error(data.error || 'Improve failed')
      setImprovePreview(data)
      setImproveStep('preview')
      loadDraftList()
    } catch (e) {
      setKwError(e instanceof Error ? e.message : 'Improve failed')
    } finally {
      setImproving(null)
    }
  }

  const closeImprove = () => {
    // Draft is already saved server-side — closing loses nothing.
    setImproveStep(null)
    setImprovePreview(null)
  }

  const discardDraft = async () => {
    if (!improvePreview) return
    if (!window.confirm('Discard this draft permanently?')) return
    await fetch(`/api/collections/improve?slug=${encodeURIComponent(improvePreview.slug)}`, { method: 'DELETE' })
    loadDraftList()
    closeImprove()
  }

  const publishImprove = async () => {
    if (!improvePreview) return
    setPublishing(true)
    try {
      const res = await fetch(`/api/shopify/collection-revamp/${encodeURIComponent(improvePreview.slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_html: improvePreview.bodyHtml,
          seo_title: improvePreview.seoTitle,
          seo_description: improvePreview.seoDescription,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Publish failed')
      }
      await fetch(`/api/collections/grade-all?slug=${encodeURIComponent(improvePreview.slug)}`, { method: 'POST' })
      await fetch(`/api/collections/improve?slug=${encodeURIComponent(improvePreview.slug)}`, { method: 'DELETE' })
      // published = done: mark it so the row shows DONE and drops out of the
      // queue when "Hide done" is on (matches the Revamp tool's publish flow)
      await fetch(`/api/collections/${encodeURIComponent(improvePreview.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_optimized: true }),
      })
      loadDraftList()
      closeImprove()
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/collections').then((r) => r.json())
      const rows: CollectionRow[] = (data.collections || []).slice().sort(compareRows)
      setCollections(rows)
      const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))] as string[]
      setCategories(cats.sort())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(); loadDraftList() }, [load, loadDraftList])

  // mode 'all' = re-audit everything; 'remaining' = only un-audited (resume).
  const runScan = async (mode: 'all' | 'remaining') => {
    setScanning(true); setScanError(null); setScanProgress(null)
    try {
      let offset = 0
      let done = false
      let guard = 0
      while (!done && guard < 1000) {
        guard++
        const qs = mode === 'remaining' ? `mode=remaining&limit=5` : `offset=${offset}&limit=5`
        const res = await fetch(`/api/collections/grade-all?${qs}`, { method: 'POST' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Scan failed')
        setScanProgress({ processed: data.processed, total: data.total })
        offset = data.nextOffset
        done = data.done
        await load()
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const [syncingCollections, setSyncingCollections] = useState(false)

  const syncFromShopify = async () => {
    setSyncingCollections(true)
    try {
      const res = await fetch('/api/collections/sync-shopify', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      const parts: string[] = []
      if (data.added > 0) parts.push(`Added ${data.added}: ${data.addedSlugs.slice(0, 8).join(', ')}${data.added > 8 ? '…' : ''}`)
      if (data.merged > 0) parts.push(`Merged ${data.merged} stale doc row(s) onto live handles: ${data.mergedPairs.slice(0, 5).join('; ')}`)
      if (data.brandTagged > 0) parts.push(`Auto-tagged ${data.brandTagged} BRAND collection(s): ${(data.brandTaggedSlugs || []).slice(0, 8).join(', ')}${data.brandTagged > 8 ? '…' : ''}`)
      alert(parts.length ? parts.join('\n') + '\nRun "Audit remaining" to grade new rows.' : `All ${data.liveCollections} live Shopify collections are already registered.`)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncingCollections(false)
    }
  }

  const reAuditOne = async (slug: string) => {
    setReauditing(slug)
    try {
      await fetch(`/api/collections/grade-all?slug=${encodeURIComponent(slug)}`, { method: 'POST' })
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setReauditing(null)
    }
  }

  const toggleBrand = async (slug: string, current: string | null) => {
    const next = current === 'brand' ? 'standard' : 'brand'
    if (!window.confirm(next === 'brand'
      ? `Tag "${slug}" as a BRAND collection? Improve will use the brand template (compare table kept, brand Q1/Q2, Brand schema).`
      : `Untag "${slug}" — treat as a category collection again?`)) return
    await fetch(`/api/collections/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection_type: next }),
    })
    await load()
  }

  const toggleHidden = async (slug: string, current: boolean | null) => {
    await fetch(`/api/collections/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_hidden: !current }),
    })
    await load()
  }

  const removeCollection = async (slug: string) => {
    if (!window.confirm(`Remove "${slug}" from the audit queue? This only deletes the tracking row (keywords/scores) — nothing on Shopify is touched. Use for stale rows left over from URL changes.`)) return
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(slug)}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Delete failed')
      }
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const toggleOptimized = async (slug: string, current: boolean) => {
    await fetch(`/api/collections/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_optimized: !current }),
    })
    setCollections((prev) => prev.map((c) => (c.slug === slug ? { ...c, is_optimized: !current } : c)))
  }

  const filtered = collections.filter((c) => {
    const matchSearch = !search || c.slug.includes(search.toLowerCase()) || c.primary_keyword?.toLowerCase().includes(search.toLowerCase())
    const matchCat = !filterCategory || c.category === filterCategory
    const matchDone = !hideDone || !c.is_optimized
    // A drafted collection has no LIVE content yet. word_count stays under 50
    // until its draft is published, so "Hide empty" would hide exactly the rows
    // waiting for review. Anything with a saved draft stays visible regardless.
    const matchEmpty = !hideEmpty || draftSlugs.has(c.slug) || c.word_count == null || c.word_count >= 50
    const matchHidden = showHidden ? true : !c.is_hidden
    const matchType = typeFilter === 'all' ? true : typeFilter === 'brand' ? c.collection_type === 'brand' : c.collection_type !== 'brand'
    return matchSearch && matchCat && matchDone && matchEmpty && matchHidden && matchType
  })

  const auditedCount = collections.filter((c) => c.score != null).length
  const remainingCount = collections.filter((c) => c.score == null).length

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--gtd-accent)' }}>Audit Queue</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text3)', fontSize: 13 }}>
            {collections.length} collections, {auditedCount} audited, {remainingCount} not yet audited, ranked worst-first by score
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {scanProgress && (
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{scanProgress.processed} / {scanProgress.total}</span>
          )}
          {remainingCount > 0 && (
            <button
              onClick={() => runScan('remaining')}
              disabled={scanning}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6,
                border: 'none', background: 'var(--gtd-accent)', color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: scanning ? 'default' : 'pointer', opacity: scanning ? 0.7 : 1,
              }}
            >
              {scanning ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />}
              {scanning ? 'Auditing...' : `Audit remaining (${remainingCount})`}
            </button>
          )}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min={1}
              max={236}
              value={bulkCount}
              onChange={(e) => setBulkCount(Math.max(1, parseInt(e.target.value) || 1))}
              disabled={bulkRunning}
              style={{ width: 56, padding: '7px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text1)', fontSize: 13 }}
            />
            <button
              onClick={bulkRunning ? () => { bulkStop.current = true } : startBulk}
              disabled={scanning}
              title="Generate Improve drafts for the next N collections in this view (worst-first, skips ones with drafts). Nothing publishes."
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6,
                border: 'none', background: bulkRunning ? '#c53030' : '#1d4ed8', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {bulkRunning ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {bulkRunning ? `Stop (${bulkPos?.done ?? 0}/${bulkPos?.total ?? 0})` : 'Bulk Improve (drafts only)'}
            </button>
          </div>
          <a
            href="/api/collections/master-css?doc=1"
            title="Download the master collection stylesheet (assembled live from the canonical pages) with Claude Design Studio context"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
          >
            Export master CSS
          </a>
          <button
            onClick={async () => {
              if (!window.confirm(`Delete ALL ${draftSlugs.size || ''} saved drafts? Published pages are untouched — this only clears unpublished generation drafts so you can redo them with the current rule set.`)) return
              try {
                const res = await fetch('/api/collections/improve?all=1', { method: 'DELETE' })
                const data = await safeJson(res, 'Clear drafts')
                if (!res.ok) throw new Error(data.error || 'Clear failed')
                setDraftSlugs(new Set())
                loadDraftList()
                window.alert(`Cleared ${data.deleted ?? 'all'} draft(s).`)
              } catch (e) {
                window.alert(e instanceof Error ? e.message : 'Clear failed')
              }
            }}
            disabled={draftSlugs.size === 0}
            title="Delete every saved generation draft (published pages untouched)"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg)', color: draftSlugs.size ? '#c53030' : 'var(--text4)', fontSize: 13, fontWeight: 600,
              cursor: draftSlugs.size ? 'pointer' : 'default',
            }}
          >
            <Trash2 size={14} /> Clear all drafts{draftSlugs.size ? ` (${draftSlugs.size})` : ''}
          </button>
          <button
            onClick={async () => {
              if (!window.confirm('Remove product/brand counts ("11 models · 3 brands" eyebrows, "N models" brand tiles) from ALL published v2 pages AND all saved drafts?\n\nCounts go stale as inventory changes. Idempotent, takes ~1s per affected page.')) return
              try {
                const res = await fetch('/api/collections/strip-counts', { method: 'POST' })
                const data = await safeJson(res, 'Strip counts')
                if (!res.ok) throw new Error(data.error || 'Strip failed')
                window.alert(`Checked ${data.checked} live collection(s): updated ${data.publishedUpdated} published page(s) and ${data.draftsUpdated} draft(s).${(data.failures || []).length ? ' Failed: ' + data.failures.join(', ') : ''}`)
              } catch (e) {
                window.alert(e instanceof Error ? e.message : 'Strip failed')
              }
            }}
            title="One-time cleanup: remove printed product/brand counts from published pages and drafts"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Strip counts
          </button>
          <button
            onClick={async () => {
              if (!window.confirm(`Repair SEO titles on all ${draftSlugs.size} saved draft(s)?\n\nRe-reads the LIVE title tag from Shopify for each draft and replaces fabricated "[X] | Green Thumb Depot" titles with the real tag. Takes ~1s per draft. Safe to rerun.`)) return
              try {
                const res = await fetch('/api/collections/repair-draft-seo', { method: 'POST' })
                const data = await safeJson(res, 'Repair draft SEO')
                if (!res.ok) throw new Error(data.error || 'Repair failed')
                window.alert(`Checked ${data.checked} draft(s): restored ${data.repairedTitles} title tag(s), back-filled ${data.filledDescs} description(s).${(data.log || []).length ? '\n\n' + data.log.slice(0, 12).join('\n') : ''}`)
              } catch (e) {
                window.alert(e instanceof Error ? e.message : 'Repair failed')
              }
            }}
            disabled={draftSlugs.size === 0}
            title="Restore real Shopify title tags into drafts that were generated with fabricated ones"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, fontWeight: 600,
              cursor: draftSlugs.size ? 'pointer' : 'default', opacity: draftSlugs.size ? 1 : 0.6,
            }}
          >
            Repair draft SEO titles
          </button>
          <button
            onClick={async () => {
              if (!window.confirm('Reset ALL collections to the ORIGINAL keywords from your collection guide (GTD_Complete_Collection_Optimization_6.xlsx)?\n\nThis overwrites primary + secondary keywords on every matching collection, undoing any Ahrefs auto-additions AND any manual edits made since. 198 collections in the guide.')) return
              try {
                const res = await fetch('/api/collections/restore-keywords', { method: 'POST' })
                const data = await safeJson(res, 'Restore keywords')
                if (!res.ok) throw new Error(data.error || 'Restore failed')
                window.alert(`Restored guide keywords on ${data.updated} collection(s).${data.notInQueueCount ? ` ${data.notInQueueCount} guide entries had no matching queue row (old URLs).` : ''}`)
                load()
              } catch (e) {
                window.alert(e instanceof Error ? e.message : 'Restore failed')
              }
            }}
            disabled={scanning}
            title="Bulk-reset every collection's keywords to the originals from your collection guide spreadsheet"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Restore guide keywords
          </button>
          <button
            onClick={syncFromShopify}
            disabled={syncingCollections || scanning}
            title="Register any live Shopify collections the queue doesn't know about"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, fontWeight: 600,
              cursor: syncingCollections ? 'default' : 'pointer', opacity: syncingCollections ? 0.7 : 1,
            }}
          >
            {syncingCollections ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
            {syncingCollections ? 'Syncing...' : 'Sync collections from Shopify'}
          </button>
          <button
            onClick={() => runScan('all')}
            disabled={scanning}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, fontWeight: 600,
              cursor: scanning ? 'default' : 'pointer', opacity: scanning ? 0.7 : 1,
            }}
          >
            <RefreshCw size={14} /> Re-audit all
          </button>
        </div>
      </div>

      {scanError && <div style={{ color: '#c53030', fontSize: 13, marginBottom: 14 }}>{scanError}</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search slug or keyword..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, width: 240, background: 'var(--bg)', color: 'var(--text1)' }}
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text1)' }}
        >
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | 'standard' | 'brand')}
          style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text1)' }}>
          <option value="all">All types</option>
          <option value="standard">Category collections</option>
          <option value="brand">Brand collections</option>
        </select>
        <label style={{ fontSize: 12, color: 'var(--text3)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide done
        </label>
        <label style={{ fontSize: 12, color: 'var(--text3)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide empty (drafts still show)
        </label>
        <label style={{ fontSize: 12, color: 'var(--text3)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden ({collections.filter((c) => c.is_hidden).length})
        </label>
      </div>

      {(bulkRunning || bulkLog.length > 0) && (
        <div style={{ margin: '10px 0', border: '1px solid var(--border)', borderRadius: 8, padding: 10, maxHeight: 180, overflowY: 'auto', background: 'var(--bg)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
            Bulk Improve {bulkRunning ? `running ${bulkPos?.done ?? 0}/${bulkPos?.total ?? 0}...` : `finished — ${bulkLog.filter((l) => l.ok).length} draft(s) created. Review the DRAFT rows, then publish each after checking.`}
          </div>
          {bulkLog.map((l, i) => (
            <div key={i} style={{ fontFamily: 'monospace', fontSize: 11, color: l.ok ? 'var(--text2)' : '#c53030', padding: '1px 0' }}>
              {l.ok ? 'OK ' : 'ERR '}{l.slug} — {l.note}
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>Loading audit queue...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>No collections match your filters.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Bulk action bar: select rows via checkboxes, then tag/hide en masse */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: selected.size ? 'rgba(29,78,216,0.06)' : 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text3)', cursor: 'pointer' }}>
              <input type="checkbox"
                checked={filtered.length > 0 && filtered.every((c) => selected.has(c.slug))}
                onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((c) => c.slug)) : new Set())}
                style={{ width: 15, height: 15, cursor: 'pointer' }} />
              Select all in view ({filtered.length})
            </label>
            {selected.size > 0 && (
              <>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>{selected.size} selected</span>
                {bulkTagging ? <Loader2 size={14} className="animate-spin" /> : (
                  <>
                    <button onClick={() => bulkPatch({ collection_type: 'brand' }, 'Tag brand')} style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed', border: 'none', borderRadius: 6, padding: '5px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Tag BRAND</button>
                    <button onClick={() => bulkPatch({ collection_type: 'standard' }, 'Tag standard')} style={{ background: 'rgba(21,128,61,0.1)', color: '#15803d', border: 'none', borderRadius: 6, padding: '5px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Tag Standard</button>
                    <button onClick={() => bulkPatch({ is_hidden: true }, 'Hide')} style={{ background: 'rgba(120,120,120,0.12)', color: 'var(--text2)', border: 'none', borderRadius: 6, padding: '5px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Hide</button>
                    <button onClick={() => bulkPatch({ is_hidden: false }, 'Unhide')} style={{ background: 'rgba(120,120,120,0.12)', color: 'var(--text2)', border: 'none', borderRadius: 6, padding: '5px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Unhide</button>
                    <button onClick={() => bulkPatch({ is_optimized: true }, 'Mark done')} style={{ background: 'rgba(39,103,73,0.12)', color: '#276749', border: 'none', borderRadius: 6, padding: '5px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Mark Done</button>
                    <button onClick={() => setSelected(new Set())} style={{ background: 'none', color: 'var(--text4)', border: 'none', padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}>Clear</button>
                  </>
                )}
              </>
            )}
          </div>
          {filtered.map((c, idx) => (
            <div
              key={c.slug}
              style={{
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
                opacity: c.is_optimized ? 0.72 : 1,
              }}
            >
              <input type="checkbox" checked={selected.has(c.slug)} onChange={() => toggleSelect(c.slug)}
                title="Select for bulk tag/hide actions"
                style={{ flexShrink: 0, width: 15, height: 15, cursor: 'pointer' }} />
              <div style={{ width: 28, textAlign: 'right', fontSize: 12, color: 'var(--text4)', fontFamily: 'monospace', flexShrink: 0 }}>{idx + 1}</div>

              {/* Score badge */}
              <div style={{ flexShrink: 0, width: 46, textAlign: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: scoreColor(c.score), padding: '3px 9px', borderRadius: 10 }}>
                  {c.score == null ? '-' : c.score}
                </span>
              </div>

              {/* Slug + keyword + issues */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text1)', fontWeight: 600 }}>{c.slug}</span>
                  {c.is_optimized && <span style={{ fontSize: 10, fontWeight: 700, color: '#276749', background: 'rgba(39,103,73,0.12)', padding: '1px 6px', borderRadius: 8 }}>DONE</span>}
                  {c.word_count != null && c.word_count < 50 && <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: 'rgba(146,64,14,0.12)', padding: '1px 6px', borderRadius: 8 }}>NO CONTENT</span>}
                  {draftSlugs.has(c.slug) && <span style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', background: 'rgba(29,78,216,0.12)', padding: '1px 6px', borderRadius: 8 }}>DRAFT</span>}
                  {c.collection_type === 'brand' && <span style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', background: 'rgba(124,58,237,0.12)', padding: '1px 6px', borderRadius: 8 }}>BRAND</span>}
                  {c.is_hidden && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', background: 'rgba(120,120,120,0.12)', padding: '1px 6px', borderRadius: 8 }}>HIDDEN</span>}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text4)', display: 'flex' }}>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                  {c.primary_keyword || '-'}
                  {c.search_volume ? <span style={{ marginLeft: 8, color: 'var(--text4)' }}>{c.search_volume.toLocaleString()} sv</span> : null}
                </div>
                {c.audit_top_issues && c.audit_top_issues.length > 0 && (
                  <div style={{ marginTop: 5 }}>
                    {c.audit_top_issues.slice(0, 5).map((t, i) => (
                      <span key={i} style={{ display: 'inline-block', background: 'rgba(229,62,62,0.1)', color: '#c53030', borderRadius: 4, padding: '1px 6px', margin: '0 4px 4px 0', fontSize: 11 }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                <button
                  onClick={() => reAuditOne(c.slug)}
                  disabled={reauditing === c.slug}
                  title="Re-audit this collection now"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg)', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                  {reauditing === c.slug ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
                </button>
                <button
                  onClick={() => openImprove(c)}
                  disabled={improving !== null}
                  title="Expand and fix this page per the Collection Page Rules — keeps existing copy"
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: improving !== null && improving !== c.slug ? 0.5 : 1 }}
                >
                  {improving === c.slug ? <Loader2 size={13} className="animate-spin" /> : <Wand2 className="h-3 w-3" />} Generate
                </button>
                <button
                  onClick={() => onLaunchRevamp(c.slug)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--gtd-accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  <RefreshCw className="h-3 w-3" /> Revamp
                </button>
                <button
                  onClick={() => toggleOptimized(c.slug, c.is_optimized)}
                  title={c.is_optimized ? 'Mark as not done' : 'Mark done'}
                  style={{ background: 'var(--bg)', color: c.is_optimized ? '#276749' : 'var(--text3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                  {c.is_optimized ? '✓' : 'OK'}
                </button>
                <button
                  onClick={() => toggleBrand(c.slug, c.collection_type)}
                  title={c.collection_type === 'brand' ? 'Tagged as BRAND collection — click to untag (category template)' : 'Tag as BRAND collection (uses the brand template in Improve)'}
                  style={{ background: c.collection_type === 'brand' ? 'rgba(124,58,237,0.12)' : 'var(--bg)', color: c.collection_type === 'brand' ? '#7c3aed' : 'var(--text3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, cursor: 'pointer' }}
                >
                  <Tag size={13} />
                </button>
                <button
                  onClick={() => toggleHidden(c.slug, c.is_hidden)}
                  title={c.is_hidden ? 'Unhide — bring back into the queue' : 'Hide from the queue (kept, not deleted — use "Show hidden" to bring back)'}
                  style={{ background: 'var(--bg)', color: c.is_hidden ? '#1d4ed8' : 'var(--text3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, cursor: 'pointer' }}
                >
                  {c.is_hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button
                  onClick={() => removeCollection(c.slug)}
                  title="Remove this row from the queue (stale URL / replaced handle). Shopify is not touched."
                  style={{ background: 'var(--bg)', color: '#c53030', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, cursor: 'pointer' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {improveStep && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: 'var(--bg)', borderRadius: 12, maxWidth: improveStep === 'preview' ? 1000 : 640, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>

            {improveStep === 'keywords' && (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', marginBottom: 4 }}>Step 1: Keywords — {kwSlug}</h3>
                <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14 }}>Confirm targets before generating. Pull Ahrefs to find secondary opportunities; selected ones are saved to the collection and woven into the generated sections.</p>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Primary keyword</label>
                <input value={kwPrimary} onChange={(e) => setKwPrimary(e.target.value)}
                  style={{ width: '100%', margin: '4px 0 12px', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text1)', fontSize: 13 }} />
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Current secondary keywords</label>
                <div style={{ margin: '6px 0 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {kwSecondary.length === 0 && <span style={{ fontSize: 12, color: 'var(--text4)' }}>none yet</span>}
                  {kwSecondary.map((k) => (
                    <span key={k} style={{ fontSize: 12, background: 'rgba(29,78,216,0.1)', color: '#1d4ed8', padding: '3px 8px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {k}
                      <span title="Make this the PRIMARY keyword (current primary becomes a secondary)" style={{ cursor: 'pointer', color: '#b3903f' }}
                        onClick={() => { const old = kwPrimary.trim(); setKwSecondary([...(old ? [old] : []), ...kwSecondary.filter((x) => x !== k)]); setKwPrimary(k) }}>★</span>
                      <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => setKwSecondary(kwSecondary.filter((x) => x !== k))}>×</span>
                    </span>
                  ))}
                </div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Featured products (optional override) — paste product URLs</label>
                <textarea value={kwFeatured} onChange={(e) => setKwFeatured(e.target.value)} rows={3}
                  placeholder={'Paste up to 3 product page URLs, one per line (or comma-separated):\nhttps://greenthumbdepot.com/products/...\nhttps://greenthumbdepot.com/products/...'}
                  style={{ width: '100%', margin: '4px 0 4px', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text1)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
                <p style={{ fontSize: 11, color: 'var(--text4)', margin: '0 0 12px' }}>Leave empty for automatic price-tier selection. Pinned products fill the Top Pick cards first; auto-selection fills any remaining of the 3 slots. Saved with the collection, so regenerating keeps them.</p>
                <button onClick={pullAhrefs} disabled={kwLoading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--gtd-accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 10 }}>
                  {kwLoading ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} {kwLoading ? 'Pulling Ahrefs...' : 'Pull Ahrefs keyword opportunities'}
                </button>
                {kwError && <p style={{ fontSize: 12, color: '#c53030', marginBottom: 8 }}>{kwError}</p>}
                {kwSuggestions.length > 0 && (
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 12 }}>
                    {kwSuggestions.map((sug: any) => {
                      const kw = sug.keyword || sug.term || String(sug)
                      const picked = kwSelected.has(kw)
                      return (
                        <div key={kw} onClick={() => { const n = new Set(kwSelected); if (picked) n.delete(kw); else n.add(kw); setKwSelected(n) }}
                          style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: picked ? 'rgba(29,78,216,0.1)' : 'transparent' }}>
                          <span style={{ fontSize: 13, color: picked ? '#1d4ed8' : 'var(--text1)', fontWeight: picked ? 600 : 400 }}>{picked ? '✓ ' : ''}{kw}</span>
                          <span style={{ fontSize: 12, color: 'var(--text4)' }}>{sug.volume != null ? `${Number(sug.volume).toLocaleString()} sv` : ''}{sug.kd != null ? ` · KD ${sug.kd}` : ''}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button onClick={closeImprove} style={{ background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                  {kwScore !== null && kwScore >= 80 && (
                    <button onClick={() => generateImprove(true)} disabled={improving !== null}
                      title="Legacy patch mode — only for pages already scoring 80+"
                      style={{ background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
                      Legacy Improve (patch)
                    </button>
                  )}
                  <button onClick={() => generateImprove(false)} disabled={improving !== null}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {improving ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    {improving ? 'Generating...' : `Save keywords & Generate page${kwSelected.size ? ` (+${kwSelected.size} kw)` : ''}`}
                  </button>
                </div>
              </>
            )}

            {improveStep === 'preview' && improvePreview && (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', marginBottom: 4 }}>
                  Step 2: Review — {improvePreview.title}
                  {improvePreview.template && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: improvePreview.template === 'brand' ? '#7c3aed' : '#15803d', background: improvePreview.template === 'brand' ? 'rgba(124,58,237,0.12)' : 'rgba(21,128,61,0.1)', padding: '2px 8px', borderRadius: 10, verticalAlign: 'middle' }}>
                      {improvePreview.template === 'brand' ? 'BRAND TEMPLATE' : 'CATEGORY TEMPLATE'}
                    </span>
                  )}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>
                  Score {improvePreview.scoreBefore} → <strong style={{ color: scoreColor(improvePreview.scoreAfter) }}>{improvePreview.scoreAfter}</strong>
                  {improvePreview.fromDraft ? ' · resumed from saved draft' : ''} · closing keeps the draft, nothing publishes until you say so.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>Rule checklist — was each step followed?</div>
                    <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
                      {(improvePreview.steps || []).map((st: any, i: number) => (
                        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ flexShrink: 0, fontWeight: 700, color: st.status === 'done' ? '#15803d' : st.status === 'not-needed' ? 'var(--text4)' : st.status === 'manual' ? '#b45309' : '#c53030' }}>
                            {st.status === 'done' ? '✓' : st.status === 'not-needed' ? '—' : st.status === 'manual' ? '✋' : '✗'}
                          </span>
                          <span style={{ color: st.status === 'not-needed' ? 'var(--text3)' : 'var(--text1)' }}>
                            {st.label}
                            {st.detail ? <span style={{ color: 'var(--text3)' }}> · {st.detail}</span> : null}
                            {st.status === 'skipped' ? <span style={{ color: '#c53030', fontWeight: 600 }}> (NOT done)</span> : null}
                          </span>
                        </div>
                      ))}
                      {(improvePreview.steps || []).length === 0 && (improvePreview.plan || []).map((x: string, i: number) => (
                        <div key={i} style={{ fontSize: 12, color: 'var(--text1)', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>+ {x}</div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 }}>Meta title</div>
                    <p style={{ fontSize: 12, color: 'var(--text1)', marginBottom: 8, wordBreak: 'break-word' }}>{improvePreview.seoTitle || '(unchanged)'}</p>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 }}>Meta description</div>
                    <p style={{ fontSize: 12, color: 'var(--text1)', marginBottom: 8, wordBreak: 'break-word' }}>{improvePreview.seoDescription || '(unchanged)'}</p>
                    {(improvePreview.manualItems || []).length > 0 && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 4 }}>{improvePreview.mode === 'generate' ? 'Validation blockers / gaps' : 'Needs manual review'}</div>
                        {(improvePreview.manualItems || []).map((x: string, i: number) => (
                          <div key={i} style={{ fontSize: 11, color: 'var(--text3)', padding: '2px 0' }}>• {x}</div>
                        ))}
                      </>
                    )}
                    {(improvePreview.researchLog || []).length > 0 && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', margin: '10px 0 4px' }}>Keyword research log (not published)</div>
                        {(improvePreview.researchLog || []).map((x: string, i: number) => (
                          <div key={'r' + i} style={{ fontSize: 11, color: 'var(--text3)', padding: '2px 0', fontFamily: 'monospace' }}>{x}</div>
                        ))}
                      </>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>Page preview (new description content)</div>
                    <iframe
                      title="Collection preview"
                      sandbox=""
                      srcDoc={`<!doctype html><html><head>${PREVIEW_HEAD}<style>body{font-family:Poppins,system-ui,sans-serif;margin:0 auto;max-width:1080px;color:#222;line-height:1.6}img{max-width:100%}</style></head><body>${improvePreview.bodyHtml || ''}</body></html>`}
                      style={{ width: '100%', height: '52vh', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 14 }}>
                  <button onClick={discardDraft} disabled={publishing}
                    style={{ background: 'var(--bg)', color: '#c53030', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
                    Discard draft
                  </button>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={closeImprove} disabled={publishing}
                      style={{ background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
                      Save draft & close
                    </button>
                    <button
                      onClick={() => { closeImprove(); onLaunchRevamp(improvePreview.slug) }}
                      disabled={publishing}
                      title="Open this collection in the Revamp Tool with the draft ready to load — edit and finish the leftover items before publishing"
                      style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Move to Revamp for review
                    </button>
                    <button onClick={publishImprove} disabled={publishing || !improvePreview.changed}
                      style={{ background: '#15803d', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      {publishing ? 'Publishing...' : 'Publish to Shopify'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
