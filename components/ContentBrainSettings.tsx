'use client'
/**
 * ContentBrainSettings — the admin control panel for the Content Brain.
 *
 * Three tabs:
 *   1. Documents — upload/manage reference docs (brand voice, TAP plans,
 *      strategy memos). Uploaded text becomes context the chat can pull from.
 *   2. Canonical Map — edit the hub → cluster taxonomy that powers extraction.
 *   3. Maintenance — run migrations, seed DB from baked JSON, check status.
 */

import { useEffect, useState } from 'react'

type Tab = 'docs' | 'map' | 'maintenance'

interface Doc {
  id: number
  title: string
  kind: string
  mime: string | null
  size_bytes: number | null
  notes: string | null
  tags: string[] | null
  content_length?: number
  created_at: string
}

interface Cluster {
  id: number
  hub: string
  name: string
  slug: string
}

const HUBS = ['Saunas', 'Recovery', 'Wellness', 'Cardio']

const GTD = {
  navy: '#003366',
  blue: '#0066cc',
  green: 'rgb(26,122,84)',
  muted: '#6b7280',
  cream: 'rgb(250,250,248)',
  red: '#c05621',
}

export default function ContentBrainSettings() {
  const [tab, setTab] = useState<Tab>('docs')

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: GTD.navy }}>Content Brain · Settings</div>
        <div style={{ fontSize: 13, color: GTD.muted, marginTop: 2 }}>
          Upload reference docs, edit the canonical taxonomy, and manage data.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, background: '#f0f0f0', padding: 4, borderRadius: 8, width: 'fit-content', marginBottom: 20 }}>
        {([
          { id: 'docs', label: 'Documents' },
          { id: 'map', label: 'Canonical Map' },
          { id: 'maintenance', label: 'Maintenance' },
        ] as { id: Tab; label: string }[]).map((o) => (
          <button
            key={o.id}
            onClick={() => setTab(o.id)}
            style={{
              padding: '7px 16px',
              border: 'none',
              borderRadius: 6,
              background: tab === o.id ? 'white' : 'transparent',
              color: tab === o.id ? GTD.navy : GTD.muted,
              fontWeight: tab === o.id ? 600 : 500,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: tab === o.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {tab === 'docs' && <DocsTab />}
      {tab === 'map' && <MapTab />}
      {tab === 'maintenance' && <MaintenanceTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Documents tab
// ---------------------------------------------------------------------------
function DocsTab() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<Doc | null>(null)
  const [form, setForm] = useState({ title: '', kind: 'reference', notes: '', tags: '', content: '' })

  const refresh = async () => {
    setLoading(true)
    const res = await fetch('/api/content-brain/docs')
    const data = await res.json()
    setDocs(Array.isArray(data) ? data : [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  const handleFile = async (file: File) => {
    setUploading(true)
    try {
      const text = await readFileAsText(file)
      setForm((f) => ({
        ...f,
        title: f.title || file.name.replace(/\.[^.]+$/, ''),
        content: text,
      }))
    } catch (e) {
      alert(`Failed to read file: ${e instanceof Error ? e.message : 'Unknown'}`)
    } finally {
      setUploading(false)
    }
  }

  const saveDoc = async () => {
    if (!form.title || !form.content) {
      alert('Title and content are required.')
      return
    }
    const payload = {
      title: form.title,
      kind: form.kind,
      notes: form.notes || null,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : null,
      content: form.content,
      size_bytes: form.content.length,
    }
    const method = editing ? 'PATCH' : 'POST'
    const body = editing ? { ...payload, id: editing.id } : payload
    const res = await fetch('/api/content-brain/docs', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      alert('Save failed.')
      return
    }
    setForm({ title: '', kind: 'reference', notes: '', tags: '', content: '' })
    setEditing(null)
    refresh()
  }

  const startEdit = async (d: Doc) => {
    const res = await fetch(`/api/content-brain/docs?id=${d.id}`)
    const full = await res.json()
    setEditing(full)
    setForm({
      title: full.title || '',
      kind: full.kind || 'reference',
      notes: full.notes || '',
      tags: Array.isArray(full.tags) ? full.tags.join(', ') : '',
      content: full.content || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const deleteDoc = async (id: number) => {
    if (!confirm('Delete this document?')) return
    await fetch(`/api/content-brain/docs?id=${id}`, { method: 'DELETE' })
    refresh()
  }

  return (
    <div>
      <Card title={editing ? `Edit: ${editing.title}` : 'Upload or paste a new document'}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <Field label="Title">
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              style={inputStyle}
              placeholder="e.g. GTD Brand Voice Guide v2"
            />
          </Field>
          <Field label="Kind">
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              style={inputStyle}
            >
              <option value="reference">Reference</option>
              <option value="brand-voice">Brand Voice</option>
              <option value="strategy">Strategy / TAP</option>
              <option value="competitor">Competitor Research</option>
              <option value="voice-note">Voice Note</option>
              <option value="transcript">Transcript</option>
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <Field label="Notes (optional)">
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              style={inputStyle}
              placeholder="Short description"
            />
          </Field>
          <Field label="Tags (comma separated)">
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              style={inputStyle}
              placeholder="saunas, q2-2026"
            />
          </Field>
        </div>
        <Field label="Content">
          <div
            style={{
              border: '1px dashed #cbd5e1',
              borderRadius: 8,
              padding: 12,
              background: GTD.cream,
              marginBottom: 8,
            }}
          >
            <input
              type="file"
              accept=".txt,.md,.csv,.json,.xml,.html"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              style={{ fontSize: 12 }}
            />
            <span style={{ fontSize: 11, color: GTD.muted, marginLeft: 8 }}>
              or paste below. Text formats only — xlsx/pdf: convert to text first.
            </span>
          </div>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={10}
            style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 12, resize: 'vertical' }}
            placeholder="Paste document contents here..."
          />
          <div style={{ fontSize: 11, color: GTD.muted, marginTop: 4 }}>
            {form.content.length.toLocaleString()} chars
          </div>
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            onClick={saveDoc}
            disabled={uploading}
            style={{ ...buttonStyle, background: GTD.green, color: 'white' }}
          >
            {editing ? 'Save changes' : 'Add document'}
          </button>
          {editing && (
            <button
              onClick={() => {
                setEditing(null)
                setForm({ title: '', kind: 'reference', notes: '', tags: '', content: '' })
              }}
              style={{ ...buttonStyle, background: '#e5e7eb', color: GTD.navy }}
            >
              Cancel
            </button>
          )}
        </div>
      </Card>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: GTD.navy, marginBottom: 10 }}>
          Uploaded documents ({docs.length})
        </div>
        {loading && <div style={{ color: GTD.muted, fontSize: 13 }}>Loading…</div>}
        {!loading && docs.length === 0 && (
          <div style={{ color: GTD.muted, fontSize: 13, padding: 20, background: GTD.cream, borderRadius: 8 }}>
            No documents yet. Upload your brand voice guide, strategy memos, and reference material to give the Content Brain better context.
          </div>
        )}
        {docs.map((d) => (
          <div
            key={d.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              marginBottom: 6,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: GTD.navy }}>{d.title}</div>
              <div style={{ fontSize: 11, color: GTD.muted, marginTop: 2 }}>
                {d.kind} • {(d.content_length || 0).toLocaleString()} chars
                {d.tags?.length ? ` • ${d.tags.join(', ')}` : ''}
              </div>
              {d.notes && <div style={{ fontSize: 11, color: GTD.muted, fontStyle: 'italic' }}>{d.notes}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => startEdit(d)} style={{ ...buttonStyle, padding: '5px 10px', fontSize: 11, background: '#e5e7eb', color: GTD.navy }}>Edit</button>
              <button onClick={() => deleteDoc(d.id)} style={{ ...buttonStyle, padding: '5px 10px', fontSize: 11, background: 'transparent', color: GTD.red, border: `1px solid ${GTD.red}` }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

// ---------------------------------------------------------------------------
// Canonical Map tab
// ---------------------------------------------------------------------------
function MapTab() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Cluster | null>(null)
  const [form, setForm] = useState({ hub: 'Saunas', name: '', slug: '' })

  const refresh = async () => {
    setLoading(true)
    const res = await fetch('/api/content-brain/clusters')
    const data = await res.json()
    setClusters(data.clusters || [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  const save = async () => {
    if (!form.hub || !form.name || !form.slug) return
    if (editing) {
      await fetch('/api/content-brain/clusters', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, ...form }),
      })
    } else {
      await fetch('/api/content-brain/clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
    }
    setEditing(null)
    setForm({ hub: 'Saunas', name: '', slug: '' })
    refresh()
  }

  const remove = async (id: number) => {
    if (!confirm('Delete this cluster? Existing articles will keep the old name as text but lose the canonical link.')) return
    await fetch(`/api/content-brain/clusters?id=${id}`, { method: 'DELETE' })
    refresh()
  }

  const byHub = HUBS.map((h) => ({ hub: h, rows: clusters.filter((c) => c.hub === h) }))

  return (
    <div>
      <Card title={editing ? `Edit cluster: ${editing.name}` : 'Add a cluster'}>
        <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <Field label="Hub">
            <select value={form.hub} onChange={(e) => setForm({ ...form, hub: e.target.value })} style={inputStyle}>
              {HUBS.map((h) => <option key={h}>{h}</option>)}
            </select>
          </Field>
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} placeholder="Infrared Saunas" /></Field>
          <Field label="Slug (kebab-case)"><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} style={inputStyle} placeholder="infrared-saunas" /></Field>
          <button onClick={save} style={{ ...buttonStyle, background: GTD.green, color: 'white', height: 36 }}>
            {editing ? 'Save' : 'Add'}
          </button>
        </div>
        {editing && (
          <button onClick={() => { setEditing(null); setForm({ hub: 'Saunas', name: '', slug: '' }) }} style={{ ...buttonStyle, marginTop: 10, background: '#e5e7eb', color: GTD.navy }}>
            Cancel edit
          </button>
        )}
      </Card>

      <div style={{ marginTop: 24 }}>
        {loading && <div style={{ color: GTD.muted, fontSize: 13 }}>Loading…</div>}
        {byHub.map(({ hub, rows }) => (
          <div key={hub} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: GTD.navy, marginBottom: 8 }}>{hub} ({rows.length})</div>
            {rows.map((c) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 4 }}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: GTD.navy }}>{c.name}</span>
                  <span style={{ color: GTD.muted, marginLeft: 10, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{c.slug}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { setEditing(c); setForm({ hub: c.hub, name: c.name, slug: c.slug }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} style={{ ...buttonStyle, padding: '4px 10px', fontSize: 11, background: '#e5e7eb', color: GTD.navy }}>Edit</button>
                  <button onClick={() => remove(c.id)} style={{ ...buttonStyle, padding: '4px 10px', fontSize: 11, background: 'transparent', color: GTD.red, border: `1px solid ${GTD.red}` }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Maintenance tab
// ---------------------------------------------------------------------------
function MaintenanceTab() {
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (label: string, url: string, body?: unknown) => {
    setBusy(label)
    setStatus(`Running ${label}…`)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json()
      setStatus(`${label}: ${JSON.stringify(data, null, 2)}`)
    } catch (e) {
      setStatus(`${label} failed: ${e instanceof Error ? e.message : 'Unknown'}`)
    } finally {
      setBusy(null)
    }
  }

  const Action = ({ label, endpoint, body, description }: { label: string; endpoint: string; body?: unknown; description: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: GTD.navy }}>{label}</div>
        <div style={{ fontSize: 11, color: GTD.muted, marginTop: 2 }}>{description}</div>
      </div>
      <button
        onClick={() => run(label, endpoint, body)}
        disabled={busy !== null}
        style={{ ...buttonStyle, background: busy === label ? '#9ca3af' : GTD.blue, color: 'white' }}
      >
        {busy === label ? 'Running…' : 'Run'}
      </button>
    </div>
  )

  return (
    <div>
      <Card title="Database migrations">
        <Action label="Migration v1" endpoint="/api/content-brain/migrate" description="Create content_brain + clusters tables. Idempotent." />
        <Action label="Migration v2" endpoint="/api/content-brain/migrate-v2" description="Adds pillar_id, intent, strategic_notes, opportunity_score, internal_link_targets." />
        <Action label="Migration v3" endpoint="/api/content-brain/migrate-v3" description="Adds content_brain_docs table for reference document uploads." />
        <Action label="Migration v4" endpoint="/api/content-brain/migrate-v4" description="Adds is_shopify_page flag. Auto-marks 'The Ultimate Guide to...' rows as pages so they're excluded from the Shopify blog audit." />
        <Action label="Migration v5" endpoint="/api/content-brain/migrate-v5" description="Renames Air Filters → Air Purifiers in the collections registry. Also syncs all master collections into the registry so Products + Resources dropdowns stay current." />
      </Card>

      <Card title="Data seeding" style={{ marginTop: 16 }}>
        <Action label="Seed from baked JSON" endpoint="/api/content-brain/seed" description="Loads 543 rows from lib/contentBrainSeed.json. Idempotent — skips duplicates by (title, cluster)." />
        <Action label="Force re-seed (wipe tap-import rows)" endpoint="/api/content-brain/seed" body={{ force: true }} description="Deletes all source='tap-import' rows, then re-seeds from scratch. Keeps manually added rows." />
      </Card>

      <Card title="Export" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'white', border: '1px solid #e5e7eb', borderRadius: 6 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: GTD.navy }}>Download current Topical Authority Plan</div>
            <div style={{ fontSize: 11, color: GTD.muted, marginTop: 2 }}>Multi-sheet .xlsx: one sheet per cluster + a summary tab. Reflects every live edit, status change, and Ahrefs refresh.</div>
          </div>
          <a
            href="/api/content-brain/export/tap-xlsx"
            download
            style={{ padding: '8px 16px', background: GTD.green, color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}
          >
            Download .xlsx
          </a>
        </div>
      </Card>

      <Card title="Ahrefs diagnostics" style={{ marginTop: 16 }}>
        <Action
          label="Ping Ahrefs (verify key + connectivity)"
          endpoint="/api/content-brain/ahrefs/ping"
          description='Hits Ahrefs once with a known-good keyword ("hyperbaric chamber benefits"). Response shows whether the key is present, the HTTP status, and the real error if any. Use this first when enrichment returns blank data.'
        />
      </Card>

      <Card title="Shopify-only article audit" style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, color: GTD.muted, marginBottom: 12 }}>
          Enriches the shopify_only list with publish dates, derived keywords, and clash detection against your live Content Brain articles.
          Articles published before <strong>Oct 1 2025</strong> are flagged as old. Runs in ~30s (no Ahrefs calls).
          <strong style={{ color: GTD.navy }}> Nothing is deleted until you select rows and click an action.</strong>
        </div>
        <ShopifyOnlyAudit />
      </Card>

      <Card title="Shopify audit" style={{ marginTop: 16 }}>
        <Action
          label="Audit (read-only) — see what's live, ghost, or missing"
          endpoint="/api/content-brain/audit/shopify"
          description='Compares every content_brain "live" row against every published Shopify article. Returns: confirmed live, title mismatches (same article, different title in DB), ghost live (in DB but not on Shopify), and Shopify-only (on site but not in the Brain).'
        />
        <Action
          label="Fix ghost rows only (ghost → planned, titles unchanged)"
          endpoint="/api/content-brain/audit/shopify"
          body={{ fix: true, ghost_only: true }}
          description="Flips articles marked live in the DB that don't exist on Shopify to status='planned'. Does NOT update titles."
        />
        <Action
          label="Full fix: fix ghosts + update DB titles to match Shopify"
          endpoint="/api/content-brain/audit/shopify"
          body={{ fix: true }}
          description='Fixes ghost rows (→ planned) AND updates every title-mismatch row in the DB to use the Shopify title. Shopify is the source of truth — if you shortened a title on Shopify, this syncs the DB to match.'
        />
      </Card>

      <Card title="Ahrefs enrichment" style={{ marginTop: 16 }}>
        <Action label="Enrich 50 stale rows" endpoint="/api/content-brain/ahrefs/enrich" body={{ limit: 50 }} description="Refreshes rows not enriched in the last 168 hours (volume, KD, traffic potential, opportunity score)." />
        <Action label="Enrich Recovery hub" endpoint="/api/content-brain/ahrefs/enrich" body={{ hub: 'Recovery', limit: 100 }} description="Targeted enrich for every Recovery row." />
      </Card>

      {status && (
        <Card title="Last output" style={{ marginTop: 16 }}>
          <pre style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', background: GTD.cream, padding: 12, borderRadius: 4, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
            {status}
          </pre>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shopify-only audit panel
// ---------------------------------------------------------------------------
type AuditRow = {
  shopify_id: number; title: string; url: string; handle: string; blog_handle: string
  published_at: string; age_flag: string; derived_keyword: string
  clash_type: string; clash_with: string; recommendation: string; word_count_approx: number
}

function ShopifyOnlyAudit() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    counts: { total: number; exact_keyword_clash: number; title_overlap: number; old_no_clash: number; recent_no_clash: number }
    results: AuditRow[]; csv: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setError(null); setResult(null); setSelected(new Set()); setActionMsg(null)
    try {
      const res = await fetch('/api/content-brain/audit/shopify-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutoff_date: '2025-10-01', run_ahrefs: false }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Failed'); return }
      setResult(data)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown') }
    finally { setBusy(false) }
  }

  const downloadCsv = () => {
    if (!result) return
    const blob = new Blob([result.csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `gtd-shopify-only-audit-${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const toggle = (id: number) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => {
    if (!result) return
    setSelected(selected.size === result.results.length ? new Set() : new Set(result.results.map(r => r.shopify_id)))
  }

  const selectedRows = result ? result.results.filter(r => selected.has(r.shopify_id)) : []
  const articles = selectedRows.map(r => ({ shopify_id: r.shopify_id, title: r.title, handle: r.handle, blog_handle: r.blog_handle || 'wellness' }))

  const runAction = async (label: string, endpoint: string) => {
    if (selected.size === 0 || actionBusy) return
    if (!confirm(`${label} ${selected.size} article${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    setActionBusy(label); setActionMsg(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articles }),
      })
      const data = await res.json()
      const parts = []
      if (data.deleted != null) parts.push(`${data.deleted} deleted from Shopify`)
      if (data.queued != null) parts.push(`${data.queued} added to Content Brain`)
      if (data.inserted != null) parts.push(`${data.inserted} imported to Brain as live`)
      if (data.errors?.length) parts.push(`${data.errors.length} errors`)
      setActionMsg(parts.join(' • '))
      // Remove actioned rows from display
      if (result) {
        setResult({ ...result, results: result.results.filter(r => !selected.has(r.shopify_id)) })
      }
      setSelected(new Set())
    } catch (e) { setActionMsg(`Failed: ${e instanceof Error ? e.message : 'Unknown'}`) }
    finally { setActionBusy(null) }
  }

  const CLASH_COLOR: Record<string, string> = { 'exact-keyword': '#c05621', 'title-overlap': '#d69e2e', 'none': '#6b7280' }
  const REC_BG = (r: string) => r.startsWith('DELETE') ? '#fde7dc' : r.startsWith('REVIEW') ? '#fff4d6' : '#f0f9ff'
  const REC_COLOR = (r: string) => r.startsWith('DELETE') ? '#c05621' : r.startsWith('REVIEW') ? '#7a5a00' : GTD.blue

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={run} disabled={busy}
          style={{ padding: '8px 16px', background: busy ? '#9ca3af' : GTD.blue, color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'Fetching dates + checking clashes…' : 'Run shopify-only audit'}
        </button>
        {result && <button onClick={downloadCsv} style={{ padding: '8px 16px', background: GTD.green, color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Download CSV</button>}
      </div>
      {error && <div style={{ color: GTD.red, fontSize: 12, padding: '6px 10px', background: '#fde7dc', borderRadius: 4, marginBottom: 8 }}>{error}</div>}
      {actionMsg && <div style={{ fontSize: 12, padding: '6px 10px', background: '#e6f4ea', color: GTD.green, borderRadius: 4, marginBottom: 8, fontWeight: 600 }}>{actionMsg}</div>}

      {/* Sticky action bar when rows are selected */}
      {selected.size > 0 && (
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: GTD.navy, color: 'white', padding: '10px 14px', borderRadius: 6, marginBottom: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
          <button onClick={() => runAction('Import to Brain', '/api/content-brain/shopify-article/import-to-brain')}
            disabled={!!actionBusy}
            style={{ padding: '6px 14px', background: GTD.blue, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: actionBusy ? 'default' : 'pointer' }}>
            {actionBusy === 'Import to Brain' ? 'Importing…' : '📥 Import to Brain (keep)'}
          </button>
          <button onClick={() => runAction('Delete + rebuild', '/api/content-brain/shopify-article/delete-and-rebuild')}
            disabled={!!actionBusy}
            style={{ padding: '6px 14px', background: '#d69e2e', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: actionBusy ? 'default' : 'pointer' }}>
            {actionBusy === 'Delete + rebuild' ? 'Processing…' : '🔄 Delete + Rebuild'}
          </button>
          <button onClick={() => runAction('Delete only', '/api/content-brain/shopify-article/delete')}
            disabled={!!actionBusy}
            style={{ padding: '6px 14px', background: GTD.red, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: actionBusy ? 'default' : 'pointer' }}>
            {actionBusy === 'Delete only' ? 'Deleting…' : '🗑 Delete only'}
          </button>
          <button onClick={() => setSelected(new Set())} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: 'white', padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      )}

      {result && (
        <div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 12, flexWrap: 'wrap' }}>
            <span style={{ color: GTD.red, fontWeight: 700 }}>🔴 {result.counts.exact_keyword_clash} exact clash</span>
            <span style={{ color: '#d69e2e', fontWeight: 700 }}>🟡 {result.counts.title_overlap} title overlap</span>
            <span style={{ color: GTD.muted }}>🕐 {result.counts.old_no_clash} old, no clash</span>
            <span style={{ color: GTD.blue }}>🆕 {result.counts.recent_no_clash} recent, no clash</span>
            <span style={{ fontWeight: 600, color: GTD.navy }}>Total: {result.counts.total}</span>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 540, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead style={{ background: 'rgb(250,250,248)', position: 'sticky', top: 0, zIndex: 5 }}>
                <tr>
                  <th style={{ padding: '6px 8px' }}>
                    <input type="checkbox" checked={selected.size === result.results.length && result.results.length > 0} onChange={toggleAll} />
                  </th>
                  {['Action','Published','~Words','Title','Keyword','Clashes With'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, color: GTD.navy, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f0f0f0', background: selected.has(r.shopify_id) ? '#eff6ff' : i % 2 === 0 ? 'white' : 'rgb(250,250,248)' }}>
                    <td style={{ padding: '5px 8px' }}>
                      <input type="checkbox" checked={selected.has(r.shopify_id)} onChange={() => toggle(r.shopify_id)} />
                    </td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: REC_BG(r.recommendation), color: REC_COLOR(r.recommendation) }}>
                        {r.recommendation.split('—')[0].trim()}
                      </span>
                    </td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', color: r.age_flag.startsWith('OLD') ? GTD.red : GTD.muted, fontWeight: r.age_flag.startsWith('OLD') ? 600 : 400 }}>
                      {r.published_at}
                    </td>
                    <td style={{ padding: '5px 8px', color: GTD.muted }}>{r.word_count_approx.toLocaleString()}</td>
                    <td style={{ padding: '5px 8px', maxWidth: 320 }}>
                      <a href={r.url} target="_blank" rel="noreferrer" style={{ color: GTD.navy, textDecoration: 'none', fontWeight: 500 }}>{r.title}</a>
                    </td>
                    <td style={{ padding: '5px 8px', color: GTD.muted, whiteSpace: 'nowrap' }}>{r.derived_keyword}</td>
                    <td style={{ padding: '5px 8px', maxWidth: 260, color: CLASH_COLOR[r.clash_type] || GTD.muted, fontSize: 10 }}>
                      {r.clash_with || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared UI bits
// ---------------------------------------------------------------------------
function Card({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: 18, ...style }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: GTD.navy, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: GTD.muted, fontWeight: 500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontFamily: 'inherit',
  outline: 'none',
  background: 'white',
}

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}
