'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Download, Loader2, RefreshCw, Search, Upload, Image as ImageIcon, Link2, ShoppingBag, HelpCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { apiFetch } from '@/lib/api-client'
import type { RevampBacklogItem, RevampBacklogPriority, RevampBacklogSource, RevampBacklogStatus } from '@/lib/types'

interface RevampBacklogViewProps {
  onOpenRevamp: (source: RevampBacklogSource) => void
  onEditArticle?: (handle: string) => void
}

const STATUS_OPTIONS: RevampBacklogStatus[] = ['new', 'triaged', 'ready', 'in-progress', 'revamped', 'published', 'skipped']
const PRIORITY_OPTIONS: RevampBacklogPriority[] = ['low', 'normal', 'high']
const SORT_OPTIONS = [
  { value: 'clicks', label: 'Clicks' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'ctr', label: 'CTR' },
  { value: 'position', label: 'Position' },
  { value: 'updated', label: 'Updated' },
  { value: 'grade', label: 'Grade (worst first)' },
]

const GRADE_ISSUE_OPTIONS = [
  { value: 'all', label: 'All grades' },
  { value: 'low-score', label: 'Score below 70' },
  { value: 'no-collection-links', label: '0 collection links' },
  { value: 'collection-links', label: 'Needs collection links' },
  { value: 'em-dashes', label: 'Has em dashes' },
  { value: 'brand-voice', label: 'Off brand voice' },
  { value: 'faq-clean', label: 'FAQ swallowed table' },
  { value: 'faq-position', label: 'FAQ misplaced' },
  { value: 'faq-structure', label: 'FAQ malformed' },
  { value: 'tag-balance', label: 'Broken HTML tags' },
  { value: 'structure-order', label: 'Sections out of order' },
  { value: 'anchors', label: 'Legacy anchors' },
]

function formatSlugTitle(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Compact relative-time formatter for the table. Returns "—" for null,
// "Xd"/"Xmo"/"Xy" for past times, with hours/minutes for <1 day old.
function formatRelative(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return '—'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.floor(days / 365)
  return `${years}y`
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function titleCase(value?: string | null) {
  if (!value) return '—'
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

// CTR color thresholds: green ≥5%, amber 2–5%, red <2%.
function ctrStyle(ctr: number): { color: string; fontWeight: number } {
  if (ctr >= 5) return { color: '#16a34a', fontWeight: 600 }
  if (ctr >= 2) return { color: '#d97706', fontWeight: 500 }
  return { color: '#dc2626', fontWeight: 500 }
}

// Position color thresholds: green ≤3, teal 4–10, amber 11–20, red 21+.
function positionStyle(pos: number): { color: string; fontWeight: number } {
  if (pos <= 3) return { color: '#16a34a', fontWeight: 600 }
  if (pos <= 10) return { color: '#0891b2', fontWeight: 500 }
  if (pos <= 20) return { color: '#d97706', fontWeight: 500 }
  return { color: '#dc2626', fontWeight: 500 }
}

const STATUS_PILL_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  new:           { bg: '#e0e7ff', color: '#3730a3', label: 'New' },
  triaged:       { bg: '#fef3c7', color: '#92400e', label: 'Triaged' },
  ready:         { bg: '#cffafe', color: '#155e75', label: 'Ready' },
  'in-progress': { bg: '#dbeafe', color: '#1e40af', label: 'Progress' },
  revamped:      { bg: '#d1fae5', color: '#065f46', label: 'Revamped' },
  published:     { bg: '#dcfce7', color: '#14532d', label: 'Live' },
  skipped:       { bg: '#f1f5f9', color: '#475569', label: 'Skipped' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_PILL_STYLES[status] || STATUS_PILL_STYLES.new
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  )
}

// Priority-dot color: low = light gray, normal = gray, high = amber, urgent = red.
const PRIORITY_DOT_COLORS: Record<string, string> = {
  low:    '#cbd5e1',
  normal: '#94a3b8',
  high:   '#f59e0b',
  urgent: '#dc2626',
}

function PriorityDot({ priority }: { priority: string }) {
  const color = PRIORITY_DOT_COLORS[priority] || PRIORITY_DOT_COLORS.normal
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
}

// Coverage: four boolean flags from Shopify sync indicating which content types
// the post already has. Shown as small icon chips — solid when present, faded
// when absent — so missing pieces pop out at a glance.
const SEGMENT_META: Record<string, { label: string; color: string; bg: string }> = {
  'A-protect': { label: 'A', color: '#15803d', bg: 'rgba(21,128,61,0.12)' },
  'B-refresh': { label: 'B', color: '#0369a1', bg: 'rgba(3,105,161,0.12)' },
  'C-full-regen': { label: 'C', color: '#b45309', bg: 'rgba(180,83,9,0.12)' },
  'D-delete-or-combine': { label: 'D', color: '#b91c1c', bg: 'rgba(185,28,28,0.12)' },
  'missing-on-shopify': { label: '?', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

function SegmentBadge({ item }: { item: RevampBacklogItem }) {
  if (!item.segment) return <span style={{ color: 'var(--text4)' }}>-</span>
  const meta = SEGMENT_META[item.segment] || SEGMENT_META['missing-on-shopify']
  const details = [
    item.era ? `era: ${item.era}` : null,
    item.emDashes ? `${item.emDashes} em dashes` : null,
    item.cannibalQueries ? `${item.cannibalQueries} cannibalized queries (${(item.cannibalImpAtStake || 0).toLocaleString()} imp at stake)` : null,
    item.cannibalPartners ? `vs ${item.cannibalPartners}` : null,
    item.indexStatus ? `index: ${item.indexStatus}` : null,
    item.imagesKeepable ? 'images keepable' : 'images need regen',
    item.clusterId ? `topic cluster ${item.clusterId}` : null,
  ].filter(Boolean)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
          style={{ color: meta.color, background: meta.bg }}
        >
          {meta.label}
          {(item.cannibalQueries || 0) > 0 && <span title="cannibalization" style={{ fontWeight: 400 }}>!</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        <div className="font-medium">{item.segment}</div>
        {details.map((d, i) => <div key={i} className="text-[11px] opacity-90">{d}</div>)}
      </TooltipContent>
    </Tooltip>
  )
}

function CoverageChips({ item }: { item: RevampBacklogItem }) {
  const chips: Array<{ icon: typeof ImageIcon; label: string; has: boolean }> = [
    { icon: ImageIcon,    label: 'Content images', has: item.hasContentImages },
    { icon: Link2,        label: 'Internal links', has: item.hasInternalLinks },
    { icon: ShoppingBag,  label: 'Product embeds', has: item.hasProducts },
    { icon: HelpCircle,   label: 'FAQ section',    has: item.hasFaq },
  ]
  return (
    <div className="flex items-center gap-1">
      {chips.map(({ icon: Icon, label, has }) => (
        <Tooltip key={label}>
          <TooltipTrigger asChild>
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded"
              style={{
                color: has ? 'var(--text1)' : 'var(--text4)',
                opacity: has ? 1 : 0.35,
              }}
            >
              <Icon className="h-3 w-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{has ? label : `Missing: ${label.toLowerCase()}`}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

export function RevampBacklogView({ onOpenRevamp, onEditArticle }: RevampBacklogViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [items, setItems] = useState<RevampBacklogItem[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Debounced mirror of `search`. Used in the SWR cache key so we only refetch
  // when the user pauses typing — not on every keystroke. The input itself
  // stays bound to `search` for instant feedback in the field.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [reasonFilter, setReasonFilter] = useState<string>('all')
  const [sort, setSort] = useState('clicks')
  const [gradeIssueFilter, setGradeIssueFilter] = useState('all')
  const [segmentFilter, setSegmentFilter] = useState<string>('all')
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set())
  const [bulkPriority, setBulkPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [bulkMode, setBulkMode] = useState<'keep-images' | 'full-regen' | 'combine' | 'delete'>('keep-images')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [batchSize, setBatchSize] = useState(30)
  const [runState, setRunState] = useState<{
    running: boolean
    done: { slug: string; grade?: number; failures?: string[]; images?: string; error?: string; secs?: number }[]
    current: string | null
    total: number
  }>({ running: false, done: [], current: null, total: 0 })
  const stopRunRef = useRef(false)
  const [excludeCompleted, setExcludeCompleted] = useState(true)
  const [denseMode, setDenseMode] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isImportingShopify, setIsImportingShopify] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [syncingSlug, setSyncingSlug] = useState<string | null>(null)
  const [isSyncingGsc, setIsSyncingGsc] = useState(false)
  const [editor, setEditor] = useState({
    status: 'new' as RevampBacklogStatus,
    priority: 'normal' as RevampBacklogPriority,
    revampReason: '',
    notes: '',
  })

  // Debounce the raw search input by 300ms before it becomes part of the
  // SWR cache key. Typing "protein" used to fire 7 backlog requests; now it
  // fires one ~300ms after the user stops typing.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Build the cache key from filter state. SWR keeps each unique combination
  // in its in-memory cache, so toggling between filters you've used before is
  // instant on second visit.
  const swrKey = useMemo(() => {
    const params = new URLSearchParams({ sort, limit: '1000', offset: '0' })
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (categoryFilter !== 'all') params.set('category', categoryFilter)
    if (priorityFilter !== 'all') params.set('priority', priorityFilter)
    if (reasonFilter !== 'all') params.set('revampReason', reasonFilter)
    if (excludeCompleted) params.set('excludeCompleted', 'true')
    if (gradeIssueFilter !== 'all') params.set('gradeIssue', gradeIssueFilter)
    if (segmentFilter !== 'all') params.set('segment', segmentFilter)
    return `/api/revamp/backlog?${params.toString()}`
  }, [sort, debouncedSearch, statusFilter, categoryFilter, priorityFilter, reasonFilter, excludeCompleted, gradeIssueFilter, segmentFilter])

  // Any filter change invalidates the selection: the listed rows are no longer
  // the rows that were ticked.
  useEffect(() => {
    setSelectedSlugs(new Set())
  }, [swrKey])

  const {
    data: backlogData,
    error: backlogError,
    isLoading,
    mutate: refreshBacklog,
  } = useSWR<{ items: RevampBacklogItem[]; count: number }>(
    swrKey,
    (url: string) => apiFetch(url).then((r) => r.json())
  )

  // Keep the toast UX from the old imperative path for fetch errors.
  useEffect(() => {
    if (backlogError) {
      console.error('[revamp-backlog] Failed to fetch backlog:', backlogError)
      toast.error('Failed to load revamp backlog')
    }
  }, [backlogError])

  // Sync SWR data into local items state and re-resolve the selected row.
  useEffect(() => {
    if (!backlogData) return
    const nextItems = backlogData.items || []
    setItems(nextItems)
    setSelectedSlug((current) => {
      if (current && nextItems.some((item) => item.slug === current)) return current
      return nextItems[0]?.slug || null
    })
  }, [backlogData])

  // Imperative refresh wrapper used by mutation handlers below — they expect
  // to await a refetch after a write completes.
  const fetchBacklog = useCallback(async () => {
    await refreshBacklog()
  }, [refreshBacklog])

  const selectedItem = useMemo(
    () => items.find((item) => item.slug === selectedSlug) || null,
    [items, selectedSlug]
  )

  useEffect(() => {
    if (!selectedItem) return
    setEditor({
      status: selectedItem.status,
      priority: selectedItem.priority,
      revampReason: selectedItem.revampReason || '',
      notes: selectedItem.notes || '',
    })
  }, [selectedItem])

  const categories = useMemo(
    () => Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort(),
    [items]
  )

  const reasons = useMemo(
    () => Array.from(new Set(items.map((item) => item.revampReason).filter(Boolean) as string[])).sort(),
    [items]
  )

  // Summary stats across currently loaded items — "striking distance" is
  // position 5-15 (already ranking, realistic to push up) which is our main
  // revamp target.
  const summary = useMemo(() => {
    const totalClicks = items.reduce((acc, item) => acc + (item.clicks || 0), 0)
    const totalImpressions = items.reduce((acc, item) => acc + (item.impressions || 0), 0)
    const weightedCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
    const strikingDistance = items.filter((item) => item.position >= 5 && item.position <= 15).length
    return { totalClicks, totalImpressions, avgCtr: weightedCtr, strikingDistance }
  }, [items])

  // Selection is over the rows currently listed, which is the filtered set the
  // backlog returned (limit 1000, i.e. the whole corpus). Changing a filter
  // clears it, so "select all" can never act on rows you can no longer see.
  const allListedSelected = items.length > 0 && items.every((item) => selectedSlugs.has(item.slug))
  const someListedSelected = items.some((item) => selectedSlugs.has(item.slug))

  const toggleSelectAll = () => {
    setSelectedSlugs(allListedSelected ? new Set() : new Set(items.map((item) => item.slug)))
  }

  const toggleOne = (slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  // A post already in the queue (or deliberately skipped, or done) is not a
  // candidate for the next batch: batching is for posts still awaiting triage.
  const QUEUED_STATUSES = new Set(['ready', 'in-progress', 'revamped', 'published', 'skipped'])
  const batchCandidates = items.filter(
    (item) => !selectedSlugs.has(item.slug) && !QUEUED_STATUSES.has(item.status)
  )

  // Take the next N candidates in the order the table is currently sorted, so
  // "sort by clicks" means the batch is the highest-value posts left. Clicking
  // again adds the following N rather than reshuffling what is already ticked.
  const selectNextBatch = () => {
    const next = new Set(selectedSlugs)
    for (const item of batchCandidates.slice(0, batchSize)) next.add(item.slug)
    setSelectedSlugs(next)
  }

  // Revamps the selected posts one at a time. Each call is a complete
  // server-side job (generate, carry images, grade, update the live article in
  // place), so closing this tab mid-run only loses the article in flight:
  // everything already finished is live and marked revamped.
  const runRevamp = async () => {
    const slugs = Array.from(selectedSlugs)
    if (!slugs.length || runState.running) return
    if (!window.confirm(
      `Revamp ${slugs.length} post${slugs.length === 1 ? '' : 's'}?\n\n` +
      `Each one is regenerated on v2, keeps its images and URL, and REPLACES the live article body. ` +
      `Roughly 3 minutes each, so about ${Math.ceil((slugs.length * 3))} minutes total.`
    )) return

    stopRunRef.current = false
    setRunState({ running: true, done: [], current: null, total: slugs.length })
    for (const slug of slugs) {
      if (stopRunRef.current) break
      setRunState((s) => ({ ...s, current: slug }))
      try {
        const response = await apiFetch('/api/revamp/run-one', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error || 'Revamp failed')
        setRunState((s) => ({
          ...s,
          done: [...s.done, { slug, grade: data.grade, failures: data.failures, images: `${data.imagesCarried}/${data.imagesFound}`, secs: data.seconds }],
        }))
      } catch (error) {
        // A generation can outlive the browser's fetch: the server publishes and
        // marks the row, then the response never arrives and this lands here as
        // "Failed to fetch". Ask the server what actually happened before
        // calling it a failure, otherwise finished work looks broken and gets
        // needlessly re-run.
        let recovered = false
        try {
          const check = await apiFetch(`/api/revamp/run-one?slug=${encodeURIComponent(slug)}`)
          const status = await check.json().catch(() => null)
          if (check.ok && status?.revamped) {
            recovered = true
            setRunState((s) => ({
              ...s,
              done: [...s.done, { slug, grade: status.grade, failures: status.failures, images: 'n/a', secs: undefined }],
            }))
          }
        } catch {
          /* status check itself failed; fall through to reporting the error */
        }
        if (!recovered) {
          setRunState((s) => ({ ...s, done: [...s.done, { slug, error: error instanceof Error ? error.message : 'Failed' }] }))
        }
      }
    }
    setRunState((s) => ({ ...s, running: false, current: null }))
    setSelectedSlugs(new Set())
    await refreshBacklog()
    toast.success('Revamp run finished')
  }

  const runBulkAction = async (action: 'queue' | 'unqueue' | 'skip') => {
    const slugs = Array.from(selectedSlugs)
    if (!slugs.length) return
    // 30 at a time is the normal batch, so only confirm above a full batch.
    if (action !== 'unqueue' && slugs.length > 50) {
      const verb = action === 'queue' ? 'queue for revamp' : 'skip'
      if (!window.confirm(`${verb} ${slugs.length} posts?`)) return
    }
    setBulkBusy(true)
    try {
      // The endpoint caps a call at 500 slugs; chunk so a whole-segment
      // selection still goes through in one click.
      let updated = 0
      let brainRowsCreated = 0
      let alreadyDone = 0
      for (let i = 0; i < slugs.length; i += 500) {
        const response = await apiFetch('/api/revamp/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slugs: slugs.slice(i, i + 500),
            action,
            priority: action === 'queue' ? bulkPriority : undefined,
            mode: action === 'queue' ? bulkMode : undefined,
            revampReason: action === 'queue' && segmentFilter !== 'all' ? `audit: ${segmentFilter}` : undefined,
          }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error || 'Queue update failed')
        updated += data?.updated || 0
        brainRowsCreated += data?.brainRowsCreated || 0
        alreadyDone += data?.alreadyDone || 0
      }
      const label = action === 'queue' ? 'queued for revamp' : action === 'skip' ? 'skipped' : 'returned to triage'
      const notes = [
        brainRowsCreated ? `${brainRowsCreated} content brain rows created` : null,
        alreadyDone ? `${alreadyDone} skipped, already revamped` : null,
      ].filter(Boolean)
      toast.success(`${updated} posts ${label}`, {
        description: notes.length ? notes.join(' · ') : undefined,
      })
      setSelectedSlugs(new Set())
      await refreshBacklog()
    } catch (error) {
      console.error('[revamp-backlog] bulk action failed:', error)
      toast.error('Bulk action failed', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setBulkBusy(false)
    }
  }

  const handleCSVUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // The GSC CSV replaces all existing performance metrics (clicks/impressions/
    // ctr/position). Tracking/backlog rows are preserved. Confirm so a wrong
    // CSV doesn't silently wipe a good snapshot.
    const ok = window.confirm(
      'Importing this CSV will replace all existing GSC performance metrics (clicks, impressions, CTR, position). Backlog entries and notes are preserved. Continue?'
    )
    if (!ok) {
      event.target.value = ''
      return
    }

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await apiFetch('/api/blog-posts', {
        method: 'POST',
        body: formData,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Upload failed')
      toast.success(data?.message || 'Backlog imported')
      await fetchBacklog()
    } catch (error) {
      console.error('[revamp-backlog] CSV upload failed:', error)
      toast.error('CSV upload failed', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  const handleImportShopify = async () => {
    setIsImportingShopify(true)
    try {
      const response = await apiFetch('/api/revamp/backlog/import-shopify', {
        method: 'POST',
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Shopify import failed')
      toast.success(data?.message || 'Imported blog posts from Shopify')
      await fetchBacklog()
    } catch (error) {
      console.error('[revamp-backlog] Shopify import failed:', error)
      toast.error('Failed to import Shopify blogs', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setIsImportingShopify(false)
    }
  }

  const handleSave = async () => {
    if (!selectedItem) return
    setIsSaving(true)
    try {
      const response = await apiFetch('/api/revamp/backlog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: selectedItem.slug,
          status: editor.status,
          priority: editor.priority,
          revampReason: editor.revampReason,
          notes: editor.notes,
          lastReviewedAt: new Date().toISOString(),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Save failed')
      toast.success('Backlog item updated')
      await fetchBacklog()
    } catch (error) {
      console.error('[revamp-backlog] Save failed:', error)
      toast.error('Failed to save backlog item', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleSyncShopify = async (slug: string) => {
    setSyncingSlug(slug)
    try {
      const response = await apiFetch('/api/revamp/backlog/sync-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: [slug] }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Shopify sync failed')
      toast.success('Shopify metadata refreshed')
      await fetchBacklog()
    } catch (error) {
      console.error('[revamp-backlog] Shopify sync failed:', error)
      toast.error('Failed to refresh Shopify metadata', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setSyncingSlug(null)
    }
  }

  const handleOpenInRevamp = async (item: RevampBacklogItem) => {
    try {
      const response = await apiFetch('/api/revamp/backlog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: item.slug,
          status: 'in-progress',
          openedForRevampAt: new Date().toISOString(),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Failed to mark item in progress')
      onOpenRevamp({
        slug: item.slug,
        category: item.category,
        keyword: item.slug.replace(/-/g, ' '),
        trackingStatus: 'in-progress',
        trackingNotes: item.notes,
        sourceUrl: item.sourceUrl,
        currentTitle: item.title,
        existingShopifyId: item.shopifyArticleId,
        revampReason: item.revampReason,
      })
    } catch (error) {
      console.error('[revamp-backlog] Failed to open item in revamp:', error)
      toast.error('Failed to start revamp', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b px-6 py-2.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-warm)' }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-serif text-[18px] font-semibold leading-tight" style={{ color: 'var(--text1)' }}>
                Revamp Backlog
              </h1>
              <p className="text-[12px]" style={{ color: 'var(--text3)' }}>
                Import from Shopify, triage, and launch one-by-one revamps.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleImportShopify} disabled={isImportingShopify}>
                {isImportingShopify ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {isImportingShopify ? 'Importing...' : 'Import from Shopify'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleCSVUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                disabled={isSyncingGsc}
                onClick={async () => {
                  setIsSyncingGsc(true)
                  try {
                    const res = await apiFetch('/api/gsc/sync', { method: 'POST' })
                    const data = await res.json().catch(() => ({}))
                    if (!res.ok) throw new Error(data.error || 'GSC sync failed')
                    toast.success('GSC metrics synced', { description: `${data.updated ?? data.count ?? 'All'} posts updated from Search Console.` })
                    fetchBacklog()
                  } catch (e) {
                    toast.error('GSC sync failed', { description: e instanceof Error ? e.message : 'Check the service account setup (gsc-direct-connection-setup.md).' })
                  } finally {
                    setIsSyncingGsc(false)
                  }
                }}
              >
                {isSyncingGsc ? 'Syncing GSC...' : 'Sync GSC'}
              </Button>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isUploading ? 'Uploading...' : 'Import GSC CSV (Optional)'}
              </Button>
              <Button variant="outline" onClick={fetchBacklog} disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text4)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, slug, notes, or URL"
                className="w-full rounded-lg border py-2 pl-9 pr-3 text-[12px]"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
              />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <select value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
              <option value="all">All segments</option>
              <option value="A-protect">A: protect (50+ clicks)</option>
              <option value="B-refresh">B: refresh</option>
              <option value="C-full-regen">C: full regen</option>
              <option value="D-delete-or-combine">D: delete or combine</option>
              <option value="missing-on-shopify">Missing on Shopify</option>
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
              <option value="all">All priorities</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>{priority}</option>
              ))}
            </select>
            <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
              <option value="all">All reasons</option>
              {reasons.map((reason) => (
                <option key={reason} value={reason}>{reason}</option>
              ))}
            </select>
            <select value={gradeIssueFilter} onChange={(e) => setGradeIssueFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
              {GRADE_ISSUE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border px-3 py-2 text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>Sort: {option.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--text2)', background: 'var(--bg)' }}>
              <input
                type="checkbox"
                checked={excludeCompleted}
                onChange={(e) => setExcludeCompleted(e.target.checked)}
              />
              Hide revamped/published
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-2">
          {(runState.running || runState.done.length > 0) && (
            <div className="mb-2 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border)', background: 'var(--bg-warm)' }}>
              <div className="flex items-center gap-3">
                <span className="font-mono" style={{ color: 'var(--text1)' }}>
                  Revamp run: {runState.done.length} of {runState.total}
                </span>
                {runState.current && (
                  <span style={{ color: 'var(--text3)' }}>
                    <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                    {runState.current}
                  </span>
                )}
                {runState.running && (
                  <Button size="sm" variant="outline" onClick={() => { stopRunRef.current = true }}>
                    Stop after this one
                  </Button>
                )}
                {!runState.running && (
                  <Button size="sm" variant="ghost" onClick={() => setRunState({ running: false, done: [], current: null, total: 0 })}>
                    Dismiss
                  </Button>
                )}
              </div>
              {runState.done.length > 0 && (
                <div className="mt-2 flex flex-col gap-0.5 font-mono text-[11px]">
                  {runState.done.map((d) => (
                    <div key={d.slug} style={{ color: d.error ? '#b91c1c' : 'var(--text3)' }}>
                      {d.error
                        ? `FAILED ${d.slug}: ${d.error}`
                        : d.images === 'n/a'
                          ? `${d.slug}: grade ${d.grade}, published (response timed out, verified on the server)`
                          : `${d.slug}: grade ${d.grade}, images ${d.images}, ${d.secs}s${d.failures && d.failures.length ? `, check: ${d.failures.join(', ')}` : ''}`}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedSlugs.size > 0 && (
            <div
              className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-[12px]"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-warm)' }}
            >
              <span className="font-mono" style={{ color: 'var(--text1)' }}>
                {selectedSlugs.size} selected
              </span>
              <select
                value={bulkPriority}
                onChange={(e) => setBulkPriority(e.target.value as 'low' | 'normal' | 'high')}
                className="rounded-lg border px-2 py-1 text-[12px]"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
              >
                <option value="high">Priority: high</option>
                <option value="normal">Priority: normal</option>
                <option value="low">Priority: low</option>
              </select>
              <select
                value={bulkMode}
                onChange={(e) => setBulkMode(e.target.value as 'keep-images' | 'full-regen' | 'combine' | 'delete')}
                className="rounded-lg border px-2 py-1 text-[12px]"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
              >
                <option value="keep-images">Mode: keep images</option>
                <option value="full-regen">Mode: full regen</option>
                <option value="combine">Mode: combine</option>
                <option value="delete">Mode: delete</option>
              </select>
              <Button size="sm" onClick={() => runBulkAction('queue')} disabled={bulkBusy}>
                {bulkBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Push to revamp queue
              </Button>
              <Button
                size="sm"
                onClick={runRevamp}
                disabled={bulkBusy || runState.running}
                style={{ background: 'var(--ppw-accent, #1D9E75)', color: '#fff' }}
                title="Regenerate on v2, keep images and URL, update the live article in place"
              >
                {runState.running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Revamp now
              </Button>
              <Button size="sm" variant="outline" onClick={() => runBulkAction('skip')} disabled={bulkBusy || runState.running}>
                Skip
              </Button>
              <Button size="sm" variant="outline" onClick={() => runBulkAction('unqueue')} disabled={bulkBusy}>
                Unqueue
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedSlugs(new Set())} disabled={bulkBusy}>
                Clear
              </Button>
            </div>
          )}

          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] font-mono" style={{ color: 'var(--text3)' }}>
              <span><span style={{ color: 'var(--text1)' }}>{backlogData?.count ?? items.length}</span> posts</span>
              <span><span style={{ color: 'var(--text1)' }}>{summary.totalClicks.toLocaleString()}</span> clicks</span>
              <span><span style={{ color: 'var(--text1)' }}>{summary.totalImpressions.toLocaleString()}</span> impressions</span>
              <span>avg CTR <span style={{ color: 'var(--text1)' }}>{summary.avgCtr.toFixed(2)}%</span></span>
              <span><span style={{ color: 'var(--text1)' }}>{summary.strikingDistance}</span> in striking distance (pos 5–15)</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={selectNextBatch}
                disabled={batchCandidates.length === 0}
                title="Ticks the next batch of un-queued posts in the current filter and sort order"
              >
                Select next {Math.min(batchSize, batchCandidates.length)}
              </Button>
              <select
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="rounded-lg border px-2 py-1 text-[11px]"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                aria-label="Batch size"
              >
                {[10, 20, 30, 50].map((n) => (
                  <option key={n} value={n}>{n} per batch</option>
                ))}
              </select>
              <span className="text-[11px] font-mono" style={{ color: 'var(--text3)' }}>
                {batchCandidates.length} un-queued
              </span>
            </div>
            <label className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'var(--text3)' }}>
              <input type="checkbox" checked={denseMode} onChange={(e) => setDenseMode(e.target.checked)} />
              Dense
            </label>
          </div>

          <TooltipProvider delayDuration={200}>
          <Table>
            <TableHeader className="sticky top-0 z-10" style={{ background: 'var(--bg-warm)' }}>
              <TableRow>
                <TableHead className="w-[36px]">
                  <input
                    type="checkbox"
                    aria-label="Select all listed posts"
                    checked={allListedSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someListedSelected && !allListedSelected
                    }}
                    onChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Seg</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Impressions</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">Position</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[40px] text-center">
                  <Tooltip>
                    <TooltipTrigger asChild><span>Pri</span></TooltipTrigger>
                    <TooltipContent side="top">Priority (low / normal / high / urgent)</TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="text-right">Grade</TableHead>
                <TableHead className="text-right">Reviewed</TableHead>
                <TableHead className="text-right">Synced</TableHead>
                <TableHead>Coverage</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const isSelected = selectedSlug === item.slug
                const cellPadding = denseMode ? 'py-1' : ''
                return (
                  <TableRow
                    key={item.slug}
                    data-state={isSelected ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => setSelectedSlug(item.slug)}
                  >
                    <TableCell className={cellPadding} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.slug}`}
                        checked={selectedSlugs.has(item.slug)}
                        onChange={() => toggleOne(item.slug)}
                      />
                    </TableCell>
                    <TableCell className={`max-w-[320px] ${cellPadding}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="truncate font-medium" style={{ color: 'var(--text1)' }}>
                            {item.title || formatSlugTitle(item.slug)}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start">
                          <div className="font-medium">{item.title || formatSlugTitle(item.slug)}</div>
                          <div className="font-mono text-[10px] opacity-80">{item.slug}</div>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className={cellPadding}>{titleCase(item.category)}</TableCell>
                    <TableCell className={cellPadding}><SegmentBadge item={item} /></TableCell>
                    <TableCell className={`text-right tabular-nums ${cellPadding}`}>{item.clicks.toLocaleString()}</TableCell>
                    <TableCell className={`text-right tabular-nums ${cellPadding}`}>{item.impressions.toLocaleString()}</TableCell>
                    <TableCell className={`text-right tabular-nums ${cellPadding}`} style={item.impressions > 0 ? ctrStyle(item.ctr) : undefined}>
                      {item.impressions > 0 ? `${item.ctr.toFixed(2)}%` : '—'}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${cellPadding}`} style={item.position > 0 ? positionStyle(item.position) : undefined}>
                      {item.position > 0 ? item.position.toFixed(1) : '—'}
                    </TableCell>
                    <TableCell className={cellPadding}><StatusPill status={item.status} /></TableCell>
                    <TableCell className={`text-center ${cellPadding}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex"><PriorityDot priority={item.priority} /></span>
                        </TooltipTrigger>
                        <TooltipContent side="top">Priority: {item.priority}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${cellPadding}`}>
                      {item.gradeScore === null || item.gradeScore === undefined ? '—' : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span style={{ fontWeight: 600, color: item.gradeScore >= 90 ? '#15803d' : item.gradeScore >= 70 ? '#b45309' : '#b91c1c' }}>
                              {item.gradeScore}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="end">
                            {(item.gradeFailures || []).length ? (item.gradeFailures || []).join(', ') : 'All checks pass'}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-[11px] ${cellPadding}`} style={{ color: 'var(--text3)' }}>
                      {item.lastReviewedAt ? (
                        <Tooltip>
                          <TooltipTrigger asChild><span>{formatRelative(item.lastReviewedAt)}</span></TooltipTrigger>
                          <TooltipContent side="top">{formatDate(item.lastReviewedAt)}</TooltipContent>
                        </Tooltip>
                      ) : '—'}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-[11px] ${cellPadding}`} style={{ color: 'var(--text3)' }}>
                      {item.lastShopifySyncAt ? (
                        <Tooltip>
                          <TooltipTrigger asChild><span>{formatRelative(item.lastShopifySyncAt)}</span></TooltipTrigger>
                          <TooltipContent side="top">{formatDate(item.lastShopifySyncAt)}</TooltipContent>
                        </Tooltip>
                      ) : '—'}
                    </TableCell>
                    <TableCell className={cellPadding}><CoverageChips item={item} /></TableCell>
                    <TableCell className={`text-right ${cellPadding}`}>
                      <div className="flex justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-7 p-0"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSyncShopify(item.slug)
                              }}
                              disabled={syncingSlug === item.slug}
                              aria-label="Sync from Shopify"
                            >
                              {syncingSlug === item.slug
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <RefreshCw className="h-3.5 w-3.5" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            Refresh Shopify metadata (title, published date, coverage flags) for this post.
                          </TooltipContent>
                        </Tooltip>
                        {onEditArticle && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onEditArticle(item.slug)
                                }}
                              >
                                Edit
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              Open in Workshop: fix issues and swap products without rewriting the article.
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Button
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleOpenInRevamp(item)
                          }}
                        >
                          Revamp
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="py-10 text-center" style={{ color: 'var(--text3)' }}>
                    Import posts from Shopify to start building the backlog. GSC CSV import is optional if you want performance metrics.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </TooltipProvider>
        </div>
      </div>

      <aside className="hidden w-[360px] flex-shrink-0 border-l xl:flex xl:flex-col" style={{ borderColor: 'var(--border)', background: 'var(--bg-warm)' }}>
        <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-mono uppercase tracking-[1px]" style={{ color: 'var(--text3)' }}>
            Backlog Details
          </div>
          <h2 className="mt-2 font-serif text-[20px] font-semibold" style={{ color: 'var(--text1)' }}>
            {selectedItem?.title || 'Select a post'}
          </h2>
          {selectedItem && (
            <div className="mt-1 text-[12px] font-mono" style={{ color: 'var(--text4)' }}>
              {selectedItem.slug}
            </div>
          )}
        </div>

        {selectedItem ? (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-4">
              <div className="rounded-lg border p-3 text-[12px]" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div style={{ color: 'var(--text4)' }}>Source URL</div>
                    <div className="mt-1 break-all" style={{ color: 'var(--text2)' }}>{selectedItem.sourceUrl || '—'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text4)' }}>Published</div>
                    <div className="mt-1" style={{ color: 'var(--text2)' }}>{formatDate(selectedItem.shopifyPublishedAt)}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text4)' }}>Opened for revamp</div>
                    <div className="mt-1" style={{ color: 'var(--text2)' }}>{formatDateTime(selectedItem.openedForRevampAt)}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text4)' }}>Last imported</div>
                    <div className="mt-1" style={{ color: 'var(--text2)' }}>{formatDate(selectedItem.lastImportedAt)}</div>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-mono uppercase tracking-[1px]" style={{ color: 'var(--text3)' }}>
                  Status
                </label>
                <select value={editor.status} onChange={(e) => setEditor((prev) => ({ ...prev, status: e.target.value as RevampBacklogStatus }))} className="w-full rounded-lg border px-3 py-2 text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-mono uppercase tracking-[1px]" style={{ color: 'var(--text3)' }}>
                  Priority
                </label>
                <select value={editor.priority} onChange={(e) => setEditor((prev) => ({ ...prev, priority: e.target.value as RevampBacklogPriority }))} className="w-full rounded-lg border px-3 py-2 text-[12px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
                  {PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>{priority}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-mono uppercase tracking-[1px]" style={{ color: 'var(--text3)' }}>
                  Revamp Reason
                </label>
                <input
                  value={editor.revampReason}
                  onChange={(e) => setEditor((prev) => ({ ...prev, revampReason: e.target.value }))}
                  placeholder="e.g. seo-improvement"
                  className="w-full rounded-lg border px-3 py-2 text-[12px]"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-mono uppercase tracking-[1px]" style={{ color: 'var(--text3)' }}>
                  Notes
                </label>
                <textarea
                  value={editor.notes}
                  onChange={(e) => setEditor((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Editorial notes, blockers, or context"
                  className="min-h-[180px] w-full rounded-lg border px-3 py-2 text-[12px]"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button variant="outline" onClick={() => handleSyncShopify(selectedItem.slug)} disabled={syncingSlug === selectedItem.slug}>
                  {syncingSlug === selectedItem.slug ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Refresh Shopify Data
                </Button>
                <Button variant="outline" onClick={() => handleOpenInRevamp(selectedItem)}>
                  Open in Revamp
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-6 text-[13px]" style={{ color: 'var(--text3)' }}>
            Select a row to edit notes, priority, and revamp status.
          </div>
        )}
      </aside>
    </div>
  )
}
