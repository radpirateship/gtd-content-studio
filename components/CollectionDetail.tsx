'use client'

// components/CollectionDetail.tsx
//
// The detail area for a single collection. Everything that used to live in
// GTD_Complete_Collection_Optimization.xlsx, on one screen, editable in place.
//
// Usage inside the collections tab:
//   const [selected, setSelected] = useState<string | null>(null)
//   {selected && <CollectionDetail slug={selected} onClose={() => setSelected(null)} onSaved={refresh} />}

import { useEffect, useState } from 'react'

export interface CollectionRow {
  slug: string
  url: string | null
  category: string | null
  collection_type: string | null
  tier: string | null
  status: string | null
  priority: string | null
  primary_keyword: string | null
  secondary_keywords: string[] | null
  search_volume: number | null
  kd: number | null
  title_tag: string | null
  meta_description: string | null
  current_position: string | null
  current_impressions: number | null
  estimated_impact: string | null
  is_optimized: boolean | null
  ultimate_guide_title: string | null
  ultimate_guide_url: string | null
  notes: string | null
  // Shopify-synced, read only
  tags: string[] | null
  rule_summary: string | null
  product_count: number | null
  word_count: number | null
  score: number | null
  is_published: boolean | null
  last_synced_at: string | null
}

const EDITABLE_TEXT: Array<[keyof CollectionRow, string, string?]> = [
  ['primary_keyword', 'Primary keyword'],
  ['title_tag', 'Optimized title tag', 'Target 50 to 60 characters'],
  ['meta_description', 'Optimized meta description', 'Target 140 to 160 characters'],
  ['ultimate_guide_title', 'Ultimate guide title'],
  ['ultimate_guide_url', 'Ultimate guide URL'],
]

export function CollectionDetail({
  slug,
  onClose,
  onSaved,
}: {
  slug: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [row, setRow] = useState<CollectionRow | null>(null)
  const [draft, setDraft] = useState<Partial<CollectionRow>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [researching, setResearching] = useState(false)
  const [suggestions, setSuggestions] = useState<Array<{ keyword: string; volume: number | null; difficulty: number | null }>>([])

  useEffect(() => {
    let cancelled = false
    setRow(null)
    setDraft({})
    fetch(`/api/collections/${slug}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRow(d.collection ?? d) })
      .catch((e) => !cancelled && setError(String(e)))
    return () => { cancelled = true }
  }, [slug])

  const value = <K extends keyof CollectionRow>(k: K): CollectionRow[K] | undefined =>
    (k in draft ? draft[k] : row?.[k]) as CollectionRow[K] | undefined

  const set = (k: keyof CollectionRow, v: unknown) =>
    setDraft((d) => ({ ...d, [k]: v }))

  async function save() {
    if (!Object.keys(draft).length) return onClose()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/collections/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function runResearch() {
    setResearching(true)
    setError(null)
    try {
      const res = await fetch('/api/collections/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Research failed')
      setSuggestions(data.suggestions ?? [])
      // Pull the freshly saved values into the panel
      const fresh = await fetch(`/api/collections/${slug}`).then((r) => r.json())
      setRow(fresh.collection ?? fresh)
      setDraft({})
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Research failed')
    } finally {
      setResearching(false)
    }
  }

  if (error && !row) return <Panel onClose={onClose}><p className="text-red-600 text-sm">{error}</p></Panel>
  if (!row) return <Panel onClose={onClose}><p className="text-sm text-neutral-500">Loading…</p></Panel>

  const secondary = (value('secondary_keywords') ?? []) as string[]
  const tags = row.tags ?? []
  const charCount = (s?: string | null) => (s ? s.length : 0)

  return (
    <Panel onClose={onClose}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <h2 className="text-lg font-semibold">{row.slug}</h2>
          {row.url && (
            <a href={row.url} target="_blank" rel="noreferrer"
               className="text-sm text-blue-600 hover:underline">{row.url}</a>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 justify-end">
          <Badge tone={row.is_published === false ? 'red' : 'green'}>
            {row.is_published === false ? 'Not published' : 'Published'}
          </Badge>
          {row.collection_type === 'brand' && <Badge tone="violet">Brand</Badge>}
          <Badge tone={row.is_optimized ? 'green' : 'amber'}>
            {row.is_optimized ? 'Optimized' : 'Not optimized'}
          </Badge>
        </div>
      </div>

      {/* Metrics strip — the numbers that drive priority */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 py-4 border-b">
        <Metric label="Search volume" value={row.search_volume?.toLocaleString() ?? '—'} />
        <Metric label="KD" value={row.kd ?? '—'} />
        <Metric label="Products" value={row.product_count ?? '—'} />
        <Metric label="Words" value={row.word_count?.toLocaleString() ?? '—'}
                tone={(row.word_count ?? 0) < 300 ? 'red' : undefined} />
        <Metric label="Score" value={row.score ?? '—'} />
        <Metric label="Impressions" value={row.current_impressions?.toLocaleString() ?? '—'} />
      </div>

      {/* Classification */}
      <Section title="Classification">
        <div className="grid grid-cols-3 gap-3">
          <Select label="Category" value={value('category') ?? ''} onChange={(v) => set('category', v)}
                  options={['Saunas', 'Recovery', 'Fitness', 'Clinical', 'Wellness', 'Unsorted']} />
          <Select label="Tier" value={value('tier') ?? ''} onChange={(v) => set('tier', v)}
                  options={['Tier 1', 'Tier 2', 'Tier 3']} />
          <Select label="Status" value={value('status') ?? ''} onChange={(v) => set('status', v)}
                  options={['Existing', 'NEW', 'Needs content', 'Retired']} />
        </div>
      </Section>

      {/* Keywords */}
      <Section title="Keywords" hint="Run Ahrefs research or paste your own. Secondary keywords are one per line.">
        <button onClick={runResearch} disabled={researching}
                className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50">
          {researching ? 'Researching…' : 'Research with Ahrefs'}
        </button>
        {suggestions.length > 0 && (
          <div className="border rounded p-2 space-y-1 bg-blue-50/50">
            <p className="text-xs font-medium text-neutral-600">
              Related keywords by volume. Click one to make it the primary keyword.
            </p>
            {suggestions.slice(0, 10).map((s) => (
              <button key={s.keyword} onClick={() => set('primary_keyword', s.keyword)}
                      className="flex w-full items-center justify-between text-sm px-2 py-1 rounded hover:bg-blue-100 text-left">
                <span>{s.keyword}</span>
                <span className="text-xs text-neutral-500 tabular-nums">
                  {s.volume?.toLocaleString() ?? '—'} vol · KD {s.difficulty ?? '—'}
                </span>
              </button>
            ))}
          </div>
        )}
        {EDITABLE_TEXT.slice(0, 1).map(([k, label]) => (
          <Field key={k} label={label}>
            <input className={inputCls} value={(value(k) as string) ?? ''}
                   onChange={(e) => set(k, e.target.value)} />
          </Field>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Search volume">
            <input type="number" className={inputCls} value={value('search_volume') ?? ''}
                   onChange={(e) => set('search_volume', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <Field label="Keyword difficulty">
            <input type="number" className={inputCls} value={value('kd') ?? ''}
                   onChange={(e) => set('kd', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
        </div>
        <Field label={`Secondary keywords (${secondary.length})`}>
          <textarea rows={5} className={inputCls} value={secondary.join('\n')}
                    onChange={(e) => set('secondary_keywords',
                      e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} />
        </Field>
      </Section>

      {/* SEO copy */}
      <Section title="SEO">
        {EDITABLE_TEXT.slice(1, 3).map(([k, label, hint]) => {
          const v = (value(k) as string) ?? ''
          const limit = k === 'title_tag' ? 60 : 160
          return (
            <Field key={k} label={label} hint={hint}>
              {k === 'title_tag'
                ? <input className={inputCls} value={v} onChange={(e) => set(k, e.target.value)} />
                : <textarea rows={3} className={inputCls} value={v} onChange={(e) => set(k, e.target.value)} />}
              <span className={`text-xs ${charCount(v) > limit ? 'text-red-600' : 'text-neutral-400'}`}>
                {charCount(v)} / {limit}
              </span>
            </Field>
          )
        })}
      </Section>

      {/* Shopify routing — read only */}
      <Section title="Shopify routing" hint={
        row.last_synced_at ? `Synced ${new Date(row.last_synced_at).toLocaleString()}` : 'Not yet synced'
      }>
        <Field label={`Tags driving this collection (${tags.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {tags.length
              ? tags.map((t) => <Badge key={t} tone="slate">{t}</Badge>)
              : <span className="text-sm text-neutral-400">No tag rules. Type or vendor driven.</span>}
          </div>
        </Field>
        {row.rule_summary && (
          <Field label="Smart rule">
            <code className="block text-xs bg-neutral-50 border rounded p-2 whitespace-pre-wrap">{row.rule_summary}</code>
          </Field>
        )}
      </Section>

      {/* Guide + notes */}
      <Section title="Ultimate guide and notes">
        {EDITABLE_TEXT.slice(3).map(([k, label]) => (
          <Field key={k} label={label}>
            <input className={inputCls} value={(value(k) as string) ?? ''}
                   onChange={(e) => set(k, e.target.value)} />
          </Field>
        ))}
        <Field label="Notes">
          <textarea rows={3} className={inputCls} value={(value('notes') as string) ?? ''}
                    onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!value('is_optimized')}
                 onChange={(e) => set('is_optimized', e.target.checked)} />
          Mark as optimized
        </label>
      </Section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center justify-between gap-3 border-t pt-4 sticky bottom-0 bg-white">
        <span className="text-xs text-neutral-500">
          {Object.keys(draft).length ? `${Object.keys(draft).length} unsaved change(s)` : 'No changes'}
        </span>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border">Cancel</button>
          <button onClick={save} disabled={saving || !Object.keys(draft).length}
                  className="px-3 py-1.5 text-sm rounded bg-neutral-900 text-white disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Panel>
  )
}

/* ── small primitives ─────────────────────────────────────────────────────── */

const inputCls = 'w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400'

function Panel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div className="w-full max-w-2xl h-full overflow-y-auto bg-white p-6 space-y-5 shadow-xl"
           onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b pb-5 last:border-0">
      <div>
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-neutral-600">{label}</label>
      {children}
      {hint && <p className="text-xs text-neutral-400">{hint}</p>}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'red' }) {
  return (
    <div>
      <div className={`text-lg font-semibold ${tone === 'red' ? 'text-red-600' : 'text-neutral-900'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  )
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'red' | 'amber' | 'violet' }) {
  const tones = {
    slate: 'bg-neutral-100 text-neutral-700',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    violet: 'bg-violet-100 text-violet-800',
  }
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${tones[tone]}`}>{children}</span>
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <Field label={label}>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  )
}
