'use client'

// components/CollectionsRepository.tsx
//
// "All Collections" view. Every live collection with its keyword research,
// meta fields, tags and build state in one table. Includes:
//   - Import CSV button (with a safe preview step before anything is written)
//   - Export CSV button (respects the active filters)
//   - Sync from Shopify button (pulls any collection the table doesn't know)
//   - Click a collection name to open the edit panel (CollectionDetail)
//
// This view replaces the GTD_Complete_Collection_Optimization spreadsheet.

import { useEffect, useMemo, useRef, useState } from 'react'
import { CollectionDetail } from '@/components/CollectionDetail'

type Row = Record<string, any>

/** Stage is derived, never stored. Two fields decide it. */
function stageOf(r: Row): 'Done' | 'Needs content' | 'Needs research' | 'Needs both' {
  const hasKeyword = !!(r.primary_keyword && String(r.primary_keyword).trim())
  const hasContent = Number(r.word_count ?? 0) >= 300
  if (hasKeyword && hasContent) return 'Done'
  if (hasKeyword) return 'Needs content'
  if (hasContent) return 'Needs research'
  return 'Needs both'
}

const STAGE_TONE: Record<string, string> = {
  'Done': 'bg-green-100 text-green-800',
  'Needs content': 'bg-amber-100 text-amber-800',
  'Needs research': 'bg-blue-100 text-blue-800',
  'Needs both': 'bg-red-100 text-red-800',
}

const COLUMNS: Array<{ key: string; label: string; align?: 'right' }> = [
  { key: 'slug', label: 'Collection' },
  { key: '_stage', label: 'Stage' },
  { key: 'category', label: 'Category' },
  { key: 'collection_type', label: 'Type' },
  { key: 'primary_keyword', label: 'Primary keyword' },
  { key: 'search_volume', label: 'Volume', align: 'right' },
  { key: 'kd', label: 'KD', align: 'right' },
  { key: 'product_count', label: 'Products', align: 'right' },
  { key: 'word_count', label: 'Words', align: 'right' },
  { key: 'tags', label: 'Tags' },
  { key: 'title_tag', label: 'Title tag' },
  { key: 'meta_description', label: 'Meta description' },
  { key: 'status', label: 'Status' },
  { key: 'is_published', label: 'Published' },
]

interface ImportPreview {
  fileName: string
  csvText: string
  report: any
}

export function CollectionsRepository() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [stage, setStage] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState('')
  const [createOnly, setCreateOnly] = useState(false)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'search_volume', dir: -1 })
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importing, setImporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [bulk, setBulk] = useState<{ done: number; total: number; running: boolean } | null>(null)
  const bulkStop = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/collections/export?format=json')
      const data = await res.json()
      setRows((data.collections ?? []).map((r: Row) => ({ ...r, _stage: stageOf(r) })))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  /* ── Import flow: pick file, preview (dry run), then apply ── */

  async function onFilePicked(file: File) {
    const csvText = await file.text()
    try {
      const res = await fetch('/api/collections/import?dryRun=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText }),
      })
      const report = await res.json()
      if (!res.ok) throw new Error(report.error || 'Could not read that file')
      setPreview({ fileName: file.name, csvText, report })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file')
    }
  }

  async function applyImport() {
    if (!preview) return
    setImporting(true)
    try {
      const res = await fetch('/api/collections/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: preview.csvText }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Import failed')
      setNotice(`Imported ${preview.fileName}: ${result.updated ?? 0} updated, ${result.created ?? 0} added.`)
      setPreview(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  async function syncShopify() {
    setSyncing(true)
    setNotice(null)
    try {
      const res = await fetch('/api/collections/sync-shopify', { method: 'POST' })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Sync failed')
      setNotice(`Synced with Shopify: ${result.liveCollections} live collections, ${result.added} new, ${result.recategorised ?? 0} recategorised.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function researchFiltered() {
    // Research every collection currently shown that has no primary keyword yet.
    const targets = filtered.filter((r) => !(r.primary_keyword && String(r.primary_keyword).trim()))
    if (!targets.length) { setNotice('Everything in this view already has a primary keyword.'); return }
    bulkStop.current = false
    setBulk({ done: 0, total: targets.length, running: true })
    let done = 0
    for (const t of targets) {
      if (bulkStop.current) break
      try {
        await fetch('/api/collections/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: t.slug }),
        })
      } catch { /* keep going; failures stay in Needs research */ }
      done++
      setBulk({ done, total: targets.length, running: true })
    }
    setBulk(null)
    setNotice(`Ahrefs research finished for ${done} collection${done === 1 ? '' : 's'}.`)
    await load()
  }

  async function createFiltered() {
    const targets = filtered.filter((r) => !r.last_synced_at && !r.shopify_collection_id)
    if (!targets.length) { setNotice('Nothing in this view needs creating.'); return }
    bulkStop.current = false
    setBulk({ done: 0, total: targets.length, running: true })
    let done = 0
    const problems: string[] = []
    for (const t of targets) {
      if (bulkStop.current) break
      try {
        const res = await fetch('/api/collections/create-in-shopify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: t.slug }),
        })
        const out = await res.json()
        if (!res.ok) problems.push(`${t.slug}: ${out.error}`)
        else if (out.handleDrifted) problems.push(`${t.slug}: ${out.note}`)
      } catch { problems.push(`${t.slug}: network error`) }
      done++
      setBulk({ done, total: targets.length, running: true })
    }
    setBulk(null)
    setNotice(
      `Created ${done - problems.length} of ${done} on Shopify (all unpublished).` +
      (problems.length ? ` Issues: ${problems.slice(0, 3).join(' · ')}${problems.length > 3 ? ` and ${problems.length - 3} more` : ''}` : '')
    )
    await load()
  }

  function exportCsv() {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (type) params.set('type', type)
    window.location.href = `/api/collections/export?${params.toString()}`
  }

  /* ── Filtering and sorting ── */

  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter(Boolean))).sort(),
    [rows]
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = rows
    if (needle) out = out.filter((r) =>
      [r.slug, r.primary_keyword, r.title_tag, Array.isArray(r.tags) ? r.tags.join(' ') : r.tags]
        .some((v) => String(v ?? '').toLowerCase().includes(needle))
    )
    if (stage) out = out.filter((r) => r._stage === stage)
    if (category) out = out.filter((r) => r.category === category)
    if (type) out = out.filter((r) => r.collection_type === type)
    if (createOnly) out = out.filter((r) => !r.last_synced_at && !r.shopify_collection_id)
    return [...out].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir
      return String(av).localeCompare(String(bv)) * sort.dir
    })
  }, [rows, q, stage, category, type, createOnly, sort])

  const counts = useMemo(() => {
    const c: Record<string, number> = { 'Done': 0, 'Needs content': 0, 'Needs research': 0, 'Needs both': 0 }
    for (const r of rows) c[r._stage] = (c[r._stage] ?? 0) + 1
    return c
  }, [rows])

  const toCreateCount = useMemo(
    () => rows.filter((r) => !r.last_synced_at && !r.shopify_collection_id).length,
    [rows]
  )

  const cell = (r: Row, key: string) => {
    const v = r[key]
    if (key === '_stage') return <span className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${STAGE_TONE[v]}`}>{v}</span>
    if (key === 'slug') return (
      <button onClick={() => setSelected(r.slug)} className="text-blue-600 hover:underline text-left">{r.slug}</button>
    )
    if (key === 'is_published') {
      if (!r.last_synced_at && !r.shopify_collection_id)
        return <span className="px-1.5 py-0.5 rounded text-xs bg-violet-100 text-violet-800 whitespace-nowrap">Not on Shopify</span>
      if (v === false) return <span className="text-red-600 text-xs font-medium">Hidden</span>
      return <span className="text-neutral-400 text-xs">Yes</span>
    }
    if (key === 'word_count') return <span className={Number(v ?? 0) < 300 ? 'text-red-600' : ''}>{v ?? '0'}</span>
    if (Array.isArray(v)) return <span className="text-xs text-neutral-600">{v.join(', ') || '—'}</span>
    if (v == null || v === '') return <span className="text-neutral-300">{'—'}</span>
    if (typeof v === 'number') return v.toLocaleString()
    return <span className="line-clamp-1 max-w-[240px]" title={String(v)}>{String(v)}</span>
  }

  return (
    <div className="p-6 space-y-4">
      {/* Stage counters. Click one to filter the table to that stage. */}
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(counts).map(([k, n]) => (
          <button key={k} onClick={() => setStage(stage === k ? '' : k)}
            className={`px-3 py-1.5 rounded border text-sm ${stage === k ? 'ring-2 ring-neutral-800' : ''} ${STAGE_TONE[k]}`}>
            {k} <span className="font-semibold">{n}</span>
          </button>
        ))}
        <button onClick={() => setCreateOnly(!createOnly)}
          className={`px-3 py-1.5 rounded border text-sm bg-violet-100 text-violet-800 ${createOnly ? 'ring-2 ring-neutral-800' : ''}`}>
          Not on Shopify <span className="font-semibold">{toCreateCount}</span>
        </button>
        <div className="ml-auto flex gap-2">
          {createOnly && !bulk?.running && (
            <button onClick={createFiltered}
                    className="px-3 py-1.5 text-sm rounded bg-violet-600 text-white">
              Create these on Shopify
            </button>
          )}
          {bulk?.running ? (
            <button onClick={() => { bulkStop.current = true }}
                    className="px-3 py-1.5 text-sm rounded border border-blue-300 bg-blue-50 text-blue-800">
              Researching {bulk.done} of {bulk.total}… click to stop
            </button>
          ) : (
            <button onClick={researchFiltered}
                    className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white">
              Research shown with Ahrefs
            </button>
          )}
          <button onClick={syncShopify} disabled={syncing}
                  className="px-3 py-1.5 text-sm rounded border disabled:opacity-50">
            {syncing ? 'Syncing…' : 'Sync from Shopify'}
          </button>
          <button onClick={() => fileRef.current?.click()}
                  className="px-3 py-1.5 text-sm rounded border">
            Import CSV
          </button>
          <button onClick={exportCsv} className="px-3 py-1.5 text-sm rounded bg-neutral-900 text-white">
            Export CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) onFilePicked(f); e.target.value = '' }} />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input placeholder="Search collection, keyword or tag" value={q} onChange={(e) => setQ(e.target.value)}
               className="flex-1 min-w-[220px] rounded border px-2 py-1.5 text-sm" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
          <option value="">All types</option>
          <option value="standard">Category pages</option>
          <option value="brand">Brand pages</option>
        </select>
      </div>

      {notice && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{notice}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      <p className="text-xs text-neutral-500">
        {loading ? 'Loading…' : `${filtered.length} of ${rows.length} collections`}
      </p>

      {/* The table */}
      <div className="overflow-x-auto border rounded bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 sticky top-0">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key}
                    onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === -1 ? 1 : -1 }))}
                    className={`px-2 py-2 font-medium text-neutral-600 whitespace-nowrap cursor-pointer select-none ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                  {c.label}{sort.key === c.key && (sort.dir === -1 ? ' ↓' : ' ↑')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.slug} className="border-t hover:bg-neutral-50 align-top">
                {COLUMNS.map((c) => (
                  <td key={c.key} className={`px-2 py-1.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {cell(r, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit panel */}
      {selected && (
        <CollectionDetail slug={selected} onClose={() => setSelected(null)} onSaved={load} />
      )}

      {/* Import preview. Nothing has been written yet at this point. */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setPreview(null)}>
          <div className="w-full max-w-lg bg-white rounded-lg shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Import preview: {preview.fileName}</h3>
            <p className="text-sm text-neutral-600">
              Nothing has been changed yet. Here is what this file would do:
            </p>
            <ul className="text-sm space-y-1">
              <li>Rows in the file: <strong>{preview.report.rowsRead}</strong></li>
              <li>Existing collections that would be updated: <strong>{preview.report.wouldUpdate ?? 0}</strong></li>
              <li>New rows that would be added: <strong>{preview.report.unknownSlugs?.length ?? 0}</strong></li>
              <li>Fields being applied: <span className="text-neutral-600">{(preview.report.columnsApplied ?? []).join(', ')}</span></li>
            </ul>
            {preview.report.unknownSlugs?.length > 0 && (
              <p className="text-xs text-neutral-500">
                New: {preview.report.unknownSlugs.slice(0, 10).join(', ')}
                {preview.report.unknownSlugs.length > 10 ? ` and ${preview.report.unknownSlugs.length - 10} more` : ''}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setPreview(null)} className="px-3 py-1.5 text-sm rounded border">Cancel</button>
              <button onClick={applyImport} disabled={importing}
                      className="px-3 py-1.5 text-sm rounded bg-neutral-900 text-white disabled:opacity-50">
                {importing ? 'Importing…' : 'Apply import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
