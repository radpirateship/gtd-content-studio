// components/CollectionsTab.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'

interface Collection {
  id: number
  slug: string
  url: string
  category: string
  collection_type: string
  primary_keyword: string
  secondary_keywords: string[]
  title_tag: string
  meta_description: string
  priority: string
  score: number | null
  audit_fail_count: number | null
  audit_warn_count: number | null
  search_volume: number
  kd: number
  tier: string
  is_optimized: boolean
  notes: string
  updated_at: string
  ultimate_guide_title: string
  ultimate_guide_url: string
}

interface EditingCell {
  slug: string
  field: 'title_tag' | 'meta_description' | 'primary_keyword' | 'notes' | 'ultimate_guide_title' | 'ultimate_guide_url'
}

export default function CollectionsTab() {
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterOptimized, setFilterOptimized] = useState('')
  const [editing, setEditing] = useState<EditingCell | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [categories, setCategories] = useState<string[]>([])

  const fetchCollections = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (filterCategory) params.set('category', filterCategory)
    if (filterType) params.set('type', filterType)
    if (filterOptimized) params.set('optimized', filterOptimized)
    const res = await fetch(`/api/collections?${params}`)
    const data = await res.json()
    setCollections(data.collections || [])
    if (!filterCategory && !search && !filterType) {
      const cats = [...new Set((data.collections || []).map((c: Collection) => c.category).filter(Boolean))] as string[]
      setCategories(cats.sort())
    }
    setLoading(false)
  }, [search, filterCategory, filterType, filterOptimized])

  useEffect(() => { fetchCollections() }, [fetchCollections])

  const startEdit = (slug: string, field: EditingCell['field'], current: string) => {
    setEditing({ slug, field })
    setEditValue(current || '')
  }

  const saveEdit = async () => {
    if (!editing) return
    setSaving(true)
    const res = await fetch(`/api/collections/${editing.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [editing.field]: editValue }),
    })
    if (res.ok) {
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(''), 2000)
      setCollections(prev => prev.map(c =>
        c.slug === editing.slug ? { ...c, [editing.field]: editValue } : c
      ))
      setEditing(null)
    } else {
      const data = await res.json().catch(() => ({}))
      setSaveMsg(`Save failed: ${data.error || res.status}`)
      setTimeout(() => setSaveMsg(''), 6000)
      // keep the editor open so the typed value is not lost
    }
    setSaving(false)
  }

  const toggleOptimized = async (slug: string, current: boolean) => {
    await fetch(`/api/collections/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_optimized: !current }),
    })
    setCollections(prev => prev.map(c =>
      c.slug === slug ? { ...c, is_optimized: !current } : c
    ))
  }

  const scoreColor = (s: number | null) => {
    if (s == null) return '#888'
    if (s >= 85) return '#38a169'
    if (s >= 65) return '#dd6b20'
    return '#e53e3e'
  }

  const optimizedCount = collections.filter(c => c.is_optimized).length

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, color: '#003366' }}>Collections Database</h2>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 13 }}>
            {collections.length} collections shown, {optimizedCount} optimized
          </p>
        </div>
        {saveMsg && (
          <span style={{
            background: saveMsg.startsWith('Save failed') ? '#fed7d7' : '#c6f6d5',
            color: saveMsg.startsWith('Save failed') ? '#9b2c2c' : '#276749',
            padding: '6px 14px', borderRadius: 6, fontSize: 13,
          }}>
            {saveMsg}
          </span>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          placeholder="Search slug, keyword, title..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, width: 260 }}
        />
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}>
          <option value="">All Types</option>
          <option value="standard">Standard</option>
          <option value="brand">Brand</option>
        </select>
        <select value={filterOptimized} onChange={e => setFilterOptimized(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}>
          <option value="">All Status</option>
          <option value="false">Not Optimized</option>
          <option value="true">Optimized</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>Loading collections...</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#003366', color: '#fff' }}>
                {['Slug', 'Category', 'Primary Keyword', 'Title Tag', 'Meta Description', 'Ultimate Guide Title', 'Ultimate Guide URL', 'Score', 'SV', 'KD', 'Optimized?'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {collections.map((c, idx) => (
                <tr key={c.slug} style={{ background: idx % 2 === 0 ? '#fff' : '#f7f9fc', borderBottom: '1px solid #e8ecf0' }}>
                  {/* Slug */}
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: '#0066cc' }}>
                    <a href={c.url} target="_blank" rel="noreferrer" style={{ color: '#0066cc', textDecoration: 'none' }}>
                      {c.slug}
                    </a>
                  </td>
                  {/* Category */}
                  <td style={{ padding: '8px 12px', color: '#555', whiteSpace: 'nowrap' }}>{c.category}</td>
                  {/* Primary Keyword - editable */}
                  <EditableCell
                    value={c.primary_keyword}
                    isEditing={editing?.slug === c.slug && editing?.field === 'primary_keyword'}
                    editValue={editing?.slug === c.slug && editing?.field === 'primary_keyword' ? editValue : ''}
                    onEdit={() => startEdit(c.slug, 'primary_keyword', c.primary_keyword)}
                    onSave={saveEdit}
                    onCancel={() => setEditing(null)}
                    onChange={setEditValue}
                    saving={saving}
                    multiline={false}
                    width={160}
                  />
                  {/* Title Tag - editable */}
                  <EditableCell
                    value={c.title_tag}
                    isEditing={editing?.slug === c.slug && editing?.field === 'title_tag'}
                    editValue={editing?.slug === c.slug && editing?.field === 'title_tag' ? editValue : ''}
                    onEdit={() => startEdit(c.slug, 'title_tag', c.title_tag)}
                    onSave={saveEdit}
                    onCancel={() => setEditing(null)}
                    onChange={setEditValue}
                    saving={saving}
                    multiline={false}
                    width={260}
                    charLimit={70}
                  />
                  {/* Meta Description - editable */}
                  <EditableCell
                    value={c.meta_description}
                    isEditing={editing?.slug === c.slug && editing?.field === 'meta_description'}
                    editValue={editing?.slug === c.slug && editing?.field === 'meta_description' ? editValue : ''}
                    onEdit={() => startEdit(c.slug, 'meta_description', c.meta_description)}
                    onSave={saveEdit}
                    onCancel={() => setEditing(null)}
                    onChange={setEditValue}
                    saving={saving}
                    multiline={true}
                    width={340}
                    charLimit={160}
                  />
                  {/* Ultimate Guide Title - editable */}
                  <EditableCell
                    value={c.ultimate_guide_title}
                    isEditing={editing?.slug === c.slug && editing?.field === 'ultimate_guide_title'}
                    editValue={editing?.slug === c.slug && editing?.field === 'ultimate_guide_title' ? editValue : ''}
                    onEdit={() => startEdit(c.slug, 'ultimate_guide_title', c.ultimate_guide_title)}
                    onSave={saveEdit}
                    onCancel={() => setEditing(null)}
                    onChange={setEditValue}
                    saving={saving}
                    multiline={false}
                    width={240}
                  />
                  {/* Ultimate Guide URL - editable */}
                  <EditableCell
                    value={c.ultimate_guide_url}
                    isEditing={editing?.slug === c.slug && editing?.field === 'ultimate_guide_url'}
                    editValue={editing?.slug === c.slug && editing?.field === 'ultimate_guide_url' ? editValue : ''}
                    onEdit={() => startEdit(c.slug, 'ultimate_guide_url', c.ultimate_guide_url)}
                    onSave={saveEdit}
                    onCancel={() => setEditing(null)}
                    onChange={setEditValue}
                    saving={saving}
                    multiline={false}
                    width={260}
                  />
                  {/* Score (from the optimization audit) */}
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                    <span
                      title={c.score == null ? 'Not audited yet - run the audit from the Audit Queue' : `${c.audit_fail_count ?? 0} fail, ${c.audit_warn_count ?? 0} warn`}
                      style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: scoreColor(c.score), padding: '2px 9px', borderRadius: 10 }}
                    >
                      {c.score == null ? '-' : c.score}
                    </span>
                  </td>
                  {/* SV */}
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: '#555' }}>
                    {c.search_volume ? c.search_volume.toLocaleString() : '-'}
                  </td>
                  {/* KD */}
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: '#555' }}>{c.kd ?? '-'}</td>
                  {/* Optimized */}
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <button
                      onClick={() => toggleOptimized(c.slug, c.is_optimized)}
                      style={{
                        background: c.is_optimized ? '#c6f6d5' : '#fff5f5',
                        color: c.is_optimized ? '#276749' : '#c53030',
                        border: `1px solid ${c.is_optimized ? '#9ae6b4' : '#fed7d7'}`,
                        borderRadius: 12, padding: '3px 10px', fontSize: 12,
                        cursor: 'pointer', fontWeight: 600
                      }}
                    >
                      {c.is_optimized ? 'Done' : 'No'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {collections.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>No collections match your filters.</div>
          )}
        </div>
      )}
    </div>
  )
}

function EditableCell({
  value, isEditing, editValue, onEdit, onSave, onCancel, onChange,
  saving, multiline, width, charLimit
}: {
  value: string; isEditing: boolean; editValue: string
  onEdit: () => void; onSave: () => void; onCancel: () => void
  onChange: (v: string) => void; saving: boolean
  multiline: boolean; width: number; charLimit?: number
}) {
  const len = editValue?.length || 0
  const over = charLimit && len > charLimit

  if (isEditing) {
    return (
      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
        {multiline ? (
          <textarea
            autoFocus
            value={editValue}
            onChange={e => onChange(e.target.value)}
            style={{ width, minHeight: 70, padding: '6px 8px', border: `1px solid ${over ? '#e53e3e' : '#0066cc'}`, borderRadius: 4, fontSize: 12, resize: 'vertical' }}
          />
        ) : (
          <input
            autoFocus
            value={editValue}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel() }}
            style={{ width, padding: '6px 8px', border: `1px solid ${over ? '#e53e3e' : '#0066cc'}`, borderRadius: 4, fontSize: 12 }}
          />
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
          <button onClick={onSave} disabled={saving || !!over}
            style={{ background: '#0066cc', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? '...' : 'Save'}
          </button>
          <button onClick={onCancel}
            style={{ background: '#f0f0f0', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
            Cancel
          </button>
          {charLimit && (
            <span style={{ fontSize: 10, color: over ? '#e53e3e' : '#999' }}>
              {len}/{charLimit}
            </span>
          )}
        </div>
      </td>
    )
  }

  return (
    <td
      onClick={onEdit}
      title="Click to edit"
      style={{ padding: '8px 12px', maxWidth: width, cursor: 'pointer', color: '#333' }}
    >
      <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 12 }}>
        {value || <span style={{ color: '#bbb', fontStyle: 'italic' }}>click to add</span>}
      </span>
    </td>
  )
}
