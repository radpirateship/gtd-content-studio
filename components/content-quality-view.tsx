'use client'

import { useState } from 'react'
import { Loader2, Search, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { COLLECTION_NAMES } from '@/lib/collections'

interface Graded {
  id: number
  title: string
  handle: string
  url: string
  tags?: string
  severity: number
  brand: {
    passed: boolean
    emDashCount: number
    bannedPhrases: string[]
    namingViolations: string[]
  }
  missing: {
    featuredImage: boolean
    contentImages: boolean
    internalLinks: boolean
    products: boolean
    faq: boolean
    meta: boolean
  }
  missingCount: number
}

interface GroupSummary {
  total: number
  flagged: number
  withEmDashes: number
  withBannedPhrases: number
  withNamingViolations: number
  missingImage: number
  missingProducts: number
  missingInternalLinks: number
  missingFaq: number
}

const MISSING_LABELS: Record<keyof Graded['missing'], string> = {
  featuredImage: 'Featured image',
  contentImages: 'In-body images',
  internalLinks: 'Internal links',
  products: 'Featured products',
  faq: 'FAQ',
  meta: 'Meta description',
}

function extractHandle(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    const parts = url.pathname.split('/').filter(Boolean)
    const blogsIndex = parts.findIndex((p) => p === 'blogs')
    if (blogsIndex >= 0 && parts[blogsIndex + 2]) return parts[blogsIndex + 2]
  } catch {
    /* not a URL */
  }
  return trimmed.split('?')[0].split('#')[0].split('/').filter(Boolean).pop()?.trim() || ''
}

function severityColor(sev: number): string {
  if (sev === 0) return '#15803d'
  if (sev <= 3) return '#d69e2e'
  return '#b91c1c'
}

function GradeCard({ g }: { g: Graded }) {
  const missingList = (Object.keys(g.missing) as (keyof Graded['missing'])[]).filter((k) => g.missing[k])
  const clean = g.severity === 0
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text1)' }}>{g.title}</div>
        <span
          style={{
            flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
            color: 'white', background: severityColor(g.severity),
          }}
        >
          {clean ? 'CLEAN' : `severity ${g.severity}`}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, fontSize: 12 }}>
        <span style={{ color: g.brand.emDashCount > 0 ? '#b91c1c' : 'var(--text3)', fontWeight: g.brand.emDashCount > 0 ? 700 : 400 }}>
          {g.brand.emDashCount} em-dash{g.brand.emDashCount === 1 ? '' : 'es'}
        </span>
        {g.brand.bannedPhrases.length > 0 && (
          <span style={{ color: '#b91c1c' }}>banned: {g.brand.bannedPhrases.join(', ')}</span>
        )}
        {g.brand.namingViolations.length > 0 && (
          <span style={{ color: '#b91c1c' }}>{g.brand.namingViolations.join('; ')}</span>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 12 }}>
        {missingList.length === 0 ? (
          <span style={{ color: '#15803d', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle2 size={14} /> all sections present
          </span>
        ) : (
          <span style={{ color: 'var(--text2)' }}>
            missing:{' '}
            {missingList.map((k) => (
              <span key={k} style={{ display: 'inline-block', background: '#fef2f2', color: '#b91c1c', borderRadius: 4, padding: '1px 6px', margin: '0 4px 4px 0', fontSize: 11 }}>
                {MISSING_LABELS[k]}
              </span>
            ))}
          </span>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <a href={g.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#0066cc', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Open article <ExternalLink size={12} />
        </a>
      </div>
    </div>
  )
}

export function ContentQualityView() {
  const [mode, setMode] = useState<'article' | 'collection'>('article')
  const [articleInput, setArticleInput] = useState('')
  const [collection, setCollection] = useState(COLLECTION_NAMES[0] || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [single, setSingle] = useState<Graded | null>(null)
  const [group, setGroup] = useState<{ summary: GroupSummary; articles: Graded[] } | null>(null)

  const run = async () => {
    setLoading(true); setError(null); setSingle(null); setGroup(null)
    try {
      const url =
        mode === 'article'
          ? `/api/articles/grade?handle=${encodeURIComponent(extractHandle(articleInput))}`
          : `/api/articles/grade?collection=${encodeURIComponent(collection)}`
      const res = await apiFetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Grade failed')
      if (data.mode === 'article') setSingle(data.article)
      else setGroup({ summary: data.summary, articles: data.articles })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Grade failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '8px 4px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text1)', marginBottom: 4 }}>Content Quality</h1>
      <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>
        Grade an article or a collection against the brand rules (em-dashes, banned phrases, naming) and completeness (images, products, links, FAQ). To audit collection <em>pages</em> across the whole catalog, use the Audit Queue under Collections.
      </p>

      {/* Scope picker */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['article', 'collection'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--border)',
              background: mode === m ? 'rgb(26,122,84)' : 'var(--bg)',
              color: mode === m ? 'white' : 'var(--text2)',
            }}
          >
            {m === 'article' ? 'Single article' : 'Collection / brand group'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {mode === 'article' ? (
          <input
            type="text"
            value={articleInput}
            onChange={(e) => setArticleInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="Paste article URL or handle (e.g. best-infrared-saunas)"
            style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text1)', fontSize: 13 }}
          />
        ) : (
          <select
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text1)', fontSize: 13 }}
          >
            {COLLECTION_NAMES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <button
          onClick={run}
          disabled={loading || (mode === 'article' && !articleInput.trim())}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6,
            border: 'none', background: 'rgb(26,122,84)', color: 'white', fontSize: 13, fontWeight: 600,
            cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          {loading ? 'Grading…' : 'Grade'}
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {single && <GradeCard g={single} />}

      {group && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
            <span><strong>{group.summary.total}</strong> articles</span>
            <span style={{ color: group.summary.flagged > 0 ? '#b91c1c' : '#15803d' }}><strong>{group.summary.flagged}</strong> flagged</span>
            <span>{group.summary.withEmDashes} em-dashes</span>
            <span>{group.summary.withBannedPhrases} banned phrases</span>
            <span>{group.summary.missingProducts} missing products</span>
            <span>{group.summary.missingImage} missing image</span>
            <span>{group.summary.missingInternalLinks} missing links</span>
          </div>
          {group.articles.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>No articles found for this collection tag.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {group.articles.map((g) => <GradeCard key={g.id} g={g} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
