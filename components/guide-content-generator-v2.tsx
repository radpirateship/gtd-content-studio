'use client'

// ============================================================================
// Content step for template_version 2 guides.
//
// The editor works from a section PLAN (lib/guide-v2.ts DEFAULT_GUIDE_PLAN):
// tick or untick sections, rename a heading, adjust the brief. Every call goes
// through /api/ultimate-guides/generate-v2, which feeds the writer live
// product data and runs the guard chain before anything comes back. Preview
// renders the real page through assembleGuideHtml() inside the theme CSS.
//
// The legacy component (guide-content-generator.tsx) is untouched and still
// serves guides without template_version.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ChevronRight, ChevronLeft, Loader2, RefreshCw, Sparkles, Eye, EyeOff,
  CheckCircle2, AlertTriangle, Circle, ShoppingBag, X, RotateCcw, ListChecks,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UltimateGuide } from './ultimate-guide-wizard'
import { assembleGuideHtml } from '@/lib/guide-assembler'
import { DEFAULT_GUIDE_PLAN, fillPlan, normalisePlan, type GuidePlanItem, type GuideV2Product } from '@/lib/guide-v2'
import { buildBlogPreviewDocument } from '@/lib/blog-theme-css'

type SectionState = {
  html: string
  status: 'pending' | 'generating' | 'ready' | 'error'
  warnings: string[]
  words?: number
  error?: string
}

type ClusterLink = { title: string; url: string }

interface Props {
  guide: UltimateGuide
  onSave: (guide: UltimateGuide) => void
  onBack: () => void
}

async function api<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/ultimate-guides/generate-v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `generate-v2 returned ${res.status}`)
  return data as T
}

async function persist(id: string, fields: Record<string, unknown>) {
  try {
    await fetch('/api/ultimate-guides', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    })
  } catch (err) {
    console.error('[guide-v2] save failed', err)
  }
}

export function GuideContentGeneratorV2({ guide, onSave, onBack }: Props) {
  const topic = guide.topic_short
  const topicPlural = guide.topic_short_plural || `${topic}s`

  const [plan, setPlan] = useState<GuidePlanItem[]>(() => {
    const raw = guide.section_plan
    return Array.isArray(raw) && raw.length ? normalisePlan(raw) : DEFAULT_GUIDE_PLAN.map(p => ({ ...p }))
  })
  const shown = useMemo(() => fillPlan(plan, topic, topicPlural), [plan, topic, topicPlural])

  const [sections, setSections] = useState<Record<string, SectionState>>(() => {
    const saved = (guide.section_content || {}) as Record<string, string>
    const out: Record<string, SectionState> = {}
    for (const p of DEFAULT_GUIDE_PLAN) out[p.key] = { html: saved[p.key] || '', status: saved[p.key] ? 'ready' : 'pending', warnings: [] }
    for (const k of Object.keys(saved)) if (!out[k]) out[k] = { html: saved[k], status: 'ready', warnings: [] }
    return out
  })
  const [products, setProducts] = useState<GuideV2Product[]>(() => (guide.selected_products || []) as unknown as GuideV2Product[])
  const [takeaways, setTakeaways] = useState<{ label: string; text: string }[]>(() => (Array.isArray(guide.key_takeaways) ? guide.key_takeaways : []) as { label: string; text: string }[])
  const [faq, setFaq] = useState<{ q: string; a: string }[]>(() => (Array.isArray(guide.faq_pairs) ? guide.faq_pairs : []) as { q: string; a: string }[])
  const [metaDescription, setMetaDescription] = useState(guide.meta_description || '')
  const [deck, setDeck] = useState(guide.description || '')
  const [clusterLinks, setClusterLinks] = useState<ClusterLink[]>([])
  const [active, setActive] = useState<string>(shown.find(p => p.enabled)?.key || 'what-it-is')
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [showPlan, setShowPlan] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const stopRef = useRef(false)

  const note = (s: string) => setLog(prev => [...prev.slice(-40), s])

  // Cluster links: the topical authority resources for this collection, the
  // same source the old step used. The route validates them against Shopify.
  useEffect(() => {
    const slug = guide.collection_slug || ''
    const url = slug ? `/api/resources?type=topical-authority&collection=${encodeURIComponent(slug)}` : '/api/resources?type=topical-authority'
    fetch(url).then(r => r.ok ? r.json() : null).then(data => {
      if (!data) return
      const items = (data.items || data.resources || data || []) as Record<string, unknown>[]
      const links: ClusterLink[] = items.map(r => {
        const existing = (r.existingUrl as string) || (r.url as string) || ''
        const slugFromUrl = existing.replace(/^.*\/blogs\/wellness\//, '').replace(/^\//, '')
        const s = (r.slug as string) || slugFromUrl
        return { title: (r.title as string) || (r.anchor as string) || (r.primaryKeyword as string) || '', url: existing || (s ? `/blogs/wellness/${s}` : '') }
      }).filter(l => l.title && l.url)
      setClusterLinks(links)
    }).catch(() => {})
  }, [guide.collection_slug])

  const guideForApi = () => ({
    id: guide.id,
    title: guide.title,
    slug: guide.slug,
    topic_short: topic,
    topic_short_plural: topicPlural,
    topic_full: guide.topic_full,
    description: deck,
    collection_slug: guide.collection_slug,
    breadcrumb_l2_name: guide.breadcrumb_l2_name,
    section_plan: plan,
    selected_products: products,
    cluster_links: clusterLinks.map(l => ({ url: l.url, title: l.title })),
  })

  const sectionHtmlMap = () => {
    const out: Record<string, string> = {}
    for (const [k, s] of Object.entries(sections)) if (s.html) out[k] = s.html
    return out
  }

  const assembled = () =>
    assembleGuideHtml(
      {
        title: guide.title,
        slug: guide.slug,
        topic_short: topic,
        topic_short_plural: topicPlural,
        topic_full: guide.topic_full,
        description: deck,
        meta_description: metaDescription,
        breadcrumb_l2_name: guide.breadcrumb_l2_name,
        breadcrumb_l2_slug: guide.breadcrumb_l2_slug,
        collection_slug: guide.collection_slug,
        hero_image_cdn_url: guide.hero_image_cdn_url,
        hero_image_url: guide.hero_image_url,
        date_published: guide.date_published,
        related_guides: guide.related_guides,
        selected_products: products.map(p => ({ title: p.title, handle: p.handle, image_url: p.image_url || '', price: p.price ?? 0, vendor: p.vendor || '', specs: p.specs })) as UltimateGuide['selected_products'],
        cluster_links: clusterLinks.map(l => ({ url: l.url, anchor: l.title })),
        template_version: 2,
        section_plan: plan,
        key_takeaways: takeaways,
        faq_pairs: faq,
      },
      sectionHtmlMap(),
    )

  const previewDoc = useMemo(() => {
    if (!showPreview) return ''
    try { return buildBlogPreviewDocument(assembled()) } catch (e) { return `<pre>${String(e)}</pre>` }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, sections, products, takeaways, faq, deck, plan, clusterLinks])

  // ── Actions ────────────────────────────────────────────────────────────────

  const pickProducts = async () => {
    setBusy('picks')
    try {
      const r = await api<{ products: GuideV2Product[]; poolSize: number }>({ action: 'picks', guide: guideForApi() })
      setProducts(r.products)
      note(`Picked ${r.products.length} of ${r.poolSize} live products`)
      await persist(guide.id, { selected_products: r.products, products_complete: true, template_version: 2 })
      return r.products
    } catch (e) {
      note(`Product pick failed: ${e instanceof Error ? e.message : e}`)
      return products
    } finally {
      setBusy(null)
    }
  }

  const writeSection = async (key: string, currentProducts = products) => {
    const item = plan.find(p => p.key === key)
    if (!item) return
    setBusy(key)
    setActive(key)
    setSections(prev => ({ ...prev, [key]: { ...(prev[key] || { html: '', warnings: [] }), status: 'generating', error: undefined } }))
    try {
      const r = await api<{ html: string; warnings: string[]; words: number }>({
        action: 'section',
        guide: { ...guideForApi(), selected_products: currentProducts },
        section: item,
        sections: sectionHtmlMap(),
        feedback: feedback[key] || '',
        clusterLinks,
      })
      setSections(prev => {
        const next = { ...prev, [key]: { html: r.html, status: 'ready' as const, warnings: r.warnings || [], words: r.words } }
        const map: Record<string, string> = {}
        for (const [k, s] of Object.entries(next)) if (s.html) map[k] = s.html
        persist(guide.id, { section_content: map, section_plan: plan, template_version: 2 })
        return next
      })
      note(`${item.heading}: ${r.words} words${r.warnings?.length ? `, ${r.warnings.length} note(s)` : ''}`)
    } catch (e) {
      setSections(prev => ({ ...prev, [key]: { ...(prev[key] || { html: '', warnings: [] }), status: 'error', error: e instanceof Error ? e.message : String(e) } }))
      note(`${item.heading} failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(null)
    }
  }

  const writeTakeaways = async () => {
    setBusy('takeaways')
    try {
      const r = await api<{ takeaways: { label: string; text: string }[] }>({ action: 'takeaways', guide: guideForApi(), sections: sectionHtmlMap() })
      setTakeaways(r.takeaways)
      await persist(guide.id, { key_takeaways: r.takeaways })
      note(`Takeaways: ${r.takeaways.length}`)
    } catch (e) { note(`Takeaways failed: ${e instanceof Error ? e.message : e}`) } finally { setBusy(null) }
  }

  const writeFaq = async () => {
    setBusy('faq')
    try {
      const r = await api<{ faq: { q: string; a: string }[]; warnings: string[] }>({ action: 'faq', guide: guideForApi(), sections: sectionHtmlMap() })
      setFaq(r.faq)
      await persist(guide.id, { faq_pairs: r.faq })
      note(`FAQ: ${r.faq.length} pairs${r.warnings?.length ? `, ${r.warnings.join('; ')}` : ''}`)
    } catch (e) { note(`FAQ failed: ${e instanceof Error ? e.message : e}`) } finally { setBusy(null) }
  }

  const writeMeta = async () => {
    setBusy('meta')
    try {
      const r = await api<{ metaDescription: string; deck: string }>({ action: 'meta', guide: guideForApi(), sections: sectionHtmlMap() })
      if (r.metaDescription) setMetaDescription(r.metaDescription)
      if (r.deck) setDeck(r.deck)
      await persist(guide.id, { meta_description: r.metaDescription, description: r.deck })
      note('Meta and deck drafted')
    } catch (e) { note(`Meta failed: ${e instanceof Error ? e.message : e}`) } finally { setBusy(null) }
  }

  const generateAll = async () => {
    stopRef.current = false
    let current = products
    if (!current.length) current = await pickProducts()
    for (const item of plan) {
      if (stopRef.current) break
      if (!item.enabled) continue
      await writeSection(item.key, current)
    }
    if (stopRef.current) return
    await writeTakeaways()
    await writeFaq()
    if (!metaDescription) await writeMeta()
  }

  const handleSave = async () => {
    setBusy('save')
    try {
      const html = assembled()
      const map = sectionHtmlMap()
      const updated: UltimateGuide = {
        ...guide,
        html_content: html,
        section_content: map,
        meta_description: metaDescription,
        description: deck,
        selected_products: products.map(p => ({ id: p.handle, title: p.title, handle: p.handle, image_url: p.image_url || '', price: Number(p.price) || 0, vendor: p.vendor || '', specs: p.specs })) as UltimateGuide['selected_products'],
        key_takeaways: takeaways,
        faq_pairs: faq,
        section_plan: plan,
        template_version: 2,
        cluster_links: clusterLinks.map(l => ({ url: l.url, anchor: l.title })),
        content_complete: true,
      }
      await persist(guide.id, {
        html_content: html, section_content: map, meta_description: metaDescription, description: deck,
        selected_products: updated.selected_products, key_takeaways: takeaways, faq_pairs: faq,
        section_plan: plan, template_version: 2, cluster_links: updated.cluster_links, content_complete: true,
      })
      onSave(updated)
    } finally {
      setBusy(null)
    }
  }

  const updatePlan = (key: string, patch: Partial<GuidePlanItem>) =>
    setPlan(prev => prev.map(p => (p.key === key ? { ...p, ...patch } : p)))

  const ready = plan.filter(p => p.enabled && sections[p.key]?.status === 'ready').length
  const wanted = plan.filter(p => p.enabled).length
  const totalWords = Object.values(sections).reduce((n, s) => n + (s.words || 0), 0)
  const current = sections[active]
  const currentPlan = shown.find(p => p.key === active)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <div className="flex-shrink-0 px-8 pt-6 pb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-1">Write the guide</h2>
          <p className="text-sm text-gray-600">
            Template v2. {ready}/{wanted} sections ready{totalWords ? `, ${totalWords.toLocaleString()} words` : ''}. {products.length} products, {takeaways.length} takeaways, {faq.length} FAQ.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowPlan(v => !v)} className="gap-1">
            <ListChecks className="h-4 w-4" /> Plan
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowPreview(v => !v)} className="gap-1">
            {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} Preview
          </Button>
          {busy ? (
            <Button variant="outline" size="sm" onClick={() => { stopRef.current = true }} className="gap-1">
              <Loader2 className="h-4 w-4 animate-spin" /> Stop after this
            </Button>
          ) : (
            <Button size="sm" onClick={generateAll} className="gap-1">
              <Sparkles className="h-4 w-4" /> Generate all
            </Button>
          )}
        </div>
      </div>

      {showPlan && (
        <div className="flex-shrink-0 mx-8 mb-4 rounded-lg border bg-white p-4 max-h-72 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold">Section plan</p>
            <button className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1" onClick={() => setPlan(DEFAULT_GUIDE_PLAN.map(p => ({ ...p })))}>
              <RotateCcw className="h-3 w-3" /> Reset to default
            </button>
          </div>
          <div className="space-y-2">
            {shown.map(p => (
              <div key={p.key} className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1" checked={p.enabled} onChange={e => updatePlan(p.key, { enabled: e.target.checked })} />
                <div className="flex-1 min-w-0">
                  <input
                    className={cn('w-full border-b bg-transparent text-sm font-medium outline-none', !p.enabled && 'text-gray-400')}
                    value={plan.find(x => x.key === p.key)?.heading || ''}
                    onChange={e => updatePlan(p.key, { heading: e.target.value })}
                    title="Use {topic} and {topics} for the subject"
                  />
                  <textarea
                    className="mt-1 w-full text-xs text-gray-600 bg-transparent outline-none resize-y"
                    rows={2}
                    value={plan.find(x => x.key === p.key)?.brief || ''}
                    onChange={e => updatePlan(p.key, { brief: e.target.value })}
                  />
                </div>
                <input
                  type="number"
                  className="w-20 border rounded px-2 py-1 text-xs"
                  value={p.words}
                  onChange={e => updatePlan(p.key, { words: Number(e.target.value) || 600 })}
                  title="Word target"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden min-h-0 px-8 pb-6 gap-4">
        {/* Section nav */}
        <div className="w-64 flex-shrink-0 overflow-y-auto rounded-lg border bg-white">
          <div className="p-3 border-b">
            <button
              onClick={pickProducts}
              disabled={!!busy}
              className="w-full flex items-center justify-between text-sm px-2 py-1.5 rounded hover:bg-gray-50"
            >
              <span className="flex items-center gap-2"><ShoppingBag className="h-4 w-4 text-gray-500" /> Products</span>
              <span className="text-xs text-gray-500">{busy === 'picks' ? <Loader2 className="h-3 w-3 animate-spin" /> : `${products.length} picked`}</span>
            </button>
          </div>
          {shown.filter(p => p.enabled).map(p => {
            const s = sections[p.key]
            const icon = s?.status === 'ready' ? <CheckCircle2 className="h-4 w-4 text-green-600" />
              : s?.status === 'generating' ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              : s?.status === 'error' ? <AlertTriangle className="h-4 w-4 text-red-600" />
              : <Circle className="h-4 w-4 text-gray-300" />
            return (
              <button
                key={p.key}
                onClick={() => setActive(p.key)}
                className={cn('w-full flex items-center gap-2 text-left text-sm px-4 py-2.5 border-b hover:bg-gray-50', active === p.key && 'bg-blue-50')}
              >
                {icon}
                <span className="flex-1 truncate">{p.navLabel || p.heading}</span>
                {s?.warnings?.length ? <span className="text-[10px] text-amber-600">{s.warnings.length}</span> : null}
              </button>
            )
          })}
          <div className="p-3 space-y-1 text-sm">
            <button onClick={writeTakeaways} disabled={!!busy || ready === 0} className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 flex justify-between">
              <span>Takeaways</span><span className="text-xs text-gray-500">{takeaways.length}</span>
            </button>
            <button onClick={writeFaq} disabled={!!busy || ready === 0} className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 flex justify-between">
              <span>FAQ</span><span className="text-xs text-gray-500">{faq.length}</span>
            </button>
            <button onClick={writeMeta} disabled={!!busy || ready === 0} className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 flex justify-between">
              <span>Meta and deck</span><span className="text-xs text-gray-500">{metaDescription ? 'set' : ''}</span>
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
          {showPreview ? (
            <iframe title="Guide preview" className="flex-1 w-full rounded-lg border bg-white" srcDoc={previewDoc} />
          ) : (
            <>
              {active === 'products' ? null : (
                <div className="flex-shrink-0 rounded-lg border bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{currentPlan?.heading}</p>
                      <p className="text-xs text-gray-500 truncate">{currentPlan?.brief}</p>
                    </div>
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => writeSection(active)} className="gap-1 flex-shrink-0">
                      {busy === active ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {current?.html ? 'Regenerate' : 'Generate'}
                    </Button>
                  </div>
                  <textarea
                    className="mt-3 w-full text-sm border rounded px-2 py-1.5"
                    rows={2}
                    placeholder="Feedback for the regenerate (optional): what to change, add or cut"
                    value={feedback[active] || ''}
                    onChange={e => setFeedback(prev => ({ ...prev, [active]: e.target.value }))}
                  />
                  {current?.warnings?.length ? (
                    <ul className="mt-2 text-xs text-amber-700 space-y-0.5">
                      {current.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  ) : null}
                  {current?.error ? <p className="mt-2 text-xs text-red-600">{current.error}</p> : null}
                </div>
              )}

              <div className="flex-1 min-h-0 rounded-lg border bg-white overflow-auto">
                {current?.html ? (
                  <textarea
                    className="w-full h-full p-4 font-mono text-xs outline-none resize-none"
                    value={current.html}
                    onChange={e => setSections(prev => ({ ...prev, [active]: { ...prev[active], html: e.target.value } }))}
                    onBlur={() => persist(guide.id, { section_content: sectionHtmlMap() })}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-gray-400">
                    {current?.status === 'generating' ? 'Writing...' : 'Not written yet'}
                  </div>
                )}
              </div>
            </>
          )}

          {products.length > 0 && !showPreview && (
            <div className="flex-shrink-0 flex flex-wrap gap-2">
              {products.map(p => (
                <span key={p.handle} className="inline-flex items-center gap-1 text-xs bg-white border rounded-full px-2 py-1">
                  {p.vendor ? <span className="text-gray-500">{p.vendor}</span> : null}
                  <span className="max-w-[220px] truncate">{p.title}</span>
                  <button onClick={() => { const next = products.filter(x => x.handle !== p.handle); setProducts(next); persist(guide.id, { selected_products: next }) }} className="text-gray-400 hover:text-red-600"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}

          {log.length > 0 && (
            <div className="flex-shrink-0 max-h-20 overflow-y-auto text-[11px] text-gray-500 font-mono rounded border bg-white px-3 py-2">
              {log.slice(-6).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 flex items-center justify-between px-8 py-4 border-t bg-white">
        <Button variant="outline" onClick={onBack} className="gap-2"><ChevronLeft className="h-4 w-4" /> Back</Button>
        <Button onClick={handleSave} disabled={!!busy || ready === 0} className="gap-2">
          {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save and continue to images <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
