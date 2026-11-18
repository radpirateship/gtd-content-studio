'use client'
/**
 * ContentBrainCanvas — the mind-map view of PPW's topical authority.
 *
 * Hierarchy rendered as a horizontal flow:
 *     PPW root → Hub → Cluster → (article count badge)
 *
 * Click a hub or cluster to open a right-side drawer that lists the
 * underlying articles with title, status, strategic notes, and keyword metrics.
 *
 * Lens switcher lets the user recolor the graph:
 *   - coverage     → green/yellow/red by % planned vs live vs gap
 *   - opportunity  → heat-shaded by average opportunity_score
 *   - status       → green = live, blue = planned, gray = idea
 *
 * Data is pulled once from /api/content-brain/ideas and bucketed client-side;
 * no new API routes required for the initial canvas.
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Idea {
  id: number
  title: string
  keyword: string | null
  hub: string | null
  cluster_group: string | null
  content_type: string
  status: string
  traffic_light: string
  priority: string | null
  kw_volume: number | null
  kw_difficulty: number | null
  traffic_potential: number | null
  opportunity_score: number | null
  strategic_notes: string | null
}

type Lens = 'coverage' | 'opportunity' | 'status'

// ---------------------------------------------------------------------------
// Palette (PPW brand)
// ---------------------------------------------------------------------------
const PPW = {
  blue: '#0066cc',
  navy: '#003366',
  green: 'rgb(26,122,84)',
  cream: 'rgb(250,250,248)',
  muted: '#6b6b6b',
  yellow: '#d69e2e',
  red: '#c05621',
}

const HUB_COLORS: Record<string, string> = {
  Saunas: '#c05621',
  Recovery: PPW.blue,
  Wellness: PPW.green,
  Cardio: PPW.navy,
  'Cross-Topic': '#6b7280', // neutral gray — historical bucket, not being added to
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ContentBrainCanvas() {
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lens, setLens] = useState<Lens>('coverage')
  const [selected, setSelected] = useState<{
    kind: 'hub' | 'cluster'
    hub: string
    cluster?: string
  } | null>(null)

  // Fetch ideas once
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/content-brain/ideas')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        setIdeas(Array.isArray(data) ? data : data.rows || [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Build the graph from ideas
  const graph = useMemo(() => buildGraph(ideas, lens), [ideas, lens])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(graph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(graph.edges)

  // Refresh graph when data or lens changes
  useEffect(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [graph, setNodes, setEdges])

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const data = node.data as { kind?: string; hub?: string; cluster?: string }
    if (data.kind === 'hub' && data.hub) {
      setSelected({ kind: 'hub', hub: data.hub })
    } else if (data.kind === 'cluster' && data.hub && data.cluster) {
      setSelected({ kind: 'cluster', hub: data.hub, cluster: data.cluster })
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: PPW.cream }}>
      {/* Top bar */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid #e5e5e5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'white',
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: PPW.navy }}>PPW Content Brain</div>
          <div style={{ fontSize: 12, color: PPW.muted }}>
            {loading ? 'Loading…' : `${ideas.length} ideas • ${graph.clusterCount} clusters • ${graph.hubCount} hubs`}
          </div>
        </div>
        <LensSwitcher lens={lens} onChange={setLens} />
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', color: PPW.red, fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {/* Canvas + drawer */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            nodesDraggable
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#d4d4d4" gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => (n.style?.background as string) || PPW.blue} />
          </ReactFlow>
          {lens === 'coverage' && <LegendCoverage />}
          {lens === 'opportunity' && <LegendOpportunity />}
          {lens === 'status' && <LegendStatus />}
        </div>

        {selected && (
          <DetailDrawer
            ideas={ideas}
            selected={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------
interface BuiltGraph {
  nodes: Node[]
  edges: Edge[]
  hubCount: number
  clusterCount: number
}

function buildGraph(ideas: Idea[], lens: Lens): BuiltGraph {
  const HUBS = ['Saunas', 'Recovery', 'Wellness', 'Cardio', 'Cross-Topic']

  // Bucket ideas by hub → cluster
  const byHub = new Map<string, Map<string, Idea[]>>()
  for (const i of ideas) {
    const hub = i.hub || 'Unassigned'
    const cluster = i.cluster_group || 'General'
    if (!byHub.has(hub)) byHub.set(hub, new Map())
    const m = byHub.get(hub)!
    if (!m.has(cluster)) m.set(cluster, [])
    m.get(cluster)!.push(i)
  }

  const nodes: Node[] = []
  const edges: Edge[] = []

  // Root node
  nodes.push({
    id: 'root',
    type: 'default',
    data: { label: 'PPW', kind: 'root' },
    position: { x: 0, y: 0 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: {
      background: PPW.navy,
      color: 'white',
      border: 'none',
      borderRadius: 12,
      padding: '14px 22px',
      fontSize: 16,
      fontWeight: 700,
      width: 100,
      textAlign: 'center',
    },
  })

  // Layout constants
  const HUB_X = 280
  const CLUSTER_X = 640
  const HUB_SPACING = 260
  const CLUSTER_SPACING = 70

  // Count clusters per hub first to distribute hub Y positions
  const orderedHubs = HUBS.filter((h) => byHub.has(h)).concat(
    [...byHub.keys()].filter((h) => !HUBS.includes(h))
  )

  // Total vertical span needed for each hub based on cluster count
  const hubHeights = orderedHubs.map((h) => Math.max(1, byHub.get(h)!.size) * CLUSTER_SPACING)
  const totalHeight = hubHeights.reduce((a, b) => a + b + 60, 0)
  let cursorY = -totalHeight / 2

  let clusterCount = 0

  orderedHubs.forEach((hub, hIdx) => {
    const clusters = byHub.get(hub)!
    const hubHeight = hubHeights[hIdx]
    const hubCenterY = cursorY + hubHeight / 2

    // Hub node
    const hubIdeas = [...clusters.values()].flat()
    const hubColor = HUB_COLORS[hub] || PPW.blue
    nodes.push({
      id: `hub:${hub}`,
      type: 'default',
      data: {
        label: `${hub}\n${hubIdeas.length} articles`,
        kind: 'hub',
        hub,
      },
      position: { x: HUB_X, y: hubCenterY - 24 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        background: hubColor,
        color: 'white',
        border: 'none',
        borderRadius: 10,
        padding: '12px 18px',
        fontSize: 13,
        fontWeight: 600,
        width: 160,
        textAlign: 'center',
        whiteSpace: 'pre-line',
      },
    })

    edges.push({
      id: `e:root-${hub}`,
      source: 'root',
      target: `hub:${hub}`,
      type: 'smoothstep',
      style: { stroke: hubColor, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: hubColor },
    })

    // Cluster nodes
    let cY = cursorY + 20
    for (const [clusterName, clusterIdeas] of clusters.entries()) {
      clusterCount++
      const tint = colorForLens(lens, clusterIdeas, hubColor)
      const live = clusterIdeas.filter((i) => i.status === 'live').length
      const planned = clusterIdeas.filter((i) => i.status === 'planned').length
      const label = `${clusterName}\n${clusterIdeas.length} • ${live}✓ ${planned}○`

      nodes.push({
        id: `cluster:${hub}:${clusterName}`,
        type: 'default',
        data: { label, kind: 'cluster', hub, cluster: clusterName },
        position: { x: CLUSTER_X, y: cY },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: tint.bg,
          color: tint.fg,
          border: `1px solid ${tint.border}`,
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 11,
          fontWeight: 500,
          width: 200,
          textAlign: 'left',
          whiteSpace: 'pre-line',
          lineHeight: 1.35,
        },
      })

      edges.push({
        id: `e:${hub}-${clusterName}`,
        source: `hub:${hub}`,
        target: `cluster:${hub}:${clusterName}`,
        type: 'smoothstep',
        style: { stroke: '#c4c4c4', strokeWidth: 1.5 },
      })

      cY += CLUSTER_SPACING
    }

    cursorY += hubHeight + 60
  })

  return { nodes, edges, hubCount: orderedHubs.length, clusterCount }
}

// ---------------------------------------------------------------------------
// Lens coloring
// ---------------------------------------------------------------------------
function colorForLens(
  lens: Lens,
  clusterIdeas: Idea[],
  hubColor: string
): { bg: string; fg: string; border: string } {
  if (lens === 'coverage') {
    const total = clusterIdeas.length
    const live = clusterIdeas.filter((i) => i.status === 'live').length
    const ratio = total === 0 ? 0 : live / total
    if (ratio >= 0.6) return { bg: '#e6f4ea', fg: '#1a5132', border: PPW.green }
    if (ratio >= 0.2) return { bg: '#fff4d6', fg: '#7a5a00', border: PPW.yellow }
    return { bg: '#fde7dc', fg: '#7a2a08', border: PPW.red }
  }
  if (lens === 'opportunity') {
    const scored = clusterIdeas.filter((i) => typeof i.opportunity_score === 'number')
    const avg =
      scored.length === 0
        ? 0
        : scored.reduce((s, i) => s + (i.opportunity_score || 0), 0) / scored.length
    if (avg >= 60) return { bg: '#e0f0ff', fg: PPW.navy, border: PPW.blue }
    if (avg >= 30) return { bg: '#f0f4f8', fg: '#3a4a5a', border: '#99aabb' }
    return { bg: 'white', fg: PPW.muted, border: '#d4d4d4' }
  }
  // status lens
  const hasPlanned = clusterIdeas.some((i) => i.status === 'planned')
  const hasLive = clusterIdeas.some((i) => i.status === 'live')
  if (hasLive && hasPlanned) return { bg: '#ecfdf5', fg: '#14532d', border: PPW.green }
  if (hasLive) return { bg: '#f0f9ff', fg: PPW.navy, border: hubColor }
  return { bg: 'white', fg: PPW.muted, border: '#d4d4d4' }
}

// ---------------------------------------------------------------------------
// Lens switcher
// ---------------------------------------------------------------------------
function LensSwitcher({ lens, onChange }: { lens: Lens; onChange: (l: Lens) => void }) {
  const options: { id: Lens; label: string }[] = [
    { id: 'coverage', label: 'Coverage' },
    { id: 'opportunity', label: 'Opportunity' },
    { id: 'status', label: 'Status' },
  ]
  return (
    <div style={{ display: 'flex', gap: 4, background: '#f0f0f0', padding: 4, borderRadius: 8 }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '6px 14px',
            border: 'none',
            borderRadius: 6,
            background: lens === o.id ? 'white' : 'transparent',
            color: lens === o.id ? PPW.navy : PPW.muted,
            fontWeight: lens === o.id ? 600 : 500,
            fontSize: 13,
            cursor: 'pointer',
            boxShadow: lens === o.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Legends
// ---------------------------------------------------------------------------
function LegendBox({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        background: 'white',
        padding: '10px 14px',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        fontSize: 12,
        display: 'flex',
        gap: 14,
        zIndex: 10,
      }}
    >
      {items.map((i) => (
        <div key={i.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: i.color,
              border: '1px solid rgba(0,0,0,0.1)',
            }}
          />
          <span>{i.label}</span>
        </div>
      ))}
    </div>
  )
}
function LegendCoverage() {
  return (
    <LegendBox
      items={[
        { color: '#e6f4ea', label: '60%+ live' },
        { color: '#fff4d6', label: '20-60% live' },
        { color: '#fde7dc', label: '<20% live' },
      ]}
    />
  )
}
function LegendOpportunity() {
  return (
    <LegendBox
      items={[
        { color: '#e0f0ff', label: 'High (60+)' },
        { color: '#f0f4f8', label: 'Med (30-60)' },
        { color: 'white', label: 'Low (<30)' },
      ]}
    />
  )
}
function LegendStatus() {
  return (
    <LegendBox
      items={[
        { color: '#ecfdf5', label: 'Live + Planned' },
        { color: '#f0f9ff', label: 'Live only' },
        { color: 'white', label: 'Empty' },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------
function DetailDrawer({
  ideas,
  selected,
  onClose,
}: {
  ideas: Idea[]
  selected: { kind: 'hub' | 'cluster'; hub: string; cluster?: string }
  onClose: () => void
}) {
  const rows = useMemo(() => {
    return ideas.filter((i) => {
      if (i.hub !== selected.hub) return false
      if (selected.kind === 'cluster' && i.cluster_group !== selected.cluster) return false
      return true
    })
  }, [ideas, selected])

  const title = selected.kind === 'hub' ? selected.hub : `${selected.hub} › ${selected.cluster}`

  return (
    <div
      style={{
        width: 420,
        borderLeft: '1px solid #e5e5e5',
        background: 'white',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid #e5e5e5',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: PPW.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {selected.kind}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: PPW.navy }}>{title}</div>
          <div style={{ fontSize: 12, color: PPW.muted, marginTop: 2 }}>{rows.length} articles</div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: 20,
            cursor: 'pointer',
            color: PPW.muted,
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {rows.length === 0 && (
          <div style={{ padding: 20, color: PPW.muted, fontSize: 13 }}>No articles yet.</div>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            style={{
              padding: '10px 18px',
              borderBottom: '1px solid #f0f0f0',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontWeight: 600, color: PPW.navy, flex: 1 }}>{r.title}</div>
              <StatusPill status={r.status} />
            </div>
            {r.keyword && (
              <div style={{ color: PPW.muted, marginTop: 3 }}>
                kw: {r.keyword}
                {r.kw_volume ? ` • vol ${r.kw_volume}` : ''}
                {r.kw_difficulty != null ? ` • KD ${r.kw_difficulty}` : ''}
                {typeof r.opportunity_score === 'number' ? ` • opp ${r.opportunity_score}` : ''}
              </div>
            )}
            {r.strategic_notes && (
              <div
                style={{
                  marginTop: 6,
                  padding: '6px 8px',
                  background: PPW.cream,
                  borderLeft: `2px solid ${PPW.blue}`,
                  borderRadius: 3,
                  color: '#3a3a3a',
                  fontSize: 11,
                  fontStyle: 'italic',
                }}
              >
                {r.strategic_notes}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    live: { bg: '#e6f4ea', fg: '#1a5132' },
    planned: { bg: '#e0f0ff', fg: PPW.navy },
    idea: { bg: '#f0f0f0', fg: PPW.muted },
    draft: { bg: '#fff4d6', fg: '#7a5a00' },
  }
  const s = map[status] || { bg: '#f0f0f0', fg: PPW.muted }
  return (
    <span
      style={{
        background: s.bg,
        color: s.fg,
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        whiteSpace: 'nowrap',
        height: 'fit-content',
      }}
    >
      {status}
    </span>
  )
}
