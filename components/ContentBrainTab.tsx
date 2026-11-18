// components/ContentBrainTab.tsx
// Strategic planning layer sitting above the article generation pipeline.
// Four sub-views: Capture (AI chat), Cluster Map, All Articles, Export Queue.
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Hub = 'Saunas' | 'Recovery' | 'Wellness' | 'Cardio'
const HUBS: Hub[] = ['Saunas', 'Recovery', 'Wellness', 'Cardio']

const ARTICLE_TYPES = [
  'buyers-guide',
  'comparison',
  'how-to',
  'listicle',
  'benefit-deep-dive',
  'brand-review',
  'ultimate-guide',
  'faq',
  'celebrity',
  'exercise-science',
] as const

const AUDIENCES = ['general', 'enthusiast', 'athlete', 'first-time', 'professional'] as const
const TONES = ['educational', 'authoritative', 'comparison'] as const
const STATUSES = ['idea', 'planned', 'in-queue', 'generated', 'live'] as const
const TRAFFIC_LIGHTS = ['unvetted', 'green', 'yellow', 'red'] as const
const CONTENT_TYPES = ['cluster', 'pillar'] as const

interface Idea {
  id: number
  title: string
  keyword: string | null
  hub: string | null
  cluster_group: string | null
  collection: string | null
  collection_slug: string | null
  content_type: string | null
  article_type: string | null
  audience: string | null
  tone: string | null
  word_count: number | null
  include_comparison_table: boolean | null
  special_instructions: string | null
  priority: string | null
  status: string
  traffic_light: string | null
  ai_reasoning: string | null
  source: string | null
  kw_volume: number | null
  kw_difficulty: number | null
  traffic_potential: number | null
  url_slug: string | null
  target_subcollection?: string | null
  target_brand?: string | null
  meta_title?: string | null
  description?: string | null
  strategic_notes?: string | null
  ultimate_guide_url?: string | null
  ultimate_guide_title?: string | null
  notes: string | null
  is_shopify_page: boolean | null
  opportunity_score: number | null
  created_at?: string
  updated_at: string
  // Audit layer, joined from content_health / blog_posts / blog_post_tracking
  // by url_slug. Null for rows with no published article yet.
  health_segment?: string | null
  health_grade?: number | null
  health_em_dashes?: number | null
  health_ai_tells?: number | null
  health_era?: string | null
  health_content_images?: number | null
  health_images_keepable?: boolean | null
  health_cannibal_queries?: number | null
  health_cannibal_partners?: string | null
  health_index_status?: string | null
  health_gsc_keyword?: string | null
  health_revamp_mode?: string | null
  health_clicks?: number | null
  health_impressions?: number | null
  health_position?: number | null
  health_revamp_status?: string | null
}

interface Cluster {
  id: number
  hub: string
  name: string
  slug: string
}

interface DraftIdea {
  title: string
  keyword?: string
  hub?: string
  cluster_group?: string
  collection?: string
  collection_slug?: string
  content_type?: string
  article_type?: string
  audience?: string
  tone?: string
  word_count?: number
  special_instructions?: string
  reasoning?: string
}

interface AltKeyword {
  keyword: string
  volume: number | null
  difficulty: number | null
  traffic_potential: number | null
  opportunity_score: number
}

interface EnrichedDraft extends DraftIdea {
  primary_keyword: string | null
  kw_volume: number | null
  kw_difficulty: number | null
  traffic_potential: number | null
  opportunity_score: number | null
  alternate_keywords: AltKeyword[]
  ahrefs_error?: string
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  ideas?: DraftIdea[]
}

type SubView = 'capture' | 'review' | 'map' | 'all' | 'export'

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// Minimal shape of a bulk-upload queue item — mirrors BulkItem in bulk-upload-view.tsx.
// Duplicated here (not imported) to avoid a client-only circular dep and because
// BulkUploadView owns the canonical type. Keep in sync.
export interface BulkItemPush {
  id: string
  title: string
  keyword: string
  collection: string
  /** The brain's live Shopify handle. Authoritative: the label often differs
   *  from the Shopify title ("Saunum Sauna Systems" vs "Saunum"), and deriving
   *  a handle from the label produces one that 404s. */
  collectionSlug?: string
  secondaryCollection?: string
  articleType?: string
  audience?: string
  tone?: string
  wordCount?: number
  includeComparisonTable?: boolean
  specialInstructions?: string
  priority?: string
  brand?: string
  titleTag?: string
  metaDescription?: string
  shopifySlug?: string
  ultimateGuideUrl?: string
  ultimateGuideTitle?: string
  status: 'queued'
  contentBrainId?: number
}

export default function ContentBrainTab({
  onPushToBulkQueue,
}: {
  onPushToBulkQueue?: (items: BulkItemPush[]) => void
} = {}) {
  const [subView, setSubView] = useState<SubView>('map')
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [migrationStatus, setMigrationStatus] = useState<string>('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [iRes, cRes] = await Promise.all([
        fetch('/api/content-brain/ideas'),
        fetch('/api/content-brain/clusters'),
      ])
      if (iRes.ok) {
        const data = await iRes.json()
        setIdeas(data.ideas || [])
      }
      if (cRes.ok) {
        const data = await cRes.json()
        setClusters(data.clusters || [])
      }
    } catch (err) {
      console.error('Content Brain load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // If the clusters table is empty, offer a one-click migration
  const needsMigration = !loading && clusters.length === 0

  const runMigration = async () => {
    setMigrationStatus('Running...')
    try {
      const res = await fetch('/api/content-brain/migrate', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setMigrationStatus(`Migrated. Clusters: ${data.counts.clusters}, Ideas: ${data.counts.ideas}`)
        await refresh()
      } else {
        setMigrationStatus(`Error: ${data.error || 'Unknown'}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setMigrationStatus(`Error: ${msg}`)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="gtd-wrap" style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#003366', margin: 0 }}>
            Content Brain
          </h1>
          <p className="gtd-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            The strategic planning layer above the generation pipeline — every article, idea, and
            topical authority cluster in one place.
          </p>
        </header>

        {needsMigration && (
          <div
            className="gtd-callout"
            style={{
              border: '1px solid #f4c44b',
              background: '#fff8e1',
              padding: 12,
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <strong>Database not yet set up.</strong> Run the one-time migration to create the
            Content Brain tables and seed the canonical hub map.{' '}
            <button
              onClick={runMigration}
              style={{
                marginLeft: 8,
                background: 'rgb(26,122,84)',
                color: 'white',
                border: 'none',
                padding: '6px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Run migration
            </button>
            {migrationStatus && <span style={{ marginLeft: 12, fontSize: 12 }}>{migrationStatus}</span>}
          </div>
        )}

        <SubNav active={subView} onChange={setSubView} reviewCount={ideas.filter((i) => i.status === 'review').length} />

        <div style={{ marginTop: 16 }}>
          {subView === 'capture' && (
            <CaptureView
              onIdeaLogged={refresh}
              onGoToReview={() => setSubView('review')}
            />
          )}
          {subView === 'review' && (
            <ReviewQueueView
              ideas={ideas}
              onRefresh={refresh}
              onPushToBulkQueue={onPushToBulkQueue}
            />
          )}
          {subView === 'map' && (
            <ClusterMapView
              ideas={ideas}
              clusters={clusters}
              loading={loading}
              onRefresh={refresh}
            />
          )}
          {subView === 'all' && (
            <AllArticlesView ideas={ideas} clusters={clusters} onRefresh={refresh} />
          )}
          {subView === 'export' && (
            <ExportQueueView ideas={ideas} onRefresh={refresh} />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-nav
// ---------------------------------------------------------------------------

function SubNav({ active, onChange, reviewCount }: { active: SubView; onChange: (v: SubView) => void; reviewCount: number }) {
  const items: { id: SubView; label: string; badge?: number }[] = [
    { id: 'capture', label: '💬 Capture' },
    { id: 'review', label: '✨ Review Queue', badge: reviewCount },
    { id: 'map', label: '🗺️ Cluster Map' },
    { id: 'all', label: '📚 Article Database' },
    { id: 'export', label: '📤 Export Queue' },
  ]
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid #e5e7eb',
        marginBottom: 4,
      }}
    >
      {items.map((it) => {
        const isActive = it.id === active
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? '2px solid #0066cc' : '2px solid transparent',
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? '#0066cc' : '#6b7280',
              cursor: 'pointer',
            }}
          >
            {it.label}
            {typeof it.badge === 'number' && it.badge > 0 && (
              <span style={{ marginLeft: 6, background: '#0066cc', color: 'white', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{it.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Capture sub-view
// ---------------------------------------------------------------------------

function CaptureView({ onIdeaLogged, onGoToReview }: { onIdeaLogged: () => void; onGoToReview: () => void }) {
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [sending, setSending] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'extracting' | 'approving' | 'submitting'>('idle')
  const [drafts, setDrafts] = useState<DraftIdea[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [submitResult, setSubmitResult] = useState<string | null>(null)
  const bulkFileRef = useRef<HTMLInputElement>(null)
  const [bulkStatus, setBulkStatus] = useState<string>('')
  const [bulkUploading, setBulkUploading] = useState(false)

  const handleBulkCsv = async (file: File) => {
    setBulkUploading(true)
    setBulkStatus('Uploading…')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/content-brain/ideas/bulk-csv', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok && data.ok) {
        setBulkStatus(`✓ Added ${data.inserted} new + updated ${data.updated} to the Review Queue${data.skipped ? `, ${data.skipped} skipped` : ''}.`)
        onIdeaLogged()
      } else {
        setBulkStatus(`Error: ${data.error || 'upload failed'}`)
      }
    } catch (err) {
      setBulkStatus(`Error: ${err instanceof Error ? err.message : 'upload failed'}`)
    } finally {
      setBulkUploading(false)
    }
  }

  const send = async () => {
    if (!input.trim() || sending) return
    const userMessage = input.trim()
    setInput('')
    setSubmitResult(null)
    const nextTurns: ChatTurn[] = [...turns, { role: 'user', content: userMessage }]
    setTurns(nextTurns)
    setSending(true)
    setPhase('extracting')
    try {
      const conversationHistory = nextTurns.slice(-10).map((t) => ({
        role: t.role,
        content: t.content,
      }))
      const res = await fetch('/api/content-brain/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, conversationHistory }),
      })
      const data = await res.json()
      const ideas: DraftIdea[] = data.ideas || []
      const clarification: string = data.clarification || ''
      const assistantText =
        ideas.length > 0
          ? `Extracted ${ideas.length} idea${ideas.length === 1 ? '' : 's'}. Review the titles and cluster mappings below, then send them to the Review Queue for keyword research.`
          : clarification || 'I could not extract any structured ideas from that.'
      setTurns([...nextTurns, { role: 'assistant', content: assistantText, ideas }])

      if (ideas.length === 0) {
        setPhase('idle')
        return
      }
      setDrafts(ideas)
      setSelected(new Set(ideas.map((_, i) => i)))
      setPhase('approving')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setTurns((t) => [...t, { role: 'assistant', content: `Error: ${msg}` }])
      setPhase('idle')
    } finally {
      setSending(false)
    }
  }

  const toggleSelected = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const updateDraft = (idx: number, patch: Partial<DraftIdea>) => {
    setDrafts((arr) => arr.map((d, i) => (i === idx ? { ...d, ...patch } : d)))
  }

  const sendToReview = async () => {
    if (selected.size === 0 || phase === 'submitting') return
    setPhase('submitting')
    setSubmitResult(null)
    const chosen = drafts.filter((_, i) => selected.has(i))
    try {
      const res = await fetch('/api/content-brain/ideas/bulk-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drafts: chosen }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const inserted = data.inserted || 0
      const enriched = data.enriched || 0
      const ahrefsOk = data.ahrefs_available !== false
      let msg = `${inserted} idea${inserted === 1 ? '' : 's'} sent to Review Queue`
      if (ahrefsOk) {
        msg += ` • ${enriched} enriched with Ahrefs`
        if (enriched < inserted) {
          msg += ` (${inserted - enriched} had no keyword data — see Review Queue for details)`
        }
      } else {
        msg += ` • Ahrefs not configured — add AHREFS_API_KEY in Vercel env + redeploy to enable keyword research`
      }
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        console.warn('Ahrefs enrichment errors:', data.errors)
      }
      setSubmitResult(msg)
      setDrafts([])
      setSelected(new Set())
      setPhase('idle')
      onIdeaLogged()
      setTimeout(() => onGoToReview(), 600) // jump to review tab
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown'
      setSubmitResult(`Failed: ${msg}`)
      setPhase('approving')
    }
  }

  const discardDrafts = () => {
    setDrafts([])
    setSelected(new Set())
    setPhase('idle')
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 1100,
        height: 'calc(100vh - 180px)',
        minHeight: 520,
      }}
    >
      <div
        style={{
          flex: turns.length === 0 ? '0 0 auto' : 1,
          minHeight: turns.length === 0 ? 0 : 220,
          overflowY: 'auto',
          background: 'rgb(250,250,248)',
          border: turns.length === 0 ? 'none' : '1px solid #e5e7eb',
          borderRadius: 8,
          padding: turns.length === 0 ? 0 : 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {turns.map((t, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                fontSize: 13,
                color: t.role === 'user' ? '#003366' : '#374151',
                fontWeight: t.role === 'user' ? 600 : 400,
              }}
            >
              <strong>{t.role === 'user' ? 'You' : 'Assistant'}:</strong> {t.content}
            </div>
          </div>
        ))}
        {phase === 'extracting' && (
          <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>
            Extracting ideas from your input…
          </div>
        )}
        {submitResult && (
          <div style={{ fontSize: 13, color: submitResult.startsWith('Failed') ? '#c05621' : 'rgb(26,122,84)', fontWeight: 600, padding: '8px 12px', background: submitResult.startsWith('Failed') ? '#fde7dc' : '#e6f4ea', borderRadius: 6 }}>
            {submitResult}
          </div>
        )}
      </div>

      {/* Approval pane — appears after extraction, before Ahrefs */}
      {phase === 'approving' || phase === 'submitting' ? (
        <ApprovalPane
          drafts={drafts}
          selected={selected}
          onToggle={toggleSelected}
          onUpdate={updateDraft}
          onSubmit={sendToReview}
          onDiscard={discardDrafts}
          submitting={phase === 'submitting'}
        />
      ) : null}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flex: turns.length === 0 ? 1 : '0 0 auto',
          minHeight: turns.length === 0 ? 280 : 140,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '8px 10px', border: '1px dashed #d1d5db', borderRadius: 8, background: '#f9fafb' }}>
          <input
            ref={bulkFileRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleBulkCsv(f)
              e.currentTarget.value = ''
            }}
          />
          <button
            onClick={() => bulkFileRef.current?.click()}
            disabled={bulkUploading}
            style={{ background: 'rgb(26,122,84)', color: 'white', border: 'none', padding: '7px 13px', borderRadius: 6, cursor: bulkUploading ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: bulkUploading ? 0.7 : 1 }}
          >
            {bulkUploading ? 'Uploading…' : 'Bulk Upload CSV'}
          </button>
          <button
            onClick={() => {
              const headers = 'title,keyword,collection,secondarycollection,articleType,audience,tone,wordCount,includeComparisonTable,specialInstructions,priority,titleTag,metaDescription,shopifySlug'
              const blob = new Blob([headers + '\n'], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'content-brain-template.csv'
              a.click()
              URL.revokeObjectURL(url)
            }}
            style={{ background: 'white', color: 'rgb(26,122,84)', border: '1px solid rgb(26,122,84)', padding: '7px 13px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            Download template
          </button>
          <span className="gtd-muted" style={{ fontSize: 11, flex: 1, minWidth: 180 }}>
            Columns: title, keyword, collection (primary → links), secondarycollection (secondary → products), articleType, tone, wordCount… — header casing doesn't matter; rows go to the Review Queue.
          </span>
          {bulkStatus && (
            <span style={{ fontSize: 12, fontWeight: 600, color: bulkStatus.startsWith('Error') ? '#b91c1c' : '#15803d' }}>{bulkStatus}</span>
          )}
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            turns.length === 0
              ? "Paste a voice note, brainstorm doc, competitor research, or strategic memo. I'll extract every article idea and map it to the right hub, cluster, and article type. ⌘/Ctrl + Enter to send."
              : 'Paste another brainstorm or follow up...'
          }
          style={{
            flex: 1,
            width: '100%',
            padding: '14px 16px',
            fontSize: 14,
            lineHeight: '22px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontFamily: 'inherit',
            resize: 'none',
            minHeight: turns.length === 0 ? 220 : 120,
            background: 'white',
            outline: 'none',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="gtd-muted" style={{ fontSize: 11 }}>
            ⌘/Ctrl + Enter to send. Last 10 exchanges kept for context.
            {input.length > 0 && ` • ${input.length.toLocaleString()} chars`}
            {input.length >= 600 && ' • brainstorm mode'}
          </div>
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            style={{
              background: sending || !input.trim() ? '#9ca3af' : 'rgb(26,122,84)',
              color: 'white',
              border: 'none',
              padding: '0 22px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: sending || !input.trim() ? 'default' : 'pointer',
              height: 40,
              flexShrink: 0,
            }}
          >
            {sending ? 'Extracting…' : 'Extract ideas'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Approval pane — post-extract, pre-enrich
// Lightweight cards showing only title + mapping. User approves which ideas
// get sent to the Review Queue (where Ahrefs enrichment happens).
// ---------------------------------------------------------------------------
function ApprovalPane({
  drafts,
  selected,
  onToggle,
  onUpdate,
  onSubmit,
  onDiscard,
  submitting,
}: {
  drafts: DraftIdea[]
  selected: Set<number>
  onToggle: (i: number) => void
  onUpdate: (i: number, patch: Partial<DraftIdea>) => void
  onSubmit: () => void
  onDiscard: () => void
  submitting: boolean
}) {
  const selectedCount = selected.size
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        marginTop: 4,
        maxHeight: '70vh',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#003366' }}>
            {drafts.length} idea{drafts.length === 1 ? '' : 's'} — all set to create
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            Remove any you don&apos;t want. Fix a hub or cluster if it&apos;s wrong. Next step runs Ahrefs research + duplicate check automatically.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onDiscard}
            style={{ padding: '8px 14px', background: '#e5e7eb', color: '#003366', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Discard
          </button>
          <button
            onClick={onSubmit}
            disabled={selectedCount === 0 || submitting}
            style={{
              padding: '8px 18px',
              background: selectedCount === 0 || submitting ? '#9ca3af' : 'rgb(26,122,84)',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: selectedCount === 0 || submitting ? 'default' : 'pointer',
            }}
          >
            {submitting ? 'Enriching + vetting…' : `Send ${selectedCount} to Review Queue →`}
          </button>
        </div>
      </div>

      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
        {drafts.map((d, i) => (
          <ApprovalCard
            key={i}
            draft={d}
            checked={selected.has(i)}
            onToggle={() => onToggle(i)}
            onUpdate={(patch) => onUpdate(i, patch)}
          />
        ))}
      </div>
    </div>
  )
}

const HUB_LIST = ['Saunas', 'Recovery', 'Wellness', 'Cardio']

function ApprovalCard({
  draft,
  checked,
  onToggle,
  onUpdate,
}: {
  draft: DraftIdea
  checked: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<DraftIdea>) => void
}) {
  return (
    <div
      style={{
        background: checked ? '#f9fafb' : '#f3f4f6',
        border: '1px solid #e5e7eb',
        borderLeft: `3px solid ${checked ? '#0066cc' : '#9ca3af'}`,
        borderRadius: 6,
        padding: 10,
        opacity: checked ? 1 : 0.55,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <input type="checkbox" checked={checked} onChange={onToggle} style={{ marginTop: 3 }} />
        <div style={{ flex: 1 }}>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            style={{ width: '100%', fontSize: 14, fontWeight: 600, color: '#003366', border: 'none', background: 'transparent', padding: 0, outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={draft.hub || ''} onChange={(e) => onUpdate({ hub: e.target.value })} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid #d1d5db' }}>
              <option value="">(no hub)</option>
              {HUB_LIST.map((h) => <option key={h}>{h}</option>)}
            </select>
            <input
              type="text"
              value={draft.cluster_group || ''}
              onChange={(e) => onUpdate({ cluster_group: e.target.value })}
              placeholder="cluster"
              style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid #d1d5db', width: 180 }}
            />
            {draft.article_type && <Badge color="rgb(26,122,84)">{draft.article_type}</Badge>}
            {draft.content_type && <Badge color={draft.content_type === 'pillar' ? '#d4930a' : '#6b7280'}>{draft.content_type}</Badge>}
            {draft.keyword && <span style={{ fontSize: 11, color: '#6b7280' }}>seed kw: {draft.keyword}</span>}
          </div>
          {draft.reasoning && (
            <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', marginTop: 4 }}>{draft.reasoning}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Review Queue sub-view — dedicated tab for enriched, pending-push ideas
// Fetches rows with status='review' from DB, shows full edit/swap UI, pushes
// selected rows to status='planned' (which lands them in All Articles).
// ---------------------------------------------------------------------------
function ReviewQueueView({
  ideas,
  onRefresh,
  onPushToBulkQueue,
}: {
  ideas: Idea[]
  onRefresh: () => void
  onPushToBulkQueue?: (items: BulkItemPush[]) => void
}) {
  const queue = useMemo(() => ideas.filter((i) => i.status === 'review'), [ideas])
  const [edits, setEdits] = useState<Record<number, Partial<Idea>>>({})
  const [alts, setAlts] = useState<Record<number, AltKeyword[]>>({})
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadingAlts, setLoadingAlts] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pushing, setPushing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Select all by default when queue changes
  useEffect(() => {
    setSelected(new Set(queue.map((q) => q.id)))
  }, [queue.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const patchLocal = (id: number, patch: Partial<Idea>) => {
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }))
  }

  const saveRow = async (id: number) => {
    const patch = edits[id]
    if (!patch || Object.keys(patch).length === 0) return
    await fetch('/api/content-brain/ideas', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    setEdits((e) => {
      const next = { ...e }
      delete next[id]
      return next
    })
    onRefresh()
  }

  const loadAlternates = async (row: Idea) => {
    if (alts[row.id] || loadingAlts.has(row.id)) return
    setLoadingAlts((s) => new Set(s).add(row.id))
    try {
      const seed = (edits[row.id]?.keyword as string) || row.keyword || row.title
      const res = await fetch('/api/content-brain/ahrefs/gaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, cluster_group: row.cluster_group, limit: 15 }),
      })
      const data = await res.json()
      const list: AltKeyword[] = (data.gaps || []).slice(0, 8).map((g: { keyword: string; volume: number | null; difficulty: number | null; traffic_potential: number | null; opportunity_score: number }) => ({
        keyword: g.keyword,
        volume: g.volume,
        difficulty: g.difficulty,
        traffic_potential: g.traffic_potential,
        opportunity_score: g.opportunity_score,
      }))
      setAlts((a) => ({ ...a, [row.id]: list }))
    } finally {
      setLoadingAlts((s) => {
        const next = new Set(s)
        next.delete(row.id)
        return next
      })
    }
  }

  const swapKeyword = (row: Idea, alt: AltKeyword) => {
    patchLocal(row.id, {
      keyword: alt.keyword,
      kw_volume: alt.volume,
      kw_difficulty: alt.difficulty,
      traffic_potential: alt.traffic_potential,
      opportunity_score: alt.opportunity_score,
    })
  }

  const reEnrich = async (row: Idea) => {
    setLoadingAlts((s) => new Set(s).add(row.id))
    try {
      await fetch('/api/content-brain/ahrefs/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [row.id] }),
      })
      onRefresh()
    } finally {
      setLoadingAlts((s) => {
        const next = new Set(s)
        next.delete(row.id)
        return next
      })
    }
  }

  const pushSelected = async () => {
    if (selected.size === 0 || pushing) return
    setPushing(true)
    setMessage(null)

    // 1. Persist edits + flip status='in-queue' on every selected row
    const pushedRows: Idea[] = []
    let ok = 0
    let fail = 0
    for (const id of selected) {
      const patch = { ...(edits[id] || {}), status: 'in-queue' as const }
      try {
        const res = await fetch('/api/content-brain/ideas', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...patch }),
        })
        if (res.ok) {
          ok++
          const row = queue.find((q) => q.id === id)
          if (row) pushedRows.push({ ...row, ...(edits[id] || {}) })
        } else {
          fail++
        }
      } catch {
        fail++
      }
    }

    // 2. Build BulkItems from the pushed rows and hand off to parent. Parent
    //    sets bulkPrefill + navigates to the Bulk Upload view. The Content
    //    Brain row carries its id via contentBrainId so generation can later
    //    sync status back to 'live'.
    if (pushedRows.length > 0 && onPushToBulkQueue) {
      const BUYER_TABLE_TYPES = new Set(['buyers-guide', 'comparison', 'brand-review'])
      const bulkItems: BulkItemPush[] = pushedRows.map((r) => {
        const at = (r.article_type || '').toLowerCase()
        return {
          id: `brain-${r.id}-${Date.now().toString(36)}`,
          contentBrainId: r.id,
          title: r.title,
          keyword: r.keyword || '',
          collection: r.collection || r.cluster_group || '',
          collectionSlug: r.collection_slug || undefined,
          secondaryCollection: (r.target_subcollection as string) || undefined,
          articleType: r.article_type || undefined,
          audience: r.audience || 'general',
          tone: r.tone || 'educational',
          wordCount: r.word_count || 2500,
          includeComparisonTable: BUYER_TABLE_TYPES.has(at),
          specialInstructions: r.special_instructions || undefined,
          priority: r.priority || 'P2',
          // The planned slug, brand and meta fields used to stop here. The
          // queue then re-slugified the title, which is where slug drift came
          // from, and the brand never reached the product picker.
          brand: (r.target_brand as string) || undefined,
          titleTag: (r.meta_title as string) || undefined,
          metaDescription: (r.description as string) || undefined,
          shopifySlug: (r.url_slug as string) || undefined,
          ultimateGuideUrl: (r.ultimate_guide_url as string) || undefined,
          ultimateGuideTitle: (r.ultimate_guide_title as string) || undefined,
          status: 'queued',
        }
      })
      onPushToBulkQueue(bulkItems)
    }

    setPushing(false)
    setMessage(
      `${ok} idea${ok === 1 ? '' : 's'} pushed to Bulk Upload Queue${fail ? ` • ${fail} failed` : ''}. Open the Bulk Upload view and hit Play.`
    )
    setEdits({})
    onRefresh()
  }

  const discardRow = async (id: number) => {
    if (!confirm('Discard this idea? It will be deleted from the queue.')) return
    await fetch(`/api/content-brain/ideas?id=${id}`, { method: 'DELETE' })
    onRefresh()
  }

  if (queue.length === 0) {
    return (
      <div style={{ padding: 32, background: 'rgb(250,250,248)', borderRadius: 10, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
        Review Queue is empty. Capture new ideas in the <strong>Capture</strong> tab — approved ideas land here with keyword research attached before going to the content queue.
      </div>
    )
  }

  // Verdict summary for the header banner
  const lights = queue.reduce(
    (a, q) => {
      const l = (q.traffic_light || 'green') as 'red' | 'yellow' | 'green' | 'unvetted'
      if (l === 'red') a.red++
      else if (l === 'yellow') a.yellow++
      else a.green++
      return a
    },
    { green: 0, yellow: 0, red: 0 }
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#003366' }}>
            {queue.length} idea{queue.length === 1 ? '' : 's'} ready — {' '}
            <span style={{ color: 'rgb(26,122,84)' }}>🟢 {lights.green} ready</span>
            {lights.yellow > 0 && <span style={{ color: '#d69e2e' }}> • 🟡 {lights.yellow} caution</span>}
            {lights.red > 0 && <span style={{ color: '#c05621' }}> • 🔴 {lights.red} flagged</span>}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            Proceed unless flagged. Red = keyword collision or near-duplicate; yellow = worth a glance; green = safe to push.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setSelected(new Set(queue.map((q) => q.id)))}
            style={{ padding: '6px 10px', fontSize: 12, background: 'white', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}
          >
            Select all
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{ padding: '6px 10px', fontSize: 12, background: 'white', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}
          >
            Select none
          </button>
          <button
            onClick={async () => {
              // Pass every visible Review-Queue row id. The enrich endpoint will
              // use the title as seed when the row has no keyword yet, and pick
              // the winning primary keyword from Ahrefs matching-terms.
              const ids = queue.map((q) => q.id)
              if (ids.length === 0) {
                setMessage('No rows to enrich.')
                return
              }
              setMessage(`Enriching ${ids.length} row${ids.length === 1 ? '' : 's'} with Ahrefs…`)
              const res = await fetch('/api/content-brain/ahrefs/enrich', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
              })
              const data = await res.json()
              const errs: string[] = Array.isArray(data.errors) ? data.errors : []
              let msg = `Ahrefs: ${data.enriched || 0}/${data.attempted ?? ids.length} enriched`
              if (errs.length > 0) {
                msg += '\n\nErrors:\n' + errs.slice(0, 8).join('\n')
                if (errs.length > 8) msg += `\n…and ${errs.length - 8} more`
              } else if (data.enriched === 0) {
                msg += '\n\nNo rows were updated. Most likely causes:\n• AHREFS_API_KEY missing or wrong in Vercel env (re-deploy after saving it)\n• Key has no access to Keywords Explorer\nUse Settings → Maintenance → "Ping Ahrefs" to see the exact error.'
              }
              setMessage(msg)
              onRefresh()
            }}
            style={{ padding: '6px 10px', fontSize: 12, background: 'white', border: '1px solid #0066cc', color: '#0066cc', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            ↻ Run Ahrefs on all queue rows
          </button>
          <button
            onClick={pushSelected}
            disabled={selected.size === 0 || pushing}
            style={{
              padding: '8px 18px',
              background: selected.size === 0 || pushing ? '#9ca3af' : 'rgb(26,122,84)',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: selected.size === 0 || pushing ? 'default' : 'pointer',
            }}
          >
            {pushing ? 'Pushing…' : `Push ${selected.size} to Bulk Upload →`}
          </button>
        </div>
      </div>

      {message && (
        <div style={{ fontSize: 12, color: message.toLowerCase().includes('error') || message.includes('0/') ? '#7a2a08' : 'rgb(26,122,84)', fontWeight: 500, padding: '10px 14px', background: message.toLowerCase().includes('error') || message.includes('0/') ? '#fde7dc' : '#e6f4ea', borderRadius: 6, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' }}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {queue.map((row) => {
          const e = edits[row.id] || {}
          const merged = { ...row, ...e }
          const score = merged.opportunity_score as number | null | undefined
          const scoreColor =
            score == null ? '#9ca3af' : score >= 60 ? 'rgb(26,122,84)' : score >= 30 ? '#d69e2e' : '#c05621'
          const isSelected = selected.has(row.id)
          const isDirty = Object.keys(e).length > 0
          const rowAlts = alts[row.id]
          const isExpanded = expanded.has(row.id)
          const isLoadingAlts = loadingAlts.has(row.id)
          const light = (merged.traffic_light || 'green') as 'red' | 'yellow' | 'green' | 'unvetted'
          const lightColor = light === 'red' ? '#c05621' : light === 'yellow' ? '#d69e2e' : light === 'green' ? 'rgb(26,122,84)' : '#9ca3af'
          const lightEmoji = light === 'red' ? '🔴' : light === 'yellow' ? '🟡' : light === 'green' ? '🟢' : '⚪'
          const lightLabel = light === 'red' ? 'Flagged' : light === 'yellow' ? 'Caution' : light === 'green' ? 'Ready' : 'Unvetted'
          const reasoning = (merged.ai_reasoning as string) || (merged.strategic_notes as string) || ''
          const showReasoningByDefault = light === 'red' || light === 'yellow'

          return (
            <div
              key={row.id}
              style={{
                background: isSelected ? 'white' : '#f3f4f6',
                border: '1px solid #e5e7eb',
                borderLeft: `4px solid ${isSelected ? lightColor : '#9ca3af'}`,
                borderRadius: 8,
                padding: 12,
                opacity: isSelected ? 1 : 0.65,
              }}
            >
              {/* Verdict pill — the lead element */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: lightColor, padding: '2px 10px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {lightEmoji} {lightLabel}
                </span>
                {showReasoningByDefault && reasoning && (
                  <span style={{ fontSize: 11, color: lightColor, fontWeight: 500 }}>{reasoning}</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <input type="checkbox" checked={isSelected} onChange={() => toggle(row.id)} style={{ marginTop: 5 }} />
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    value={(merged.title as string) || ''}
                    onChange={(ev) => patchLocal(row.id, { title: ev.target.value })}
                    style={{ width: '100%', fontSize: 14, fontWeight: 600, color: '#003366', border: 'none', background: 'transparent', padding: 0, outline: 'none' }}
                  />
                  <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#6b7280', marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={(merged.keyword as string) || ''}
                      onChange={(ev) => patchLocal(row.id, { keyword: ev.target.value })}
                      placeholder="primary keyword"
                      style={{ fontSize: 12, fontWeight: 600, color: '#003366', border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 6px', width: 240 }}
                    />
                    {merged.kw_volume != null && <span>vol <strong>{Number(merged.kw_volume).toLocaleString()}</strong></span>}
                    {merged.kw_difficulty != null && <span>KD <strong>{merged.kw_difficulty}</strong></span>}
                    {merged.traffic_potential != null && <span>TP <strong>{Number(merged.traffic_potential).toLocaleString()}</strong></span>}
                    {score != null && <span style={{ color: scoreColor, fontWeight: 700 }}>opp {score}</span>}
                    {merged.hub && <Badge color="#0066cc">{merged.hub as string}</Badge>}
                    {merged.cluster_group && <Badge color="#6b7280">{merged.cluster_group as string}</Badge>}
                    {merged.article_type && <Badge color="rgb(26,122,84)">{merged.article_type as string}</Badge>}
                  </div>

                  {/* Confirm every CSV field that was picked up */}
                  <div style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 11, flexWrap: 'wrap', color: '#6b7280' }}>
                    <span>primary: <strong style={{ color: '#003366' }}>{(merged.collection as string) || '—'}</strong> <span style={{ color: '#9ca3af' }}>(links)</span></span>
                    <span>secondary: <strong style={{ color: merged.target_subcollection ? '#15803d' : '#b91c1c' }}>{(merged.target_subcollection as string) || 'not set'}</strong> <span style={{ color: '#9ca3af' }}>(products)</span></span>
                    {merged.tone ? <span>tone: {merged.tone as string}</span> : null}
                    {merged.audience ? <span>aud: {merged.audience as string}</span> : null}
                    {merged.word_count != null ? <span>{merged.word_count as number}w</span> : null}
                    {merged.include_comparison_table ? <span>+table</span> : null}
                    {merged.priority ? <span>{merged.priority as string}</span> : null}
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 11, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => {
                        setExpanded((s) => {
                          const next = new Set(s)
                          if (next.has(row.id)) next.delete(row.id)
                          else next.add(row.id)
                          return next
                        })
                        if (!rowAlts) loadAlternates(row)
                      }}
                      style={{ background: 'transparent', border: 'none', color: '#0066cc', cursor: 'pointer', padding: 0 }}
                    >
                      {isExpanded ? '▾' : '▸'} alternate keywords
                    </button>
                    <button
                      onClick={() => reEnrich(row)}
                      disabled={isLoadingAlts}
                      style={{ background: 'transparent', border: 'none', color: '#0066cc', cursor: 'pointer', padding: 0 }}
                    >
                      {isLoadingAlts ? '…refreshing' : '↻ re-run Ahrefs'}
                    </button>
                    {isDirty && (
                      <button onClick={() => saveRow(row.id)} style={{ background: '#0066cc', color: 'white', border: 'none', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                        Save edits
                      </button>
                    )}
                    <button onClick={() => discardRow(row.id)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #c05621', color: '#c05621', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
                      Discard
                    </button>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {isLoadingAlts && !rowAlts && <div style={{ fontSize: 11, color: '#6b7280' }}>Loading alternates from Ahrefs…</div>}
                      {rowAlts && rowAlts.length === 0 && <div style={{ fontSize: 11, color: '#6b7280' }}>No alternates found.</div>}
                      {rowAlts && rowAlts.map((alt, k) => (
                        <button
                          key={k}
                          onClick={() => swapKeyword(row, alt)}
                          style={{ textAlign: 'left', background: 'white', border: '1px solid #e5e7eb', borderRadius: 4, padding: '5px 8px', fontSize: 11, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10 }}
                        >
                          <span>{alt.keyword}</span>
                          <span style={{ color: '#6b7280' }}>
                            vol {alt.volume?.toLocaleString() ?? '—'} • KD {alt.difficulty ?? '—'} • opp <strong style={{ color: '#003366' }}>{alt.opportunity_score}</strong>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {(merged.strategic_notes || merged.ai_reasoning) && (
                    <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', marginTop: 8, padding: '6px 8px', background: 'rgb(250,250,248)', borderLeft: '2px solid #0066cc', borderRadius: 3 }}>
                      {(merged.strategic_notes as string) || (merged.ai_reasoning as string)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        padding: '2px 7px',
        borderRadius: 10,
        border: `1px solid ${color}`,
        color,
        background: 'white',
      }}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Cluster Map sub-view
// ---------------------------------------------------------------------------

function ClusterMapView({
  ideas,
  clusters,
  loading,
  onRefresh,
}: {
  ideas: Idea[]
  clusters: Cluster[]
  loading: boolean
  onRefresh: () => void
}) {
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set())
  const [editingIdea, setEditingIdea] = useState<Idea | null>(null)
  const [addingToCluster, setAddingToCluster] = useState<{ hub: string; cluster: string } | null>(
    null
  )
  const [newClusterHub, setNewClusterHub] = useState<Hub | null>(null)
  const [newClusterName, setNewClusterName] = useState('')
  const [newClusterSlug, setNewClusterSlug] = useState('')

  // All clusters start closed — user expands what they need
  // (removed auto-expand: with 20+ clusters across 5 hubs it was too noisy)

  const toggleCluster = (key: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const ideasByHub = useMemo(() => {
    const m: Record<string, Idea[]> = {}
    for (const h of HUBS) m[h] = []
    for (const i of ideas) {
      if (i.hub && m[i.hub]) m[i.hub].push(i)
    }
    return m
  }, [ideas])

  const clustersByHub = useMemo(() => {
    const m: Record<string, Cluster[]> = {}
    for (const h of HUBS) m[h] = []
    // 1) saved clusters from the DB
    for (const c of clusters) {
      if (m[c.hub]) m[c.hub].push(c)
    }
    // 2) synthesize a row for any cluster_group that has articles but no saved
    //    cluster (e.g. the general "Saunas" group) so nothing is ever hidden —
    //    every group with articles is visible and expandable.
    for (const h of HUBS) {
      const existingNames = new Set(m[h].map((c) => c.name.toLowerCase()))
      const existingSlugs = new Set(m[h].map((c) => (c.slug || '').toLowerCase()))
      const seen = new Set<string>()
      for (const i of ideas) {
        if (i.hub !== h) continue
        const label = (i.cluster_group || '').trim()
        if (!label) continue
        const lc = label.toLowerCase()
        const slug = (i.collection_slug || '').trim()
        if (existingNames.has(lc) || (slug && existingSlugs.has(slug.toLowerCase())) || seen.has(lc)) continue
        seen.add(lc)
        m[h].push({
          id: `auto:${h}:${slug || lc}`,
          hub: h,
          name: label,
          slug: slug || lc.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        } as Cluster)
      }
    }
    return m
  }, [clusters, ideas])

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const saveNewCluster = async () => {
    if (!newClusterHub || !newClusterName.trim() || !newClusterSlug.trim()) return
    const res = await fetch('/api/content-brain/clusters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hub: newClusterHub,
        name: newClusterName.trim(),
        slug: newClusterSlug.trim(),
      }),
    })
    if (res.ok) {
      setNewClusterHub(null)
      setNewClusterName('')
      setNewClusterSlug('')
      onRefresh()
    } else {
      const err = await res.json()
      alert(err.error || 'Failed to add sub-cluster')
    }
  }

  if (loading) {
    return <div className="gtd-muted">Loading…</div>
  }

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {HUBS.map((hub) => {
          const hubIdeas = ideasByHub[hub]
          const liveCount = hubIdeas.filter((i) => i.status === 'live').length
          const totalCount = hubIdeas.length
          const pct = totalCount > 0 ? Math.round((liveCount / totalCount) * 100) : 0
          const hubClusters = clustersByHub[hub]

          return (
            <div
              key={hub}
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#003366' }}>
                    {hub}
                  </h3>
                  <span className="gtd-muted" style={{ fontSize: 11 }}>
                    {liveCount}/{totalCount} live
                  </span>
                </div>
                <ProgressBar pct={pct} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {hubClusters.map((c) => {
                  const key = `${hub}::${c.name}`
                  const expanded = expandedClusters.has(key)
                  const clusterIdeas = hubIdeas.filter(
                    (i) => i.cluster_group === c.name || i.collection_slug === c.slug
                  )
                  const pillar = clusterIdeas.find((i) => i.content_type === 'pillar')
                  const rest = clusterIdeas.filter((i) => i.content_type !== 'pillar')
                  const clusterLive = clusterIdeas.filter((i) => i.status === 'live').length
                  const clusterTotal = clusterIdeas.length
                  const clusterPct =
                    clusterTotal > 0 ? Math.round((clusterLive / clusterTotal) * 100) : 0

                  return (
                    <div
                      key={c.id}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 6,
                        padding: 8,
                        background: 'rgb(250,250,248)',
                      }}
                    >
                      <button
                        onClick={() => toggleCluster(key)}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          border: 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#374151',
                          }}
                        >
                          <span>
                            {expanded ? '▾' : '▸'} {c.name}
                          </span>
                          <span className="gtd-muted" style={{ fontSize: 10, fontWeight: 400 }}>
                            {clusterLive}/{clusterTotal}
                          </span>
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <ProgressBar pct={clusterPct} thin />
                        </div>
                      </button>

                      {expanded && (
                        <div
                          style={{
                            marginTop: 8,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          {pillar && (
                            <ArticleRow
                              idea={pillar}
                              pillar
                              onClick={() => setEditingIdea(pillar)}
                            />
                          )}
                          {rest.map((i) => (
                            <ArticleRow
                              key={i.id}
                              idea={i}
                              onClick={() => setEditingIdea(i)}
                            />
                          ))}
                          {clusterIdeas.length === 0 && (
                            <div className="gtd-muted" style={{ fontSize: 11, fontStyle: 'italic' }}>
                              No articles yet.
                            </div>
                          )}
                          <button
                            onClick={() =>
                              setAddingToCluster({ hub, cluster: c.name })
                            }
                            style={{
                              marginTop: 4,
                              background: 'transparent',
                              border: '1px dashed #9ca3af',
                              color: '#6b7280',
                              padding: '4px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            + Add Article
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {newClusterHub === hub ? (
                <div
                  style={{
                    border: '1px dashed #0066cc',
                    padding: 8,
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <input
                    value={newClusterName}
                    onChange={(e) => {
                      setNewClusterName(e.target.value)
                      setNewClusterSlug(slugify(e.target.value))
                    }}
                    placeholder="Sub-cluster name"
                    style={{
                      padding: 6,
                      fontSize: 12,
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                    }}
                  />
                  <input
                    value={newClusterSlug}
                    onChange={(e) => setNewClusterSlug(e.target.value)}
                    placeholder="slug-kebab-case"
                    style={{
                      padding: 6,
                      fontSize: 12,
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      fontFamily: 'monospace',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={saveNewCluster}
                      style={{
                        background: 'rgb(26,122,84)',
                        color: 'white',
                        border: 'none',
                        padding: '5px 10px',
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setNewClusterHub(null)
                        setNewClusterName('')
                        setNewClusterSlug('')
                      }}
                      style={{
                        background: 'transparent',
                        border: '1px solid #d1d5db',
                        padding: '5px 10px',
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setNewClusterHub(hub)}
                  style={{
                    background: 'transparent',
                    border: '1px dashed #0066cc',
                    color: '#0066cc',
                    padding: '6px 10px',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  + Add Sub-cluster
                </button>
              )}
            </div>
          )
        })}
      </div>

      {editingIdea && (
        <EditIdeaPanel
          idea={editingIdea}
          clusters={clusters}
          onClose={() => setEditingIdea(null)}
          onSaved={() => {
            setEditingIdea(null)
            onRefresh()
          }}
        />
      )}
      {addingToCluster && (
        <EditIdeaPanel
          idea={null}
          defaults={{
            hub: addingToCluster.hub,
            cluster_group: addingToCluster.cluster,
            collection: addingToCluster.cluster,
            collection_slug: clusters.find(
              (c) => c.hub === addingToCluster.hub && c.name === addingToCluster.cluster
            )?.slug,
          }}
          clusters={clusters}
          onClose={() => setAddingToCluster(null)}
          onSaved={() => {
            setAddingToCluster(null)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

function ProgressBar({ pct, thin }: { pct: number; thin?: boolean }) {
  return (
    <div
      style={{
        background: '#e5e7eb',
        borderRadius: 10,
        height: thin ? 4 : 6,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          background: 'rgb(26,122,84)',
          height: '100%',
          transition: 'width 0.3s',
        }}
      />
    </div>
  )
}

function ArticleRow({
  idea,
  pillar,
  onClick,
}: {
  idea: Idea
  pillar?: boolean
  onClick: () => void
}) {
  const statusDot =
    idea.status === 'live'
      ? '🟢'
      : idea.status === 'planned' || idea.status === 'in-queue' || idea.status === 'generated'
      ? '🟡'
      : idea.traffic_light === 'red'
      ? '🔴'
      : '⚪'

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'white',
        border: '1px solid #e5e7eb',
        borderLeft: pillar ? '3px solid #0066cc' : '1px solid #e5e7eb',
        borderRadius: 4,
        padding: '5px 8px',
        fontSize: 11,
        cursor: 'pointer',
        textAlign: 'left',
        color: '#374151',
        width: '100%',
      }}
    >
      <span>{statusDot}</span>
      {pillar && <span>📌</span>}
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: idea.status === 'live' ? 0.65 : 1,
        }}
      >
        {idea.title}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// All Articles sub-view
// ---------------------------------------------------------------------------

function AllArticlesView({
  ideas,
  clusters,
  onRefresh,
}: {
  ideas: Idea[]
  clusters: Cluster[]
  onRefresh: () => void
}) {
  const [filterHub, setFilterHub] = useState('')
  const [filterCluster, setFilterCluster] = useState('')
  const [filterStatus, setFilterStatus] = useState('planned')
  const [filterLight, setFilterLight] = useState('')
  const [filterType, setFilterType] = useState('')
  // Audit-layer controls: filter by segment or grade band, and choose the sort.
  // Without a sort the list came back in hub/cluster order, which reads as
  // "nothing newer than June" even when this week's articles are present.
  const [filterHealth, setFilterHealth] = useState('')
  const [sortBy, setSortBy] = useState('updated')
  const [search, setSearch] = useState('')
  const [editingIdea, setEditingIdea] = useState<Idea | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [tapImportOpen, setTapImportOpen] = useState(false)
  const [shopifyImporting, setShopifyImporting] = useState(false)
  const [vettingId, setVettingId] = useState<number | null>(null)
  const [vetResult, setVetResult] = useState<{ id: number; traffic_light: string; reasoning: string } | null>(null)
  // Batch-push state
  const [batchSelected, setBatchSelected] = useState<Set<number>>(new Set())
  const [batching, setBatching] = useState(false)
  const [batchMessage, setBatchMessage] = useState<string | null>(null)
  const [batchStatusValue, setBatchStatusValue] = useState('live')
  const [settingStatus, setSettingStatus] = useState(false)

  const availableClusters = useMemo(() => {
    if (!filterHub) return clusters
    return clusters.filter((c) => c.hub === filterHub)
  }, [filterHub, clusters])

  const filtered = useMemo(() => {
    // Article Database is a database of live/published content by default.
    // Review-queue rows always hidden here. Status filter defaults to 'live';
    // user can flip to 'planned' / 'idea' etc. if digging into non-live.
    let rows = ideas.filter((r) => r.status !== 'review')
    if (filterHub) rows = rows.filter((r) => r.hub === filterHub)
    if (filterCluster) rows = rows.filter((r) => r.cluster_group === filterCluster)
    if (filterStatus) rows = rows.filter((r) => r.status === filterStatus)
    if (filterLight) rows = rows.filter((r) => (r.traffic_light || 'unvetted') === filterLight)
    if (filterType) rows = rows.filter((r) => r.content_type === filterType)
    if (filterHealth) {
      rows = rows.filter((r) => {
        const g = r.health_grade
        switch (filterHealth) {
          case 'A-protect': case 'B-refresh': case 'C-full-regen':
          case 'D-delete-or-combine': case 'E-new-v2':
            return r.health_segment === filterHealth
          case 'grade-90': return g != null && g >= 90
          case 'grade-70': return g != null && g >= 70 && g < 90
          case 'grade-low': return g != null && g < 70
          case 'ungraded': return g == null
          case 'cannibalizing': return (r.health_cannibal_queries || 0) > 0
          case 'revamped': return r.health_revamp_status === 'revamped'
          default: return true
        }
      })
    }
    if (search) {
      const s = search.toLowerCase()
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(s) || (r.keyword || '').toLowerCase().includes(s)
      )
    }
    const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback)
    const time = (v: unknown) => (v ? new Date(String(v)).getTime() : 0)
    const sorted = [...rows]
    switch (sortBy) {
      // Worst first: this is a work queue, so the posts needing attention lead.
      case 'grade': sorted.sort((a, b) => num(a.health_grade, 101) - num(b.health_grade, 101)); break
      case 'grade-desc': sorted.sort((a, b) => num(b.health_grade, -1) - num(a.health_grade, -1)); break
      case 'clicks': sorted.sort((a, b) => num(b.health_clicks, -1) - num(a.health_clicks, -1)); break
      case 'cannibal': sorted.sort((a, b) => num(b.health_cannibal_queries, 0) - num(a.health_cannibal_queries, 0)); break
      case 'title': sorted.sort((a, b) => a.title.localeCompare(b.title)); break
      case 'created': sorted.sort((a, b) => time(b.created_at) - time(a.created_at)); break
      default: sorted.sort((a, b) => time(b.updated_at) - time(a.updated_at))
    }
    return sorted
  }, [ideas, filterHub, filterCluster, filterStatus, filterLight, filterType, filterHealth, sortBy, search])

  // Keyword collision map (case-insensitive)
  const kwCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of ideas) {
      const k = (r.keyword || '').trim().toLowerCase()
      if (!k) continue
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }, [ideas])

  const updateStatus = async (id: number, status: string) => {
    await fetch('/api/content-brain/ideas', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    onRefresh()
  }

  const togglePage = async (id: number, currentVal: boolean) => {
    await fetch('/api/content-brain/ideas', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_shopify_page: !currentVal }),
    })
    onRefresh()
  }

  const deleteIdea = async (id: number) => {
    await fetch(`/api/content-brain/ideas?id=${id}`, { method: 'DELETE' })
    setDeleteConfirmId(null)
    onRefresh()
  }

  const trafficEmoji = (tl: string | null) => {
    if (tl === 'green') return '🟢'
    if (tl === 'yellow') return '🟡'
    if (tl === 'red') return '🔴'
    return '⬜'
  }

  const toggleBatch = (id: number) => {
    setBatchSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleBatchAll = () => {
    if (batchSelected.size === filtered.length) {
      setBatchSelected(new Set())
    } else {
      setBatchSelected(new Set(filtered.map((r) => r.id)))
    }
  }

  const sendBatchToReview = async () => {
    if (batchSelected.size === 0 || batching) return
    setBatching(true)
    setBatchMessage(null)
    try {
      const res = await fetch('/api/content-brain/ideas/batch-to-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(batchSelected) }),
      })
      const data = await res.json()
      const enrichedNote = data.ahrefs_available === false
        ? ' (no Ahrefs key — add AHREFS_API_KEY in Vercel)'
        : ` • ${data.enriched}/${data.promoted} enriched with Ahrefs`
      setBatchMessage(
        `${data.promoted} article${data.promoted === 1 ? '' : 's'} sent to Review Queue${enrichedNote}. Open the Review Queue tab to approve and push.`
      )
      setBatchSelected(new Set())
      onRefresh()
    } catch (e) {
      setBatchMessage(`Failed: ${e instanceof Error ? e.message : 'Unknown'}`)
    } finally {
      setBatching(false)
    }
  }

  const batchSetStatus = async () => {
    if (batchSelected.size === 0 || settingStatus) return
    setSettingStatus(true)
    setBatchMessage(null)
    let ok = 0; let fail = 0
    for (const id of batchSelected) {
      try {
        const res = await fetch('/api/content-brain/ideas', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: batchStatusValue }),
        })
        if (res.ok) ok++; else fail++
      } catch { fail++ }
    }
    setSettingStatus(false)
    setBatchMessage(`${ok} article${ok === 1 ? '' : 's'} set to "${batchStatusValue}"${fail ? ` • ${fail} failed` : ''}.`)
    setBatchSelected(new Set())
    onRefresh()
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 12,
          alignItems: 'center',
        }}
      >
        <Select value={filterHub} onChange={setFilterHub} placeholder="All Hubs">
          {HUBS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </Select>
        <Select value={filterCluster} onChange={setFilterCluster} placeholder="All Clusters">
          {availableClusters.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={filterStatus} onChange={setFilterStatus} placeholder="All Statuses">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={filterLight} onChange={setFilterLight} placeholder="All Lights">
          {TRAFFIC_LIGHTS.map((t) => (
            <option key={t} value={t}>
              {trafficEmoji(t)} {t}
            </option>
          ))}
        </Select>
        <Select value={filterHealth} onChange={setFilterHealth} placeholder="All Health">
          <option value="A-protect">Segment A: protect</option>
          <option value="B-refresh">Segment B: refresh</option>
          <option value="C-full-regen">Segment C: full regen</option>
          <option value="D-delete-or-combine">Segment D: delete or combine</option>
          <option value="E-new-v2">New v2 content</option>
          <option value="grade-90">Grade 90 and up</option>
          <option value="grade-70">Grade 70 to 89</option>
          <option value="grade-low">Grade under 70</option>
          <option value="cannibalizing">Cannibalizing</option>
          <option value="revamped">Already revamped</option>
          <option value="ungraded">Not graded yet</option>
        </Select>
        <Select value={sortBy} onChange={setSortBy} placeholder="Sort">
          <option value="updated">Sort: recently updated</option>
          <option value="created">Sort: newest created</option>
          <option value="grade">Sort: grade, worst first</option>
          <option value="grade-desc">Sort: grade, best first</option>
          <option value="clicks">Sort: most clicks</option>
          <option value="cannibal">Sort: most cannibalization</option>
          <option value="title">Sort: title A to Z</option>
        </Select>
        <Select value={filterType} onChange={setFilterType} placeholder="All Types">
          {CONTENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or keyword..."
          style={{
            padding: 6,
            fontSize: 12,
            border: '1px solid #d1d5db',
            borderRadius: 4,
            minWidth: 200,
            flex: 1,
          }}
        />
        <button
          onClick={() => setEditingIdea({ id: 0 } as Idea)}
          style={{
            background: '#0066cc',
            color: 'white',
            border: 'none',
            padding: '6px 12px',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          + New Article
        </button>
        <button
          onClick={() => setTapImportOpen(true)}
          style={{
            background: 'transparent',
            border: '1px solid #0066cc',
            color: '#0066cc',
            padding: '6px 12px',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Import TAP
        </button>
        <button
          disabled={shopifyImporting}
          onClick={async () => {
            if (!confirm('Pull all published Shopify articles into Content Brain?')) return
            setShopifyImporting(true)
            try {
              const res = await fetch('/api/content-brain/shopify-import', { method: 'POST' })
              const data = await res.json()
              if (res.ok) {
                alert(`Imported ${data.imported} articles (skipped ${data.skipped} already in DB).`)
                onRefresh()
              } else {
                alert(`Error: ${data.error || 'Unknown'}`)
              }
            } finally {
              setShopifyImporting(false)
            }
          }}
          style={{
            background: 'transparent',
            border: '1px solid #6b7280',
            color: '#6b7280',
            padding: '6px 12px',
            borderRadius: 4,
            fontSize: 12,
            cursor: shopifyImporting ? 'default' : 'pointer',
          }}
        >
          {shopifyImporting ? 'Syncing…' : 'Import from Shopify'}
        </button>
      </div>

      <div
        style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          overflow: 'auto',
        }}
      >
        {/* Sticky batch action bar — appears whenever rows are selected */}
        {batchSelected.size > 0 && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 20,
            background: '#003366', color: 'white',
            padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {batchSelected.size} article{batchSelected.size === 1 ? '' : 's'} selected
            </span>
            <button
              onClick={sendBatchToReview}
              disabled={batching}
              style={{
                background: batching ? '#9ca3af' : 'rgb(26,122,84)',
                color: 'white', border: 'none', padding: '6px 16px',
                borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: batching ? 'default' : 'pointer',
              }}
            >
              {batching ? 'Enriching + vetting…' : 'Send to Review Queue →'}
            </button>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.2)', alignSelf: 'stretch' }} />
            <select
              value={batchStatusValue}
              onChange={(e) => setBatchStatusValue(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.12)', color: 'white', fontSize: 12, cursor: 'pointer' }}
            >
              <option value="live">live</option>
              <option value="planned">planned</option>
              <option value="in-queue">in-queue</option>
              <option value="idea">idea</option>
              <option value="draft">draft</option>
            </select>
            <button
              onClick={batchSetStatus}
              disabled={settingStatus}
              style={{ background: settingStatus ? '#9ca3af' : '#1d4ed8', color: 'white', border: 'none', padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: settingStatus ? 'default' : 'pointer' }}
            >
              {settingStatus ? 'Updating…' : 'Set status'}
            </button>
            <button
              onClick={() => setBatchSelected(new Set())}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: 'white', padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
            >
              Clear selection
            </button>
            {batchMessage && (
              <span style={{ fontSize: 12, color: '#86efac', marginLeft: 8 }}>{batchMessage}</span>
            )}
          </div>
        )}
        {batchMessage && batchSelected.size === 0 && (
          <div style={{ padding: '8px 16px', background: '#e6f4ea', color: 'rgb(26,122,84)', fontSize: 12, fontWeight: 600 }}>
            {batchMessage}
          </div>
        )}

        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead style={{ background: 'rgb(250,250,248)', textAlign: 'left' }}>
            <tr>
              <Th>
                <input
                  type="checkbox"
                  checked={batchSelected.size === filtered.length && filtered.length > 0}
                  onChange={toggleBatchAll}
                  title="Select all visible"
                />
              </Th>
              <Th>Title</Th>
              <Th>Keyword</Th>
              <Th>Hub</Th>
              <Th>Cluster</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>Light</Th>
              <Th>Priority</Th>
              <Th>KW Vol</Th>
              <Th title="Corpus audit: segment, content grade and 90-day clicks for the live article at this slug">Health</Th>
              <Th>Updated</Th>
              <Th title="Shopify Page (not a blog article — excluded from blog audit)">Page?</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} style={{ padding: 20, textAlign: 'center', color: '#6b7280' }}>
                  No articles match the filters.
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const kw = (r.keyword || '').trim().toLowerCase()
              const collision = kw && (kwCounts.get(kw) || 0) > 1
              const isPillar = r.content_type === 'pillar'
              const isLive = r.status === 'live'
              const isChecked = batchSelected.has(r.id)
              return (
                <tr
                  key={r.id}
                  style={{
                    borderTop: '1px solid #e5e7eb',
                    borderLeft: isPillar ? '3px solid #0066cc' : 'none',
                    opacity: isLive ? 0.75 : 1,
                    background: isChecked ? '#eff6ff' : undefined,
                  }}
                >
                  <Td>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleBatch(r.id)}
                    />
                  </Td>
                  <Td>
                    {collision && (
                      <span title="Duplicate keyword target" style={{ marginRight: 4 }}>
                        ⚠️
                      </span>
                    )}
                    {r.title}
                  </Td>
                  <Td>{r.keyword || '—'}</Td>
                  <Td>{r.hub || '—'}</Td>
                  <Td>{r.cluster_group || '—'}</Td>
                  <Td>{r.content_type || '—'}</Td>
                  <Td>
                    <select
                      value={r.status}
                      onChange={(e) => updateStatus(r.id, e.target.value)}
                      style={{ fontSize: 11, padding: 2, border: '1px solid #d1d5db', borderRadius: 3 }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td>
                    {trafficEmoji(r.traffic_light)} {r.traffic_light || 'unvetted'}
                    {(r.traffic_light || 'unvetted') === 'unvetted' && (
                      <button
                        disabled={vettingId === r.id}
                        onClick={async () => {
                          setVettingId(r.id)
                          try {
                            const res = await fetch('/api/content-brain/vet', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ id: r.id }),
                            })
                            const data = await res.json()
                            if (res.ok) {
                              setVetResult({
                                id: r.id,
                                traffic_light: data.traffic_light,
                                reasoning: data.reasoning,
                              })
                            } else {
                              alert(`Error: ${data.error || 'Unknown'}`)
                            }
                          } finally {
                            setVettingId(null)
                          }
                        }}
                        style={{
                          marginLeft: 6,
                          background: 'rgb(26,122,84)',
                          color: 'white',
                          border: 'none',
                          padding: '2px 8px',
                          borderRadius: 3,
                          fontSize: 10,
                          cursor: vettingId === r.id ? 'default' : 'pointer',
                        }}
                      >
                        {vettingId === r.id ? '…' : 'Vet'}
                      </button>
                    )}
                  </Td>
                  <Td>{r.priority || '—'}</Td>
                  <Td>{r.kw_volume ?? '—'}</Td>
                  <Td>
                    <HealthCell r={r} />
                  </Td>
                  <Td style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#6b7280' }}>
                    {r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                  </Td>
                  <Td>
                    <button
                      title={r.is_shopify_page ? 'Marked as Shopify Page — click to unmark' : 'Mark as Shopify Page (excluded from blog audit)'}
                      onClick={() => togglePage(r.id, !!r.is_shopify_page)}
                      style={{
                        background: r.is_shopify_page ? '#eff6ff' : 'transparent',
                        border: `1px solid ${r.is_shopify_page ? '#3b82f6' : '#d1d5db'}`,
                        color: r.is_shopify_page ? '#1d4ed8' : '#9ca3af',
                        padding: '2px 7px',
                        borderRadius: 3,
                        fontSize: 10,
                        fontWeight: r.is_shopify_page ? 700 : 400,
                        cursor: 'pointer',
                      }}
                    >
                      {r.is_shopify_page ? 'Page ✓' : 'Page'}
                    </button>
                  </Td>
                  <Td>
                    <button
                      onClick={() => setEditingIdea(r)}
                      style={{
                        background: 'transparent',
                        border: '1px solid #d1d5db',
                        padding: '2px 8px',
                        borderRadius: 3,
                        fontSize: 11,
                        cursor: 'pointer',
                        marginRight: 4,
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(r.id)}
                      style={{
                        background: 'transparent',
                        border: '1px solid #fca5a5',
                        color: '#dc2626',
                        padding: '2px 8px',
                        borderRadius: 3,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Del
                    </button>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editingIdea && (
        <EditIdeaPanel
          idea={editingIdea.id ? editingIdea : null}
          clusters={clusters}
          onClose={() => setEditingIdea(null)}
          onSaved={() => {
            setEditingIdea(null)
            onRefresh()
          }}
        />
      )}

      {deleteConfirmId !== null && (
        <ConfirmDialog
          message="Delete this article? This cannot be undone."
          onCancel={() => setDeleteConfirmId(null)}
          onConfirm={() => deleteIdea(deleteConfirmId)}
        />
      )}

      {tapImportOpen && (
        <TapImportModal
          clusters={clusters}
          onClose={() => setTapImportOpen(false)}
          onImported={() => {
            setTapImportOpen(false)
            onRefresh()
          }}
        />
      )}

      {vetResult && (
        <VetResultModal
          result={vetResult}
          onCancel={() => setVetResult(null)}
          onConfirm={async (override) => {
            const finalLight = override || vetResult.traffic_light
            await fetch('/api/content-brain/ideas', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: vetResult.id,
                traffic_light: finalLight,
                ai_reasoning: vetResult.reasoning,
              }),
            })
            setVetResult(null)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

const SEGMENT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  'A-protect': { label: 'A', color: '#15803d', bg: 'rgba(21,128,61,0.12)' },
  'B-refresh': { label: 'B', color: '#0369a1', bg: 'rgba(3,105,161,0.12)' },
  'C-full-regen': { label: 'C', color: '#b45309', bg: 'rgba(180,83,9,0.12)' },
  'D-delete-or-combine': { label: 'D', color: '#b91c1c', bg: 'rgba(185,28,28,0.12)' },
  'missing-on-shopify': { label: '?', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

/** Corpus audit summary for one brain row: the segment badge, the content
 *  grade and 90-day clicks, with the rest of the audit in the hover title.
 *  Rows with no live article (nothing planned yet) render a dash. */
function HealthCell({ r }: { r: Idea }) {
  if (!r.health_segment && r.health_grade == null) {
    return <span style={{ color: '#9ca3af' }}>—</span>
  }
  const seg = SEGMENT_STYLE[r.health_segment || ''] || SEGMENT_STYLE['missing-on-shopify']
  const grade = r.health_grade
  const gradeColor = grade == null ? '#6b7280' : grade >= 90 ? '#15803d' : grade >= 70 ? '#b45309' : '#b91c1c'
  const detail = [
    r.health_segment ? `segment ${r.health_segment}` : null,
    grade != null ? `grade ${grade}/100` : null,
    r.health_clicks != null ? `${r.health_clicks} clicks, ${r.health_impressions ?? 0} impressions (90d)` : null,
    r.health_position ? `avg position ${Number(r.health_position).toFixed(1)}` : null,
    r.health_gsc_keyword ? `top query: ${r.health_gsc_keyword}` : null,
    r.health_em_dashes ? `${r.health_em_dashes} em dashes` : null,
    r.health_ai_tells ? `${r.health_ai_tells} AI tells` : null,
    r.health_cannibal_queries ? `cannibalizing on ${r.health_cannibal_queries} queries` : null,
    r.health_cannibal_partners ? `vs ${r.health_cannibal_partners}` : null,
    r.health_index_status ? `index: ${r.health_index_status}` : null,
    r.health_content_images != null ? `${r.health_content_images} reusable images` : null,
    r.health_era ? `era: ${r.health_era}` : null,
    r.health_revamp_status ? `revamp: ${r.health_revamp_status}` : null,
  ].filter(Boolean).join('\n')
  return (
    <span title={detail} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      {r.health_segment && (
        <span style={{ color: seg.color, background: seg.bg, borderRadius: 4, padding: '1px 5px', fontSize: 11, fontWeight: 700 }}>
          {seg.label}
        </span>
      )}
      {grade != null && <span style={{ color: gradeColor, fontWeight: 600, fontSize: 12 }}>{grade}</span>}
      {r.health_clicks != null && <span style={{ color: '#6b7280', fontSize: 11 }}>{r.health_clicks}c</span>}
      {(r.health_cannibal_queries || 0) > 0 && <span title="keyword cannibalization" style={{ color: '#b91c1c', fontSize: 11 }}>!</span>}
      {r.health_revamp_status === 'revamped' && <span title="already revamped" style={{ color: '#15803d', fontSize: 11 }}>✓</span>}
    </span>
  )
}

function Th({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <th
      title={title}
      style={{
        padding: '8px 10px',
        fontSize: 11,
        fontWeight: 600,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '8px 10px', verticalAlign: 'top', ...style }}>{children}</td>
}

function Select({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: 6,
        fontSize: 12,
        border: '1px solid #d1d5db',
        borderRadius: 4,
        background: 'white',
      }}
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Export Queue sub-view
// ---------------------------------------------------------------------------

function ExportQueueView({ ideas, onRefresh }: { ideas: Idea[]; onRefresh: () => void }) {
  const eligible = useMemo(
    () =>
      ideas.filter(
        (i) =>
          i.traffic_light === 'green' && (i.status === 'planned' || i.status === 'in-queue')
      ),
    [ideas]
  )

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [exporting, setExporting] = useState(false)

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === eligible.length) setSelected(new Set())
    else setSelected(new Set(eligible.map((i) => i.id)))
  }

  const exportSelected = async () => {
    if (selected.size === 0) return
    setExporting(true)
    try {
      const res = await fetch('/api/content-brain/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      })
      if (!res.ok) {
        alert('Export failed')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      a.download = `gtd-content-queue-${ts}.csv`
      a.click()
      URL.revokeObjectURL(url)

      if (confirm("Mark exported articles as 'in-queue'?")) {
        for (const id of selected) {
          await fetch('/api/content-brain/ideas', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, status: 'in-queue' }),
          })
        }
        onRefresh()
        setSelected(new Set())
      }
    } finally {
      setExporting(false)
    }
  }

  const grouped = useMemo(() => {
    const m: Record<string, Idea[]> = {}
    for (const i of eligible) {
      const h = i.hub || 'Unknown'
      if (!m[h]) m[h] = []
      m[h].push(i)
    }
    return m
  }, [eligible])

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: '#003366' }}>
          {selected.size} of {eligible.length} articles selected
        </span>
        <button
          onClick={toggleAll}
          style={{
            background: 'transparent',
            border: '1px solid #d1d5db',
            padding: '5px 10px',
            borderRadius: 4,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {selected.size === eligible.length && eligible.length > 0 ? 'Deselect All' : 'Select All'}
        </button>
        <button
          disabled={selected.size === 0 || exporting}
          onClick={exportSelected}
          style={{
            background: selected.size === 0 ? '#9ca3af' : 'rgb(26,122,84)',
            color: 'white',
            border: 'none',
            padding: '6px 14px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: selected.size === 0 ? 'default' : 'pointer',
          }}
        >
          {exporting ? 'Exporting…' : 'Export Selected as CSV'}
        </button>
      </div>

      {eligible.length === 0 && (
        <div
          className="gtd-callout"
          style={{
            padding: 16,
            border: '1px solid #e5e7eb',
            background: 'rgb(250,250,248)',
            borderRadius: 8,
            fontSize: 13,
            color: '#6b7280',
          }}
        >
          No articles are ready to export. Articles must be{' '}
          <strong>traffic_light = green</strong> AND status <strong>planned</strong> or{' '}
          <strong>in-queue</strong>.
        </div>
      )}

      {Object.entries(grouped).map(([hub, rows]) => (
        <div key={hub} style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#003366', margin: '0 0 6px' }}>
            {hub}
          </h3>
          <div
            style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {rows.map((r) => (
              <label
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderTop: '1px solid #f3f4f6',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggleOne(r.id)}
                />
                <span style={{ flex: 1 }}>{r.title}</span>
                <span className="gtd-muted" style={{ fontSize: 11 }}>
                  {r.cluster_group} · {r.article_type || '—'}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit Idea side panel (shared by Cluster Map and All Articles)
// ---------------------------------------------------------------------------

function EditIdeaPanel({
  idea,
  defaults,
  clusters,
  onClose,
  onSaved,
}: {
  idea: Idea | null
  defaults?: Partial<Idea>
  clusters: Cluster[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Partial<Idea>>(
    idea || {
      title: '',
      keyword: '',
      hub: defaults?.hub || '',
      cluster_group: defaults?.cluster_group || '',
      collection: defaults?.collection || defaults?.cluster_group || '',
      collection_slug: defaults?.collection_slug || '',
      content_type: 'cluster',
      article_type: 'listicle',
      audience: 'general',
      tone: 'educational',
      word_count: 2500,
      status: 'idea',
      traffic_light: 'unvetted',
      priority: 'P2',
    }
  )
  const [saving, setSaving] = useState(false)

  const setField = <K extends keyof Idea>(key: K, val: Idea[K]) => {
    setForm((f) => ({ ...f, [key]: val }))
  }

  const hubClusters = clusters.filter((c) => c.hub === form.hub)

  const save = async () => {
    if (!form.title || !String(form.title).trim()) {
      alert('Title is required')
      return
    }
    setSaving(true)
    try {
      if (idea && idea.id) {
        await fetch('/api/content-brain/ideas', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: idea.id, ...form }),
        })
      } else {
        await fetch('/api/content-brain/ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          width: '100%',
          maxWidth: 520,
          padding: 20,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16, color: '#003366' }}>
            {idea && idea.id ? 'Edit Article' : 'New Article'}
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <Field label="Title">
          <input
            value={String(form.title || '')}
            onChange={(e) => setField('title', e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Keyword">
          <input
            value={String(form.keyword || '')}
            onChange={(e) => setField('keyword', e.target.value)}
            style={inputStyle}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Hub">
            <select
              value={String(form.hub || '')}
              onChange={(e) => setField('hub', e.target.value)}
              style={inputStyle}
            >
              <option value="">—</option>
              {HUBS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cluster">
            <select
              value={String(form.cluster_group || '')}
              onChange={(e) => {
                const name = e.target.value
                setField('cluster_group', name)
                const c = hubClusters.find((x) => x.name === name)
                if (c) {
                  setField('collection', c.name)
                  setField('collection_slug', c.slug)
                }
              }}
              style={inputStyle}
            >
              <option value="">—</option>
              {hubClusters.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Content Type">
            <select
              value={String(form.content_type || 'cluster')}
              onChange={(e) => setField('content_type', e.target.value)}
              style={inputStyle}
            >
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Article Type">
            <select
              value={String(form.article_type || '')}
              onChange={(e) => setField('article_type', e.target.value)}
              style={inputStyle}
            >
              <option value="">—</option>
              {ARTICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Audience">
            <select
              value={String(form.audience || '')}
              onChange={(e) => setField('audience', e.target.value)}
              style={inputStyle}
            >
              <option value="">—</option>
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tone">
            <select
              value={String(form.tone || '')}
              onChange={(e) => setField('tone', e.target.value)}
              style={inputStyle}
            >
              <option value="">—</option>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Field label="Word Count">
            <input
              type="number"
              value={Number(form.word_count || 2500)}
              onChange={(e) => setField('word_count', Number(e.target.value))}
              style={inputStyle}
            />
          </Field>
          <Field label="Status">
            <select
              value={String(form.status || 'idea')}
              onChange={(e) => setField('status', e.target.value)}
              style={inputStyle}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Light">
            <select
              value={String(form.traffic_light || 'unvetted')}
              onChange={(e) => setField('traffic_light', e.target.value)}
              style={inputStyle}
            >
              {TRAFFIC_LIGHTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Priority">
          <select
            value={String(form.priority || '')}
            onChange={(e) => setField('priority', e.target.value)}
            style={inputStyle}
          >
            <option value="">—</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>
        </Field>

        <Field label="Special Instructions">
          <textarea
            value={String(form.special_instructions || '')}
            onChange={(e) => setField('special_instructions', e.target.value)}
            rows={3}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>

        <Field label="Notes">
          <textarea
            value={String(form.notes || '')}
            onChange={(e) => setField('notes', e.target.value)}
            rows={2}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{
              background: 'rgb(26,122,84)',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
              flex: 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid #d1d5db',
              padding: '8px 16px',
              borderRadius: 4,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: 8,
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  width: '100%',
  background: 'white',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

// ---------------------------------------------------------------------------
// TAP Import Modal
// ---------------------------------------------------------------------------

interface NormalizedTapRow {
  title: string
  keyword: string | null
  hub: string | null
  cluster_group: string | null
  collection: string | null
  collection_slug: string | null
  content_type: string
  article_type: string | null
  audience: string | null
  tone: string | null
  word_count: number
  priority: string | null
  kw_volume: number | null
  kw_difficulty: number | null
  traffic_potential: number | null
  url_slug: string | null
  notes: string | null
  status: string
  source: string
  special_instructions: string | null
}

function TapImportModal({
  clusters,
  onClose,
  onImported,
}: {
  clusters: Cluster[]
  onClose: () => void
  onImported: () => void
}) {
  const [csv, setCsv] = useState('')
  const [format, setFormat] = useState<'v18' | 'cardio'>('cardio')
  const [hub, setHub] = useState<string>('')
  const [clusterGroup, setClusterGroup] = useState<string>('')
  const [preview, setPreview] = useState<NormalizedTapRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  const hubClusters = clusters.filter((c) => c.hub === hub)
  const chosen = hubClusters.find((c) => c.name === clusterGroup)

  const runPreview = async () => {
    if (!csv.trim()) {
      alert('Paste some CSV rows first.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/content-brain/tap-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv,
          format,
          preview: true,
          hub,
          cluster_group: clusterGroup,
          collection: clusterGroup,
          collection_slug: chosen?.slug,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setPreview(data.rows || [])
      } else {
        alert(`Error: ${data.error || 'Unknown'}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!preview || preview.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/content-brain/tap-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit: true, rows: preview }),
      })
      const data = await res.json()
      if (res.ok) {
        alert(`Imported ${data.imported} articles.`)
        onImported()
      } else {
        alert(`Error: ${data.error || 'Unknown'}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 8,
          padding: 20,
          width: '100%',
          maxWidth: 900,
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16, color: '#003366' }}>Import TAP Rows</h2>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Field label="Format">
            <select value={format} onChange={(e) => setFormat(e.target.value as 'v18' | 'cardio')} style={inputStyle}>
              <option value="cardio">Cardio format</option>
              <option value="v18">v18 format</option>
            </select>
          </Field>
          <Field label="Hub">
            <select value={hub} onChange={(e) => setHub(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {HUBS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cluster / Sub-cluster">
            <select value={clusterGroup} onChange={(e) => setClusterGroup(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {hubClusters.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="CSV (paste rows including header)">
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={8}
            placeholder={
              format === 'cardio'
                ? 'Type,Article Type,Title,Primary Keyword,Intent,Word Count,Priority,Action,Existing URL,Notes,KW Volume,KD,Traffic Potential,Title Tag,Meta Description,URL Slug'
                : 'Type,Title,Primary Keyword,Intent,Format,Word Count,Priority,KW Search Volume,Title Tag,Meta Description,URL'
            }
            style={{
              ...inputStyle,
              fontFamily: 'monospace',
              fontSize: 11,
              resize: 'vertical',
            }}
          />
        </Field>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={runPreview}
            disabled={busy || !csv.trim() || !hub || !clusterGroup}
            style={{
              background: busy || !hub || !clusterGroup ? '#9ca3af' : '#0066cc',
              color: 'white',
              border: 'none',
              padding: '8px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Preview
          </button>
          {preview && preview.length > 0 && (
            <button
              onClick={commit}
              disabled={busy}
              style={{
                background: busy ? '#9ca3af' : 'rgb(26,122,84)',
                color: 'white',
                border: 'none',
                padding: '8px 14px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              Import {preview.length} Article{preview.length === 1 ? '' : 's'}
            </button>
          )}
        </div>

        {preview && preview.length > 0 && (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead style={{ background: 'rgb(250,250,248)' }}>
                <tr>
                  <Th>Title</Th>
                  <Th>Keyword</Th>
                  <Th>Type</Th>
                  <Th>Article</Th>
                  <Th>Audience</Th>
                  <Th>Priority</Th>
                  <Th>Vol</Th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <Td>{r.title}</Td>
                    <Td>{r.keyword || '—'}</Td>
                    <Td>{r.content_type}</Td>
                    <Td>{r.article_type || '—'}</Td>
                    <Td>{r.audience || '—'}</Td>
                    <Td>{r.priority || '—'}</Td>
                    <Td>{r.kw_volume ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {preview && preview.length === 0 && (
          <div className="gtd-muted" style={{ fontSize: 12 }}>
            No rows parsed. Double-check your format selection and CSV header.
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI Vet Result Modal
// ---------------------------------------------------------------------------

function VetResultModal({
  result,
  onCancel,
  onConfirm,
}: {
  result: { id: number; traffic_light: string; reasoning: string }
  onCancel: () => void
  onConfirm: (override?: string) => void
}) {
  const [override, setOverride] = useState<string>(result.traffic_light)

  const emoji = (t: string) => (t === 'green' ? '🟢' : t === 'yellow' ? '🟡' : t === 'red' ? '🔴' : '⬜')

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 8,
          padding: 20,
          maxWidth: 500,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, color: '#003366' }}>AI Vetting Result</h2>
        <div style={{ fontSize: 13 }}>
          <strong>Recommendation:</strong> {emoji(result.traffic_light)} {result.traffic_light}
        </div>
        <div
          style={{
            background: 'rgb(250,250,248)',
            border: '1px solid #e5e7eb',
            padding: 12,
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {result.reasoning}
        </div>
        <Field label="Override (optional)">
          <select value={override} onChange={(e) => setOverride(e.target.value)} style={inputStyle}>
            {TRAFFIC_LIGHTS.map((t) => (
              <option key={t} value={t}>
                {emoji(t)} {t}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid #d1d5db',
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(override)}
            style={{
              background: 'rgb(26,122,84)',
              color: 'white',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDialog({
  message,
  onCancel,
  onConfirm,
}: {
  message: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          padding: 20,
          borderRadius: 8,
          maxWidth: 400,
          width: '90%',
        }}
      >
        <p style={{ margin: '0 0 16px', fontSize: 14 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid #d1d5db',
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: '#dc2626',
              color: 'white',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
