// components/CollectionsWorkspace.tsx
// Top-level container for Collections mode.
// Renders its own mini sidebar + routes between collection views.
'use client'

import { useState } from 'react'
import { RefreshCw, Database, BarChart3, Library, Store, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import CollectionsTab from '@/components/CollectionsTab'
import { CollectionRevampTool } from '@/components/CollectionRevampTool'
import { CollectionAuditQueue } from '@/components/CollectionAuditQueue'
import { CollectionsRepository } from '@/components/CollectionsRepository'
import { BrandCollectionsCreate } from '@/components/BrandCollectionsCreate'
import { KeywordAudit } from '@/components/KeywordAudit'

type CollectionView = 'revamp' | 'database' | 'audit' | 'repository' | 'brands' | 'keywords'

interface SidebarItem {
  id: CollectionView
  label: string
  icon: React.ReactNode
  description: string
}

const NAV_ITEMS: SidebarItem[] = [
  {
    id: 'repository',
    label: 'All Collections',
    icon: <Library className="h-[18px] w-[18px]" />,
    description: 'Every collection with keywords, tags & meta. Import & export here.',
  },
  {
    id: 'audit',
    label: 'Audit Queue',
    icon: <BarChart3 className="h-[18px] w-[18px]" />,
    description: 'Prioritized list of collections to fix',
  },
  {
    id: 'keywords',
    label: 'Keyword Audit',
    icon: <Search className="h-[18px] w-[18px]" />,
    description: 'Research per collection, AI keyword and title recommendations, apply to rows or Shopify',
  },
  {
    id: 'brands',
    label: 'New Brand Pages',
    icon: <Store className="h-[18px] w-[18px]" />,
    description: 'Create brand collections for new vendors and add them to the queue',
  },
  {
    id: 'revamp',
    label: 'Revamp Tool',
    icon: <RefreshCw className="h-[18px] w-[18px]" />,
    description: 'Load, grade & optimize a collection',
  },
  {
    id: 'database',
    label: 'Database',
    icon: <Database className="h-[18px] w-[18px]" />,
    description: 'Keyword research & collection registry',
  },
]

export function CollectionsWorkspace() {
  const [activeView, setActiveView] = useState<CollectionView>('audit')
  // When the audit queue launches a collection into the revamp tool
  const [launchHandle, setLaunchHandle] = useState<string | null>(null)

  const handleLaunchRevamp = (handle: string) => {
    setLaunchHandle(handle)
    setActiveView('revamp')
  }

  const handleRevampConsumed = () => {
    setLaunchHandle(null)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Collections sidebar ── */}
      <aside
        className="flex flex-col border-r pt-4 flex-shrink-0"
        style={{
          width: 220,
          background: 'var(--bg-warm)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Section label */}
        <div
          className="px-4 pb-2 text-[9px] font-medium tracking-[1.5px] uppercase font-mono"
          style={{ color: 'var(--text4)' }}
        >
          Collections
        </div>

        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={cn(
                'flex w-full items-center gap-2.5 border-l-[2.5px] px-4 py-[7px] text-left text-[13px] transition-all select-none',
                isActive
                  ? 'font-semibold'
                  : 'border-transparent font-normal hover:bg-[var(--surface)]'
              )}
              style={{
                color: isActive ? 'var(--gtd-accent)' : 'var(--text2)',
                background: isActive ? 'var(--gtd-accent-light)' : undefined,
                borderLeftColor: isActive ? 'var(--gtd-accent)' : 'transparent',
              }}
            >
              <span className={cn('w-[18px] text-center flex-shrink-0', isActive ? 'opacity-100' : 'opacity-75')}>
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
            </button>
          )
        })}

        {/* Bottom hint */}
        <div className="mt-auto px-4 py-4">
          <p className="text-[11px] leading-[1.5]" style={{ color: 'var(--text4)' }}>
            {NAV_ITEMS.find(n => n.id === activeView)?.description}
          </p>
        </div>
      </aside>

      {/* ── Main content area ── */}
      <main className="flex flex-1 flex-col overflow-y-auto" style={{ background: 'var(--bg-warm)' }}>
        {activeView === 'revamp' && (
          <CollectionRevampTool
            initialHandle={launchHandle}
            onBack={() => setActiveView('audit')}
            onHandleConsumed={handleRevampConsumed}
          />
        )}
        {activeView === 'database' && <CollectionsTab />}
        {activeView === 'repository' && <CollectionsRepository />}
        {activeView === 'brands' && <BrandCollectionsCreate />}
        {activeView === 'keywords' && <KeywordAudit />}
        {activeView === 'audit' && (
          <CollectionAuditQueue onLaunchRevamp={handleLaunchRevamp} />
        )}
      </main>
    </div>
  )
}
