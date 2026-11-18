'use client'

// components/KeywordAudit.tsx
// Collections > Keyword Audit. Research per collection (GSC, Ahrefs candidates,
// competitor pages, SERPs) with an AI recommendation Ryan reviews, edits and
// applies to the audit-queue row and, with a confirm, to the live Shopify SEO.

import { useEffect, useMemo, useRef, useState } from 'react'

type ListRow = {
  slug: string; category: string | null; primary_keyword: string | null; title_tag: string | null
  product_count: number | null; has_recommendation: boolean; rec_primary: string | null; rec_title: string | null
  generated_at: string | null; applied_row_at: string | null; applied_shopify_at: string | null; reviewed: boolean; content_drafted_at?: string | null; content_published_at?: string | null; keep_title?: boolean
  gsc_impressions: string | null; gsc_clicks: string | null; rec_title_len: number | null; rec_meta_len: number | null; has_snapshot?: boolean; primary_missing?: boolean
}
type Rec = { primary: string; secondaries: string[]; title_tag: string; meta_description: string; h1: string; h2_additions: string[]; rationale: string; head_term_verdict: string; risks: string }
type Detail = {
  slug: string; research: any; recommendation: Rec | null; generated_at: string | null; applied_row_at: string | null; applied_shopify_at: string | null; reviewed: boolean; notes: string | null; content_drafted_at?: string | null; content_published_at?: string | null; keep_title?: boolean; must_terms?: string[] | null
  collection: { category: string | null; primary_keyword: string | null; secondary_keywords: string[] | null; title_tag: string | null; meta_description: string | null; product_count: number | null } | null
  shopify: { id: number; title: string; title_tag: string | null; description_tag: string | null } | null
}

const btn = (bg: string, color = '#fff'): React.CSSProperties => ({ background: bg, color, border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' })
const group: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }
const groupLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }
const groupRow: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }
const ghost: React.CSSProperties = { background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }

export function KeywordAudit() {
  const [rows, setRows] = useState<ListRow[]>([])
  const [bundles, setBundles] = useState<Array<{ name: string; count: number }>>([])
  const [filterCat, setFilterCat] = useState('')
  const [filterState, setFilterState] = useState<'all' | 'none' | 'generated' | 'applied' | 'pushed' | 'notpushed'>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [rec, setRec] = useState<Rec | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [bulkLog, setBulkLog] = useState<string[]>([])
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<'name' | 'impressions'>('name')
  const toggleTick = (slug: string) => setTicked((t) => { const n = new Set(t); n.has(slug) ? n.delete(slug) : n.add(slug); return n })
  async function pushTicked() {
    const targets = visible.filter((r) => ticked.has(r.slug) && r.has_recommendation).map((r) => r.slug)
    if (!targets.length) { setMsg('Tick at least one collection with a recommendation'); return }
    if (!window.confirm(`Write title and meta to the LIVE Shopify collections for these ${targets.length} pages?\n\n${targets.join(', ')}\n\nThe current live title and meta are saved first so each page can be reverted. Pages marked "Keep live title" get the meta only.`)) return
    setBusy('bulk'); setBulkLog([]); setMsg(null)
    let ok = 0
    for (const s of targets) {
      const r = await fetch(`/api/collections/keyword-audit/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply', toRow: true, toShopify: true }) })
      const d = await r.json(); if (r.ok) ok++
      setBulkLog((l) => [...l, `${s}: ${r.ok ? 'live on Shopify' : 'FAILED ' + d.error}`])
      await new Promise((res) => setTimeout(res, 1500)) // stay under Shopify's REST rate limit
    }
    setMsg(`Pushed ${ok} of ${targets.length} to Shopify`); setBusy(null); setTicked(new Set()); loadList(); if (selected) loadDetail(selected)
  }
  async function fixPrimary() {
    const targets = visible.filter((r) => r.primary_missing).map((r) => r.slug)
    if (!targets.length) { setMsg('Nothing damaged in this view'); return }
    if (!window.confirm(`Repair ${targets.length} title(s) or meta(s) that lost a keyword word? Minimal rewrite; re-applies to the row where applied. Does not touch Shopify.`)) return
    setBusy('bulk'); setBulkLog([]); setMsg(null)
    const live: string[] = []
    for (const s of targets) {
      const r = await fetch(`/api/collections/keyword-audit/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'fix-primary' }) })
      const d = await r.json()
      if (r.ok && d.changed && d.live) live.push(s)
      setBulkLog((l) => [...l, `${s}: ${r.ok ? (d.changed ? (d.still_missing ? 'rewritten, still missing, check by hand' : 'fixed') + (d.live ? ' (LIVE page, needs re-push)' : '') : 'no change') : 'FAILED ' + d.error}`])
    }
    setBusy(null); loadList(); if (selected) loadDetail(selected)
    if (live.length) { setTicked(new Set(live)); setMsg(`${live.length} corrected page(s) are already live on Shopify and are ticked: review them, then Push ticked to send the fix.`) }
  }
  async function rewriteMetas(slugs: string[]) {
    if (!slugs.length) { setMsg('Nothing to rewrite'); return }
    if (!window.confirm(`Rewrite ${slugs.length} meta description(s) under the benefit-led rule (no brand roll call)? Titles and keywords are kept. Re-applies to the row where applied. Does not touch Shopify.`)) return
    setBusy('bulk'); setBulkLog([]); setMsg(null)
    const live: string[] = []
    for (const s of slugs) {
      const r = await fetch(`/api/collections/keyword-audit/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rewrite-meta' }) })
      const d = await r.json()
      if (r.ok && d.changed && d.live) live.push(s)
      setBulkLog((l) => [...l, `${s}: ${r.ok ? `${d.meta_len} chars${d.brands?.length ? ' (brands: ' + d.brands.join(', ') + ')' : ''}${d.live ? ' LIVE, needs re-push' : ''}` : 'FAILED ' + d.error}`])
    }
    setBusy(null); loadList(); if (selected) loadDetail(selected)
    if (live.length) { setTicked(new Set(live)); setMsg(`${live.length} rewritten page(s) are live on Shopify and are ticked: review, then Push ticked.`) }
  }
  type Cov = { keyword: string; isPrimary: boolean; isTerm?: boolean; inBody: number; inHeadings: boolean; inOpening: boolean; ok: boolean }
  const [terms, setTerms] = useState<string>('')
  async function saveTerms() {
    if (!selected) return
    const list = terms.split(/[\n,]/).map((t) => t.trim()).filter(Boolean)
    await fetch(`/api/collections/keyword-audit/${selected}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ must_terms: list }) })
    setMsg(`Saved ${list.length} must-mention term(s)`); if (detail) setDetail({ ...detail, must_terms: list })
  }
  async function suggestTerms() {
    if (!selected) return; setBusy('terms'); setMsg(null)
    const r = await fetch(`/api/collections/keyword-audit/${selected}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'suggest-terms' }) })
    const d = await r.json(); setBusy(null)
    if (r.ok) { setTerms((d.must_terms || []).join(', ')); if (detail) setDetail({ ...detail, must_terms: d.must_terms }); setMsg(`Suggested ${d.must_terms.length} term(s); edit and save if needed`) } else setMsg(d.error)
  }
  const [coverage, setCoverage] = useState<{ before: Cov[]; after?: Cov[]; weaves?: any[]; sections?: any[]; unplaced?: string[]; scoreBefore?: number; scoreAfter?: number } | null>(null)
  type Draft = { bodyHtml: string; plan: string[]; steps: Array<{ label: string; status: string; detail?: string }>; manualItems: string[]; scoreBefore: number | null; scoreAfter: number | null; createdAt: string }
  const [draft, setDraft] = useState<Draft | null>(null)
  const [showDraft, setShowDraft] = useState(false)
  async function loadDraft(slug: string) {
    setDraft(null); setShowDraft(false)
    const r = await fetch(`/api/collections/improve?slug=${encodeURIComponent(slug)}`)
    if (r.ok) { const d = await r.json(); setDraft({ bodyHtml: d.bodyHtml || '', plan: d.plan || [], steps: d.steps || [], manualItems: d.manualItems || [], scoreBefore: d.scoreBefore, scoreAfter: d.scoreAfter, createdAt: d.createdAt }) }
  }
  async function publishAll() {
    if (!selected || !rec) return
    const hasDraft = !!draft?.bodyHtml
    const what = hasDraft ? 'the drafted copy AND the ' + (detail?.keep_title ? 'meta description (title kept)' : 'title and meta') : (detail?.keep_title ? 'the meta description (title kept)' : 'the title and meta') + ' (no copy draft exists)'
    if (!window.confirm(`Publish ${what} to the LIVE Shopify collection /collections/${selected}?\n\nThe current live title, meta and copy are saved first so the page can be reverted.`)) return
    setBusy('publish'); setMsg(null)
    try {
      const snap = await fetch(`/api/collections/keyword-audit/${selected}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'snapshot-body' }) })
      if (!snap.ok) throw new Error((await snap.json()).error || 'snapshot failed')
      if (hasDraft) {
        // House rule: a draft never introduces a dollar figure. Strip any the draft added, then reload it.
        const sp = await fetch(`/api/collections/keyword-audit/${selected}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'strip-prices', mode: 'new' }) })
        const spd = await sp.json().catch(() => ({}))
        if (sp.ok && spd.changed > 0) { setBulkLog((l) => [...l, `${selected}: removed ${spd.changed} price figure(s) the draft had introduced`]); await loadDraft(selected) }
        // send the live body we started from so figures already on the page cannot block the publish
        let baseline = ''
        try { const cur = await fetch(`/api/shopify/collection-revamp/${encodeURIComponent(selected)}`); if (cur.ok) baseline = String((await cur.json()).body_html || '') } catch { /* optional */ }
        const fresh = await fetch(`/api/collections/improve?slug=${encodeURIComponent(selected)}`).then((r) => r.ok ? r.json() : null).catch(() => null)
        const bodyToPublish = String(fresh?.bodyHtml || draft!.bodyHtml)
        const put = await fetch(`/api/shopify/collection-revamp/${encodeURIComponent(selected)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body_html: bodyToPublish, baseline_html: baseline }) })
        const pd = await put.json().catch(() => ({}))
        if (!put.ok) throw new Error(pd.error || 'copy publish failed')
        if (pd.stalePrices?.length) setBulkLog((l) => [...l, `${selected}: published; stale prices already on the page, worth a fix later: ${pd.stalePrices.join(' | ')}`])
        await fetch(`/api/collections/keyword-audit/${selected}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark-content-published' }) })
        await fetch(`/api/collections/improve?slug=${encodeURIComponent(selected)}`, { method: 'DELETE' }).catch(() => {})
      }
      const ap = await fetch(`/api/collections/keyword-audit/${selected}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply', toRow: true, toShopify: true }) })
      const ad = await ap.json()
      if (!ap.ok) throw new Error(ad.error || 'title/meta publish failed')
      setMsg(hasDraft ? 'Copy, keywords and meta are live on Shopify.' : 'Keywords and meta are live on Shopify.')
    } catch (e) { setMsg('Publish stopped: ' + (e instanceof Error ? e.message : String(e))) }
    setBusy(null); loadList(); loadDetail(selected)
  }
  async function regenerateTicked() {
    const slugs = visible.filter((r) => ticked.has(r.slug)).map((r) => r.slug)
    if (!slugs.length) { setMsg('Tick the collections to regenerate'); return }
    if (!window.confirm(`Regenerate the recommendation (keywords, title, meta) for ${slugs.length} ticked page(s)? Operator notes on each page are applied. Rows already applied are re-applied; Shopify is not touched until you push.`)) return
    stopRef.current = false; setBusy('bulk'); setBulkLog([]); setMsg(null)
    let n = 0
    for (const x of slugs) {
      if (stopRef.current) break
      setMsg(`Regenerating ${++n} of ${slugs.length}: ${x}`)
      const r = await fetch(`/api/collections/keyword-audit/${x}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recommend' }) })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        const row = rows.find((y) => y.slug === x)
        if (row?.applied_row_at) await fetch(`/api/collections/keyword-audit/${x}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply', toRow: true, toShopify: false }) })
      }
      setBulkLog((l) => [...l, `${x}: ${r.ok ? `${d.recommendation?.title_tag} | ${d.recommendation?.meta_description}` : 'FAILED ' + d.error}`])
    }
    setBusy(null); setMsg('Regeneration done; review each page, then Push ticked.'); loadList(); if (selected) loadDetail(selected)
  }
  async function suggestTermsBulk(slugs: string[]) {
    slugs = slugs.filter((x) => { const r = rows.find((y) => y.slug === x); return r?.has_recommendation })
    if (!slugs.length) { setMsg('Tick collections with a recommendation'); return }
    if (!window.confirm(`Suggest must-mention terms for ${slugs.length} page(s)? Pages that already have terms are skipped. About 10 seconds each.`)) return
    stopRef.current = false; setBusy('bulk'); setBulkLog([]); setMsg(null)
    let n = 0
    for (const x of slugs) {
      if (stopRef.current) break
      const cur = await fetch(`/api/collections/keyword-audit/${x}`).then((r) => r.ok ? r.json() : null).catch(() => null)
      if (Array.isArray(cur?.must_terms) && cur.must_terms.length) { setBulkLog((l) => [...l, `${x}: already has ${cur.must_terms.length} term(s)`]); continue }
      setMsg(`Suggesting terms ${++n}: ${x}`)
      const r = await fetch(`/api/collections/keyword-audit/${x}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'suggest-terms' }) })
      const d = await r.json().catch(() => ({}))
      setBulkLog((l) => [...l, `${x}: ${r.ok ? (d.must_terms || []).join(', ') : 'FAILED ' + d.error}`])
    }
    setBusy(null); setMsg('Term suggestions done'); if (selected) loadDetail(selected)
  }
  async function stripPrices(slugs: string[]) {
    if (!slugs.length) { setMsg('Tick at least one collection'); return }
    if (!window.confirm(`Remove every dollar figure from the copy of ${slugs.length} page(s)? Sentences are rewritten to read naturally without the number. Saved to the page's draft (created from the live copy if none exists); nothing goes to Shopify until you push.`)) return
    setBusy('bulk'); setBulkLog([]); setMsg(null)
    for (const s of slugs) {
      const r = await fetch(`/api/collections/keyword-audit/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'strip-prices', mode: 'all' }) })
      const d = await r.json().catch(() => ({}))
      setBulkLog((l) => [...l, `${s}: ${r.ok ? (d.changed ? `${d.changed} price mention(s) rewritten` : 'no prices in the copy') : 'FAILED ' + d.error}`])
    }
    setBusy(null); loadList(); if (selected) { loadDetail(selected) }
  }
  async function checkCoverage() {
    if (!selected) return; setBusy('cov'); setMsg(null); setCoverage(null)
    const r = await fetch(`/api/collections/keyword-audit/${selected}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'coverage' }) })
    const d = await r.json(); if (r.ok) setCoverage({ before: d.coverage }); else setMsg(d.error); setBusy(null)
  }
  const stopRef = useRef(false)
  const normW = (t: string) => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
  const STOPW = new Set(['for', 'sale', 'with', 'and', 'the', 'a', 'of', 'to', 'in', 'on', 'at', 'from', 'home'])
  const hasWords = (text: string, phrase: string) => { const want = normW(phrase).filter((w) => !STOPW.has(w)); const have = new Set(normW(text)); return want.length > 0 && want.every((w) => have.has(w)) }
  function checklist(): Array<{ label: string; ok: boolean | null; note?: string }> {
    if (!rec) return []
    const items: Array<{ label: string; ok: boolean | null; note?: string }> = []
    const head = (rec.title_tag || '').split(/\s*[|:]\s*/)[0]
    items.push({ label: 'Title leads with the primary keyword', ok: hasWords(head, rec.primary) && normW(head)[0] === normW(rec.primary)[0], note: detail?.keep_title ? 'live title kept' : undefined })
    items.push({ label: 'Title 50 to 60 characters', ok: rec.title_tag.length >= 50 && rec.title_tag.length <= 60, note: `${rec.title_tag.length}` })
    items.push({ label: 'Meta carries the primary keyword', ok: hasWords(rec.meta_description, rec.primary) })
    items.push({ label: 'Meta 140 to 158 characters', ok: rec.meta_description.length >= 140 && rec.meta_description.length <= 158, note: `${rec.meta_description.length}` })
    items.push({ label: 'No price in title or meta', ok: !/\$\s?\d/.test(rec.title_tag + rec.meta_description) })
    const brandCount = (rec.meta_description.match(/\b[A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]+)?\b/g) || []).filter((w) => !/^(Shop|Browse|Peak|Primal|Wellness|Compare|Find|Explore|The|For|And|With|From|At|Home|Discover|Choose)$/.test(w)).length
    items.push({ label: 'At most two brands in the meta', ok: brandCount <= 2, note: `${brandCount} capitalised name(s)` })
    const cov = coverage?.after || coverage?.before
    if (cov) {
      const prim = cov.find((c) => c.isPrimary); const secs = cov.filter((c) => !c.isPrimary && !c.isTerm); const tms = cov.filter((c) => c.isTerm)
      items.push({ label: 'Primary in the opening or a heading, twice in copy', ok: !!prim?.ok, note: prim ? `${prim.inBody}x${prim.inHeadings ? ', heading' : ''}${prim.inOpening ? ', opening' : ''}` : undefined })
      items.push({ label: 'Every secondary in a heading and twice in copy', ok: secs.length > 0 && secs.every((c) => c.ok), note: `${secs.filter((c) => c.ok).length}/${secs.length}` })
      if (tms.length) items.push({ label: 'Every must-mention term appears', ok: tms.every((c) => c.ok), note: `${tms.filter((c) => c.ok).length}/${tms.length}` })
    } else items.push({ label: 'Keyword coverage in the copy', ok: null, note: 'click Check coverage' })
    return items
  }
  async function draftContent(slugs: string[], onlyMissing = false) {
    if (onlyMissing) slugs = slugs.filter((s) => !rows.find((r) => r.slug === s)?.content_drafted_at)
    if (!slugs.length) { setMsg(onlyMissing ? 'Every page in this view already has a copy draft' : 'Tick at least one collection with a recommendation'); return }
    if (!window.confirm(`Draft keyword copy for ${slugs.length} page(s)? About a minute each; keep this tab open. Weaves uncovered keywords into existing sentences and adds up to 3 short sections. Saved as drafts for review; nothing goes to Shopify. You can stop any time and resume later with "Draft remaining".`)) return
    stopRef.current = false
    setBusy('bulk'); setBulkLog([]); setMsg(null); setCoverage(null)
    let done = 0, failed = 0
    for (const s of slugs) {
      if (stopRef.current) { setBulkLog((l) => [...l, 'stopped by you']); break }
      setMsg(`Drafting ${done + failed + 1} of ${slugs.length}: ${s}`)
      let r: Response | null = null, d: any = {}
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          r = await fetch(`/api/collections/keyword-audit/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'content-draft' }) })
          d = await r.json().catch(() => ({})); if (r.ok) break
        } catch (e) { d = { error: e instanceof Error ? e.message : String(e) }; r = null }
      }
      if (r?.ok) {
        done++
        if (slugs.length === 1) setCoverage({ before: d.before, after: d.after, weaves: d.weaves, sections: d.sections, unplaced: d.unplaced, scoreBefore: d.scoreBefore, scoreAfter: d.scoreAfter })
        const w = (d.weaves || []).filter((x: any) => x.status === 'applied').length, sec = (d.sections || []).filter((x: any) => x.status === 'added').length
        setBulkLog((l) => [...l, `${s}: ${d.changed ? `${w} weave(s), ${sec} section(s), SEO ${d.scoreBefore} to ${d.scoreAfter}${d.unplaced?.length ? ', unplaced: ' + d.unplaced.join('; ') : ''}` : 'nothing to add, all keywords already in the copy'}`])
      } else { failed++; setBulkLog((l) => [...l, `${s}: FAILED ${d.error || 'network'} (re-run with Draft remaining)`]) }
      if ((done + failed) % 10 === 0) loadList()
    }
    setBusy(null); loadList(); if (selected) loadDetail(selected)
    setMsg(`Drafting finished: ${done} drafted, ${failed} failed${failed ? ' (click Draft remaining to retry the failures)' : ''}. Review and push each page from its detail panel.`)
  }
  async function revertTicked() {
    const targets = visible.filter((r) => ticked.has(r.slug) && r.applied_shopify_at && r.has_snapshot).map((r) => r.slug)
    if (!targets.length) { setMsg('Tick pushed collections that have a pre-push snapshot'); return }
    if (!window.confirm(`Restore the pre-push title and meta on Shopify for these ${targets.length} pages?\n\n${targets.join(', ')}`)) return
    setBusy('bulk'); setBulkLog([]); setMsg(null)
    for (const s of targets) {
      const r = await fetch(`/api/collections/keyword-audit/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revert-shopify' }) })
      const d = await r.json()
      setBulkLog((l) => [...l, `${s}: ${r.ok ? 'reverted' : 'FAILED ' + d.error}`])
    }
    setBusy(null); setTicked(new Set()); loadList(); if (selected) loadDetail(selected)
  }

  async function loadList() {
    const r = await fetch('/api/collections/keyword-audit'); const d = await r.json()
    if (r.ok) { setRows(d.rows || []); setBundles(d.bundles || []) } else setMsg(d.error)
  }
  async function loadDetail(slug: string) {
    setSelected(slug); setDetail(null); setRec(null); setCoverage(null); loadDraft(slug)
    const r = await fetch(`/api/collections/keyword-audit/${slug}`); const d = await r.json()
    if (r.ok) { setDetail(d); setRec(d.recommendation); setTerms(Array.isArray(d.must_terms) ? d.must_terms.join(', ') : '') } else setMsg(d.error)
  }
  useEffect(() => { loadList() }, [])

  const cats = useMemo(() => Array.from(new Set(rows.map((r) => r.category || 'Unsorted'))).sort(), [rows])
  const visible = rows.filter((r) => (!filterCat || (r.category || 'Unsorted') === filterCat) && (
    filterState === 'all' || (filterState === 'none' && !r.has_recommendation) || (filterState === 'generated' && r.has_recommendation && !r.applied_row_at) || (filterState === 'applied' && !!r.applied_row_at)
    || (filterState === 'pushed' && !!r.applied_shopify_at) || (filterState === 'notpushed' && r.has_recommendation && !r.applied_shopify_at)))
    .sort((a, b) => sortBy === 'impressions' ? Number(b.gsc_impressions || 0) - Number(a.gsc_impressions || 0) : a.slug.localeCompare(b.slug))

  async function importBundle() {
    setBusy('import'); setMsg(null)
    const r = await fetch('/api/collections/keyword-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bundle: 'all' }) })
    const d = await r.json(); setMsg(r.ok ? `Imported ${d.upserted} collections` : d.error); setBusy(null); loadList()
  }
  async function importFile(file: File) {
    setBusy('import'); setMsg(null)
    try {
      const rowsIn = JSON.parse(await file.text())
      const r = await fetch('/api/collections/keyword-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: rowsIn }) })
      const d = await r.json(); setMsg(r.ok ? `Imported ${d.upserted} collections from ${file.name}` : d.error)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(null); loadList()
  }
  async function generate(slug: string) {
    const r = await fetch(`/api/collections/keyword-audit/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recommend' }) })
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'generate failed'); return d.recommendation as Rec
  }
  async function generateOne() {
    if (!selected) return; setBusy('gen'); setMsg(null)
    try { const g = await generate(selected); setRec(g); setDetail((d) => d ? { ...d, recommendation: g, generated_at: new Date().toISOString() } : d); loadList() } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(null)
  }
  async function saveEdits() {
    if (!selected || !rec) return; setBusy('save')
    const r = await fetch(`/api/collections/keyword-audit/${selected}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recommendation: rec }) })
    setMsg(r.ok ? 'Edits saved' : 'Save failed'); setBusy(null); loadList()
  }
  async function apply(toShopify: boolean) {
    if (!selected || !rec) return
    if (rec !== detail?.recommendation) await saveEdits()
    if (toShopify && !window.confirm(`Write this title and meta description to the LIVE Shopify collection /collections/${selected}?\n\n${rec.title_tag}\n${rec.meta_description}`)) return
    setBusy('apply'); setMsg(null)
    const r = await fetch(`/api/collections/keyword-audit/${selected}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply', toRow: true, toShopify }) })
    const d = await r.json(); setMsg(r.ok ? (toShopify ? 'Applied to the row and to Shopify' : 'Applied to the audit-queue row') : d.error); setBusy(null); loadList(); loadDetail(selected)
  }
  const [seed, setSeed] = useState('')
  async function fetchIdeas() {
    if (!selected || !seed.trim()) return
    if (!window.confirm(`Pull Ahrefs keyword ideas for "${seed.trim()}"? About 4,000 Ahrefs API units.`)) return
    setBusy('ideas'); setMsg(null)
    const r = await fetch(`/api/collections/keyword-audit/${selected}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'fetch-ideas', seed: seed.trim() }) })
    const d = await r.json(); setMsg(r.ok ? `Added ${d.added} candidates (${d.total} total)` : d.error); setBusy(null); if (r.ok) loadDetail(selected)
  }
  async function toggleReviewed() {
    if (!detail) return
    await fetch(`/api/collections/keyword-audit/${detail.slug}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed: !detail.reviewed }) })
    setDetail({ ...detail, reviewed: !detail.reviewed }); loadList()
  }
  async function toggleKeepTitle() {
    if (!detail) return
    const next = !detail.keep_title
    await fetch(`/api/collections/keyword-audit/${detail.slug}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keep_title: next }) })
    setDetail({ ...detail, keep_title: next }); loadList()
  }
  const tooLong = (r: ListRow) => r.has_recommendation && ((r.rec_title_len || 0) > 60 || (r.rec_meta_len || 0) > 158)
  async function fixLengths() {
    const targets = visible.filter(tooLong).map((r) => r.slug)
    if (!targets.length) { setMsg('No long titles or metas in this view'); return }
    if (!window.confirm(`Shorten ${targets.length} over-long title(s) or meta(s)? Keeps primary, brands and price; re-applies to the row where already applied. Does not touch Shopify.`)) return
    setBusy('bulk'); setBulkLog([])
    for (const s of targets) {
      const r = await fetch(`/api/collections/keyword-audit/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'fix-lengths' }) })
      const d = await r.json()
      setBulkLog((l) => [...l, `${s}: ${r.ok ? `${d.changed.join('+') || 'no change'} (title ${d.title_len}, meta ${d.meta_len})` : 'FAILED ' + d.error}`])
    }
    setBusy(null); loadList(); if (selected) loadDetail(selected)
  }
  async function validateFacts(all: boolean) {
    const targets = all ? visible.filter((r) => r.has_recommendation).map((r) => r.slug) : selected ? [selected] : []
    if (!targets.length) return
    if (all && !window.confirm(`Check ${targets.length} title(s) and meta(s) against the rules (brands carried and in stock, no prices, no store name) and repair what fails? Re-applies rows; does not touch Shopify. Repaired pages that are live get ticked so you can push just those.`)) return
    stopRef.current = false
    setBusy('bulk'); setBulkLog([]); setMsg(null)
    let fixed = 0; const live: string[] = []
    for (const s of targets) {
      if (stopRef.current) break
      setMsg(`Validating ${fixed} repaired so far: ${s}`)
      const r = await fetch(`/api/collections/keyword-audit/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'validate-facts' }) })
      const d = await r.json()
      if (r.ok && d.issues?.length) { fixed++; if (rows.find((y) => y.slug === s)?.applied_shopify_at) live.push(s) }
      setBulkLog((l) => [...l, `${s}: ${!r.ok ? 'FAILED ' + d.error : d.issues?.length ? `fixed ${d.issues.map((i: any) => i.value).join(', ')}${d.remaining?.length ? ` (still: ${d.remaining.map((i: any) => i.value).join(', ')})` : ''}` : 'clean'}`])
    }
    setBusy(null); loadList(); if (selected) loadDetail(selected)
    if (live.length) { setTicked(new Set(live)); setMsg(`Validated ${targets.length}, repaired ${fixed}. ${live.length} repaired page(s) are live and now ticked: review, then Push ticked to update just those.`) }
    else setMsg(`Validated ${targets.length}, repaired ${fixed}`)
  }
  async function generateAllMissing() {
    const targets = visible.filter((r) => !r.has_recommendation).map((r) => r.slug)
    if (!targets.length) { setMsg('Nothing to generate in this view'); return }
    if (!window.confirm(`Generate recommendations for ${targets.length} collection(s)? Uses the app's Anthropic key, roughly 30 seconds each.`)) return
    setBusy('bulk'); setBulkLog([])
    for (const s of targets) {
      try { await generate(s); setBulkLog((l) => [...l, `${s}: done`]) } catch (e) { setBulkLog((l) => [...l, `${s}: FAILED ${e instanceof Error ? e.message : e}`]) }
    }
    setBusy(null); loadList()
  }
  async function applyAllGenerated() {
    const targets = visible.filter((r) => r.has_recommendation && !r.applied_row_at).map((r) => r.slug)
    if (!targets.length) { setMsg('Nothing to apply in this view'); return }
    if (!window.confirm(`Apply ${targets.length} generated recommendation(s) to their audit-queue rows (keywords, title tag, meta)? This does NOT touch Shopify.`)) return
    setBusy('bulk'); setBulkLog([])
    for (const s of targets) {
      const r = await fetch(`/api/collections/keyword-audit/${s}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply', toRow: true, toShopify: false }) })
      setBulkLog((l) => [...l, `${s}: ${r.ok ? 'applied to row' : 'FAILED'}`])
    }
    setBusy(null); loadList()
  }

  const R = detail?.research
  const len = (s: string) => `${(s || '').length} chars`

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* list */}
      <div style={{ width: 620, minWidth: 620, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} style={{ fontSize: 12, flex: 1, padding: 6 }}><option value="">All hubs</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select value={filterState} onChange={(e) => setFilterState(e.target.value as any)} style={{ fontSize: 12, flex: 1, padding: 6 }}>
            <option value="all">All states</option><option value="none">No recommendation</option><option value="generated">Generated, not applied</option><option value="applied">Applied to row</option><option value="pushed">Live on Shopify</option><option value="notpushed">Not yet on Shopify</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} style={{ fontSize: 12, flex: 1, padding: 6 }}><option value="name">A to Z</option><option value="impressions">Most impressions</option></select>
        </div>
        <div style={group}>
          <div style={groupLabel}>Rollout · {rows.filter((r) => r.applied_shopify_at).length} live · {ticked.size} ticked</div>
          <div style={groupRow}>
            <button style={btn('#be123c')} disabled={busy !== null || ticked.size === 0} onClick={pushTicked}>Push ticked to Shopify ({ticked.size})</button>
            <button style={ghost} disabled={busy !== null || ticked.size === 0} onClick={revertTicked}>Revert ticked</button>
            <button style={ghost} disabled={busy !== null || visible.length === 0} onClick={() => setTicked(new Set(visible.map((r) => r.slug)))}>Tick all in view ({visible.length})</button>
            <button style={ghost} disabled={busy !== null || ticked.size === 0} onClick={() => setTicked(new Set())}>Clear ticks</button>
          </div>
        </div>
        <div style={group}>
          <div style={groupLabel}>Quality passes · run on the view, or on ticked rows</div>
          <div style={groupRow}>
            <button style={btn('#4338ca')} disabled={busy !== null} onClick={() => rewriteMetas(ticked.size ? visible.filter((r) => ticked.has(r.slug) && r.has_recommendation).map((r) => r.slug) : visible.filter((r) => r.has_recommendation).map((r) => r.slug))}>Rewrite metas ({ticked.size ? `${ticked.size} ticked` : visible.filter((r) => r.has_recommendation).length})</button>
            <button style={btn('#0f766e')} disabled={busy !== null} onClick={() => validateFacts(true)}>Validate brands and prices ({visible.filter((r) => r.has_recommendation).length})</button>
            <button style={btn('#9f1239')} disabled={busy !== null} onClick={fixPrimary}>Repair damaged ({visible.filter((r) => r.primary_missing).length})</button>
            <button style={btn('#b45309')} disabled={busy !== null} onClick={fixLengths}>Fix long titles and metas ({visible.filter(tooLong).length})</button>
          </div>
        </div>
        <div style={group}>
          <div style={groupLabel}>Content phase · keywords into the copy · drafts only</div>
          <div style={groupRow}>
            <button style={btn('#0369a1')} disabled={busy !== null} onClick={() => draftContent(visible.filter((r) => r.has_recommendation).map((r) => r.slug), true)}>Draft remaining in view ({visible.filter((r) => r.has_recommendation && !r.content_drafted_at).length})</button>
            <button style={ghost} disabled={busy !== null || ticked.size === 0} onClick={() => draftContent(visible.filter((r) => ticked.has(r.slug) && r.has_recommendation).map((r) => r.slug))}>Re-draft ticked ({ticked.size})</button>
            <button style={ghost} disabled={busy !== null || ticked.size === 0} onClick={() => suggestTermsBulk(visible.filter((r) => ticked.has(r.slug)).map((r) => r.slug))}>Suggest terms for ticked ({ticked.size})</button>
            <button style={ghost} disabled={busy !== null || ticked.size === 0} onClick={() => stripPrices(visible.filter((r) => ticked.has(r.slug)).map((r) => r.slug))}>Strip prices from ticked ({ticked.size})</button>
            {busy === 'bulk' && <button style={ghost} onClick={() => { stopRef.current = true }}>Stop after this page</button>}
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{rows.filter((r) => r.content_drafted_at).length} drafted · {rows.filter((r) => r.content_published_at).length} copy live</span>
          </div>
        </div>
        <div style={group}>
          <div style={groupLabel}>Generate and apply</div>
          <div style={groupRow}>
            <button style={btn('#7c3aed')} disabled={busy !== null} onClick={generateAllMissing}>Generate all missing ({visible.filter((r) => !r.has_recommendation).length})</button>
            <button style={btn('#6d28d9')} disabled={busy !== null || ticked.size === 0} onClick={regenerateTicked}>Regenerate ticked ({ticked.size})</button>
            <button style={btn('#047857')} disabled={busy !== null} onClick={applyAllGenerated}>Apply generated to rows ({visible.filter((r) => r.has_recommendation && !r.applied_row_at).length})</button>
            <button style={ghost} disabled={busy !== null} onClick={importBundle}>Load bundled research ({bundles.reduce((s, b) => s + b.count, 0)})</button>
            <label style={ghost}>Import JSON<input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
          </div>
        </div>
        {msg && <div style={{ fontSize: 12, padding: 8, border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8 }}>{msg}</div>}
        {bulkLog.length > 0 && <div style={{ fontSize: 11, fontFamily: 'monospace', maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 6, marginBottom: 8 }}>{bulkLog.map((l, i) => <div key={i}>{l}</div>)}</div>}
        {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>No research loaded yet. Click "Load bundled research".</div>}
        {visible.map((r) => (
          <div key={r.slug} onClick={() => loadDetail(r.slug)} style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4, background: selected === r.slug ? 'var(--gtd-accent-light)' : 'transparent', border: '1px solid ' + (selected === r.slug ? 'var(--gtd-accent)' : 'var(--border)') }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
              <span><input type="checkbox" checked={ticked.has(r.slug)} onClick={(e) => e.stopPropagation()} onChange={() => toggleTick(r.slug)} style={{ marginRight: 6 }} />{r.slug}</span>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{r.category || 'Unsorted'}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              GSC {r.gsc_impressions || 0} impr / {r.gsc_clicks || 0} clicks
              {r.has_recommendation ? ` · rec: ${r.rec_primary}` : ' · no recommendation'}{tooLong(r) ? ' · LONG' : ''}{r.primary_missing ? ' · DAMAGED' : ''}
              {r.applied_row_at ? ' · row ✓' : ''}{r.applied_shopify_at ? ` · live ${r.applied_shopify_at.slice(0, 10)}` : ''}{r.reviewed ? ' · reviewed' : ''}{r.content_drafted_at ? ' · copy drafted' : ''}{r.keep_title ? ' · keeps title' : ''}{r.content_published_at ? ' · copy live' : ''}
            </div>
          </div>
        ))}
      </div>

      {/* detail */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {!detail && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{selected ? 'Loading…' : 'Pick a collection on the left.'}</div>}
        {detail && R && (
          <div style={{ maxWidth: 980 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>/collections/{detail.slug} <a href={`https://greenthumbdepot.com/collections/${detail.slug}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, marginLeft: 8 }}>open</a></h2>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Research pulled {R.pulled} · GSC {R.gsc.period}: {R.gsc.impressions} impressions, {R.gsc.clicks} clicks, {R.gsc.queries} queries · {detail.collection?.product_count ?? '?'} products</div>

            <section style={{ marginBottom: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Live now</div>
              <div style={{ fontSize: 12 }}><b>Shopify title tag:</b> {detail.shopify?.title_tag || R.live.title || '(none)'} </div>
              <div style={{ fontSize: 12 }}><b>Shopify meta:</b> {detail.shopify?.description_tag || R.live.meta || '(none)'}</div>
              <div style={{ fontSize: 12 }}><b>H1:</b> {R.live.h1.join(' / ')} · <b>H2s:</b> {R.live.h2s.join(' · ')}</div>
              <div style={{ fontSize: 12 }}><b>Row keywords:</b> {detail.collection?.primary_keyword || '(none)'}{detail.collection?.secondary_keywords?.length ? ` + ${detail.collection.secondary_keywords.join(', ')}` : ''}</div>
            </section>

            <section style={{ marginBottom: 14, padding: 12, border: '2px solid var(--gtd-accent)', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Recommendation {detail.generated_at ? <span style={{ fontWeight: 400, color: 'var(--text3)' }}>· generated {new Date(detail.generated_at).toLocaleString()}</span> : null}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={btn('#7c3aed')} disabled={busy !== null} onClick={generateOne}>{busy === 'gen' ? 'Generating…' : rec ? 'Regenerate' : 'Generate'}</button>
                  {rec && <button style={ghost} disabled={busy !== null} onClick={saveEdits}>Save edits</button>}
                  {rec && <button style={ghost} disabled={busy !== null} onClick={() => validateFacts(false)}>Validate facts</button>}
                  {rec && selected && <button style={ghost} disabled={busy !== null} onClick={() => rewriteMetas([selected])}>Rewrite meta</button>}
                  {rec && <button style={btn('#047857')} disabled={busy !== null} onClick={() => apply(false)}>Apply to row</button>}
                  {rec && <button style={btn('#b91c1c')} disabled={busy !== null} onClick={() => apply(true)}>Apply + push to Shopify</button>}
                  <button style={ghost} onClick={toggleReviewed}>{detail.reviewed ? 'Reviewed ✓' : 'Mark reviewed'}</button>
                  <label style={{ ...ghost, display: 'inline-flex', alignItems: 'center', gap: 4, background: detail.keep_title ? '#fef3c7' : ghost.background }} title="Push keywords and meta only; the live title tag stays as it is"><input type="checkbox" checked={!!detail.keep_title} onChange={toggleKeepTitle} />Keep live title</label>
                </div>
              </div>
              {!rec && <div style={{ fontSize: 12, color: 'var(--text3)' }}>No recommendation yet.</div>}
              {rec && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ fontSize: 12 }}>Primary<input value={rec.primary} onChange={(e) => setRec({ ...rec, primary: e.target.value })} style={{ width: '100%', fontSize: 13 }} /></label>
                  <label style={{ fontSize: 12 }}>Secondaries (comma separated)<input value={rec.secondaries.join(', ')} onChange={(e) => setRec({ ...rec, secondaries: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} style={{ width: '100%', fontSize: 13 }} /></label>
                  <label style={{ fontSize: 12 }}>Title tag <span style={{ color: rec.title_tag.length > 60 ? '#b91c1c' : 'var(--text3)' }}>({len(rec.title_tag)})</span><input value={rec.title_tag} onChange={(e) => setRec({ ...rec, title_tag: e.target.value })} style={{ width: '100%', fontSize: 13 }} /></label>
                  <label style={{ fontSize: 12 }}>Meta description <span style={{ color: rec.meta_description.length > 160 ? '#b91c1c' : 'var(--text3)' }}>({len(rec.meta_description)})</span><textarea value={rec.meta_description} onChange={(e) => setRec({ ...rec, meta_description: e.target.value })} style={{ width: '100%', fontSize: 13, minHeight: 48 }} /></label>
                  <label style={{ fontSize: 12 }}>H1<input value={rec.h1} onChange={(e) => setRec({ ...rec, h1: e.target.value })} style={{ width: '100%', fontSize: 13 }} /></label>
                  <label style={{ fontSize: 12 }}>H2 sections to add (one per line)<textarea value={rec.h2_additions.join('\n')} onChange={(e) => setRec({ ...rec, h2_additions: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} style={{ width: '100%', fontSize: 13, minHeight: 80 }} /></label>
                  <div style={{ fontSize: 12 }}><b>Head term verdict:</b> {rec.head_term_verdict}</div>
                  <div style={{ fontSize: 12 }}><b>Rationale:</b> {rec.rationale}</div>
                  <div style={{ fontSize: 12 }}><b>Risks:</b> {rec.risks}</div>
                </div>
              )}
            </section>

            {rec && selected && (
              <section style={{ marginBottom: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Content phase · keywords in the live copy{detail.content_drafted_at ? <span style={{ fontWeight: 400, color: 'var(--text3)' }}> · draft saved {new Date(detail.content_drafted_at).toLocaleDateString()}</span> : null}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={ghost} disabled={busy !== null} onClick={checkCoverage}>{busy === 'cov' ? 'Checking…' : 'Check coverage'}</button>
                    <button style={btn('#0369a1')} disabled={busy !== null} onClick={() => draftContent([selected])}>Draft keyword copy</button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  <button style={btn('#b91c1c')} disabled={busy !== null} onClick={publishAll}>{busy === 'publish' ? 'Publishing…' : draft?.bodyHtml ? `Push copy + ${detail.keep_title ? 'meta' : 'title & meta'} to Shopify` : `Push ${detail.keep_title ? 'meta' : 'title & meta'} to Shopify (no copy draft)`}</button>
                  {draft?.bodyHtml && <button style={ghost} onClick={() => setShowDraft(!showDraft)}>{showDraft ? 'Hide draft' : 'Preview draft copy'}</button>}
                  <button style={ghost} disabled={busy !== null} onClick={() => stripPrices([selected])}>Strip all prices from copy</button>
                  {draft?.bodyHtml && <span style={{ fontSize: 11, color: 'var(--text3)' }}>draft {new Date(draft.createdAt).toLocaleString()} · SEO {draft.scoreBefore} to {draft.scoreAfter}</span>}
                  {!draft?.bodyHtml && <span style={{ fontSize: 11, color: 'var(--text3)' }}>no copy draft yet</span>}
                </div>
                {draft?.bodyHtml && draft.steps.length > 0 && (
                  <div style={{ fontSize: 12, marginBottom: 8 }}>
                    {draft.steps.map((st, i) => <div key={i} style={{ color: st.status === 'done' ? 'inherit' : 'var(--text3)' }}>{st.status === 'done' ? '✓' : '·'} {st.label}{st.detail ? `: ${st.detail}` : ''}</div>)}
                    {draft.manualItems.map((m, i) => <div key={'m' + i} style={{ color: '#b45309' }}>{m}</div>)}
                  </div>
                )}
                {showDraft && draft?.bodyHtml && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, maxHeight: 520, overflowY: 'auto', background: 'var(--bg)', fontSize: 13, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: draft.bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, '') }} />
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 8 }}>
                  <label style={{ fontSize: 12, flex: 1 }}>Must-mention terms (vocabulary an expert page uses once; comma separated)<textarea value={terms} onChange={(e) => setTerms(e.target.value)} style={{ width: '100%', fontSize: 12, minHeight: 40 }} /></label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 16 }}>
                    <button style={ghost} disabled={busy !== null} onClick={suggestTerms}>{busy === 'terms' ? 'Thinking…' : 'Suggest terms'}</button>
                    <button style={ghost} disabled={busy !== null} onClick={saveTerms}>Save terms</button>
                  </div>
                </div>
                <div style={{ fontSize: 12, marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                  {checklist().map((c, i) => <div key={i} style={{ color: c.ok === null ? 'var(--text3)' : c.ok ? '#047857' : '#b91c1c' }}>{c.ok === null ? '·' : c.ok ? '✓' : '✗'} {c.label}{c.note ? <span style={{ color: 'var(--text3)' }}> ({c.note})</span> : null}</div>)}
                </div>
                {coverage && (
                  <div style={{ fontSize: 12 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr style={{ textAlign: 'left', color: 'var(--text3)' }}><th>Keyword</th><th>In copy</th><th>In a heading</th><th>In opening</th>{coverage.after && <th>After draft</th>}<th>Target</th></tr></thead>
                      <tbody>{coverage.before.map((c, i) => <tr key={c.keyword} style={{ borderTop: '1px solid var(--border)' }}><td>{c.isPrimary ? <b>{c.keyword}</b> : c.isTerm ? <span style={{ color: 'var(--text3)' }}>{c.keyword} (term)</span> : c.keyword}</td><td>{c.inBody ? `${c.inBody}x` : <span style={{ color: '#b91c1c' }}>missing</span>}</td><td>{c.inHeadings ? 'yes' : 'no'}</td><td>{c.inOpening ? 'yes' : 'no'}</td>{coverage.after && <td>{coverage.after[i]?.inBody ? `${coverage.after[i].inBody}x${coverage.after[i].inHeadings ? ', heading' : ''}` : <span style={{ color: '#b91c1c' }}>still missing</span>}</td>}<td>{(coverage.after ? coverage.after[i] : c)?.ok ? <span style={{ color: '#047857' }}>met</span> : <span style={{ color: '#b45309' }}>{c.isTerm ? 'once' : c.isPrimary ? 'opening + heading, 2x' : 'heading + 2x'}</span>}</td></tr>)}</tbody>
                    </table>
                    {coverage.scoreBefore != null && <div style={{ marginTop: 6 }}>SEO grade {coverage.scoreBefore} to {coverage.scoreAfter}</div>}
                    {coverage.weaves?.map((w: any, i: number) => <div key={'w' + i} style={{ marginTop: 4, color: w.status === 'applied' ? 'inherit' : 'var(--text3)' }}><b>Weave</b> "{w.keyword}": {w.status === 'applied' ? w.sentence : `skipped (${w.why})`}</div>)}
                    {coverage.sections?.map((x: any, i: number) => <div key={'s' + i} style={{ marginTop: 4, color: x.status === 'added' ? 'inherit' : 'var(--text3)' }}><b>Section</b> "{x.h2}": {x.status === 'added' ? `added, carries ${x.keywords.join(', ')}` : `skipped (${x.why})`}</div>)}
                    {coverage.unplaced?.length ? <div style={{ marginTop: 4, color: '#b45309' }}>Could not place naturally: {coverage.unplaced.join('; ')}</div> : null}
                    {coverage.after && <div style={{ marginTop: 6, color: 'var(--text3)' }}>Draft saved. Open Collections, then Audit Queue, pick this collection, review the Improve preview and publish from there.</div>}
                  </div>
                )}
              </section>
            )}

            <details open style={{ marginBottom: 10 }}><summary style={{ fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Search Console queries (top 40)</summary>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><thead><tr><th align="left">query</th><th align="right">impr</th><th align="right">clicks</th><th align="right">pos</th></tr></thead>
                <tbody>{R.gsc.top.map((q: any) => <tr key={q.q} style={{ borderTop: '1px solid var(--border)' }}><td>{q.q}</td><td align="right">{q.impr}</td><td align="right">{q.clicks}</td><td align="right">{q.pos}</td></tr>)}</tbody></table>
            </details>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
              <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder={`Ahrefs seed, e.g. ${detail.slug.replace(/-/g, ' ')}`} style={{ fontSize: 12, flex: 1, maxWidth: 320 }} />
              <button style={ghost} disabled={busy !== null || !seed.trim()} onClick={fetchIdeas}>{busy === 'ideas' ? 'Fetching…' : 'Fetch Ahrefs ideas'}</button>
              {R.seeds_fetched?.length ? <span style={{ color: 'var(--text3)' }}>fetched: {R.seeds_fetched.join(', ')}</span> : null}
            </div>
            <details style={{ marginBottom: 10 }}><summary style={{ fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Keyword candidates (Ahrefs, {R.candidates.length})</summary>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><thead><tr><th align="left">keyword</th><th align="right">vol</th><th align="right">KD</th><th align="right">cpc</th><th align="left">intent</th><th align="left">parent</th></tr></thead>
                <tbody>{R.candidates.map((c: any) => <tr key={c.kw} style={{ borderTop: '1px solid var(--border)' }}><td>{c.kw}</td><td align="right">{c.vol}</td><td align="right">{c.kd ?? ''}</td><td align="right">{c.cpc}</td><td>{(c.intent || []).map((i: string) => i.slice(0, 3)).join(',')}</td><td>{c.parent || ''}</td></tr>)}</tbody></table>
            </details>
            <details style={{ marginBottom: 10 }}><summary style={{ fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Competitor pages ranking for this topic ({R.competitor_pages.length})</summary>
              {R.competitor_pages.map((p: any) => <div key={p.url} style={{ fontSize: 12, padding: '6px 0', borderTop: '1px solid var(--border)' }}><a href={p.url} target="_blank" rel="noreferrer">{p.url}</a><div style={{ color: 'var(--text3)' }}>{p.keywords.map((k: any) => `${k.kw} (#${k.pos}, ${k.vol})`).join(' · ')}</div></div>)}
            </details>
            {R.serps.map((s: any) => (
              <details key={s.keyword} style={{ marginBottom: 10 }}><summary style={{ fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>SERP: "{s.keyword}" (marketplaces and forums removed)</summary>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><thead><tr><th align="left">pos</th><th align="left">domain</th><th align="right">DR</th><th align="right">RDs</th><th align="right">traffic</th><th align="left">title</th></tr></thead>
                  <tbody>{s.top.map((t: any, i: number) => <tr key={i} style={{ borderTop: '1px solid var(--border)' }}><td>{t.pos}</td><td>{t.domain}</td><td align="right">{t.dr ?? ''}</td><td align="right">{t.rds ?? ''}</td><td align="right">{t.traffic ?? ''}</td><td>{t.title || ''}</td></tr>)}</tbody></table>
              </details>
            ))}
            {R.ahrefs_own.length > 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Ahrefs sees this URL ranking for: {R.ahrefs_own.map((k: any) => `${k.kw} (#${k.pos}, ${k.vol})`).join(' · ')}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
