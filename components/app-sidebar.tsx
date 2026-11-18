'use client'

import { cn } from '@/lib/utils'
import {
  FilePlus,
  FolderOpen,
  Package,
  Database,
  Layers,
  Zap,
  Check,
  FileText,
  Link2,
  ImageIcon,
  BarChart3,
  Clock,
  BookOpen,
  PlusCircle,
  List,
  Wrench,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  Video,
} from 'lucide-react'

export type ViewId =
  | 'new-article'
  | 'outline-review'
  | 'article-content'
  | 'article-links'
  | 'article-images'
  | 'article-seo'
  | 'library'
  | 'queue'
  | 'bulk-queue'
  | 'products'
  | 'resources'
  | 'auto-run'
  | 'publish-confirm'
  | 'error'
  // ââ Ultimate Guide views ââ
  | 'guide-new'
  | 'guide-products'
  | 'guide-generate'
  | 'guide-images'
  | 'guide-review'
  | 'guide-publish'
  | 'guide-library'
  | 'workshop'
  | 'collections'
  | 'content-brain'
  | 'content-brain-table'
  | 'content-brain-settings'
  | 'image-studio'
  | 'revamp'
  | 'quality'
  | 'video-scripts'

interface NavItem {
  id: ViewId
  label: string
  icon: React.ReactNode
  badge?: string
  badgeVariant?: 'green' | 'grey' | 'amber'
}

interface WorkflowStep {
  label: string
  status: 'done' | 'current' | 'pending'
}

interface AppSidebarProps {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  articleCounts?: { drafts: number; published: number }
  guideCounts?: { drafts: number; published: number }
  workflowSteps?: WorkflowStep[]
  hasCurrentArticle?: boolean
  hasCurrentGuide?: boolean
  currentArticleTitle?: string
  currentGuideTitle?: string
  articleBadges?: {
    content?: string
    links?: string
    linksVariant?: 'green' | 'grey' | 'amber'
    images?: string
    imagesVariant?: 'green' | 'grey' | 'amber'
    seo?: string
    seoVariant?: 'green' | 'grey' | 'amber'
  }
  guideBadges?: {
    products?: string
    productsVariant?: 'green' | 'grey' | 'amber'
    content?: string
    contentVariant?: 'green' | 'grey' | 'amber'
    images?: string
    imagesVariant?: 'green' | 'grey' | 'amber'
  }
}

export function AppSidebar({
  activeView,
  onNavigate,
  articleCounts,
  guideCounts,
  workflowSteps,
  hasCurrentArticle,
  hasCurrentGuide,
  currentGuideTitle: _currentGuideTitle,
  articleBadges,
  guideBadges,
}: AppSidebarProps) {
  const createItems: NavItem[] = [
    { id: 'new-article', label: 'New Article', icon: <FilePlus className="h-[18px] w-[18px]" /> },
    { id: 'bulk-queue', label: 'Bulk Upload', icon: <Layers className="h-[18px] w-[18px]" /> },
    { id: 'auto-run', label: 'Auto-Run', icon: <Zap className="h-[18px] w-[18px]" /> },
  ]

  const articleItems: NavItem[] = [
    { id: 'article-content', label: 'Content', icon: <FileText className="h-[18px] w-[18px]" />, badge: articleBadges?.content, badgeVariant: 'green' },
    { id: 'article-links', label: 'Internal Links', icon: <Link2 className="h-[18px] w-[18px]" />, badge: articleBadges?.links, badgeVariant: articleBadges?.linksVariant || 'grey' },
    { id: 'article-images', label: 'Images', icon: <ImageIcon className="h-[18px] w-[18px]" />, badge: articleBadges?.images, badgeVariant: articleBadges?.imagesVariant || 'grey' },
    { id: 'article-seo', label: 'SEO', icon: <BarChart3 className="h-[18px] w-[18px]" />, badge: articleBadges?.seo, badgeVariant: articleBadges?.seoVariant || 'grey' },
  ]

  const guideCreateItems: NavItem[] = [
    { id: 'guide-new', label: 'New Ultimate Guide', icon: <PlusCircle className="h-[18px] w-[18px]" /> },
  ]

  const guideWorkflowItems: NavItem[] = [
    { id: 'guide-products',  label: 'Products',  icon: <Package className="h-[18px] w-[18px]" />,   badge: guideBadges?.products,  badgeVariant: guideBadges?.productsVariant || 'grey' },
    { id: 'guide-generate',  label: 'Content',   icon: <FileText className="h-[18px] w-[18px]" />,  badge: guideBadges?.content,   badgeVariant: guideBadges?.contentVariant  || 'grey' },
    { id: 'guide-images',    label: 'Images',    icon: <ImageIcon className="h-[18px] w-[18px]" />, badge: guideBadges?.images,    badgeVariant: guideBadges?.imagesVariant  || 'grey' },
    { id: 'guide-publish',   label: 'Publish',   icon: <BarChart3 className="h-[18px] w-[18px]" /> },
  ]

  const contentBrainItems: NavItem[] = [
    { id: 'content-brain', label: 'Content Map', icon: <BookOpen className="h-[18px] w-[18px]" /> },
    { id: 'content-brain-table', label: 'Content Brain', icon: <List className="h-[18px] w-[18px]" /> },
    { id: 'content-brain-settings', label: 'Settings', icon: <Wrench className="h-[18px] w-[18px]" /> },
  ]

  const libraryItems: NavItem[] = [
    { id: 'library', label: 'Articles', icon: <FolderOpen className="h-[18px] w-[18px]" />, badge: articleCounts ? `${articleCounts.drafts + articleCounts.published}` : undefined, badgeVariant: 'grey' },
    { id: 'guide-library', label: 'Guides', icon: <List className="h-[18px] w-[18px]" />, badge: guideCounts ? `${guideCounts.drafts + guideCounts.published}` : undefined, badgeVariant: 'grey' },
    { id: 'queue', label: 'Queue', icon: <Clock className="h-[18px] w-[18px]" /> },
    { id: 'resources', label: 'Resources', icon: <Database className="h-[18px] w-[18px]" /> },
    { id: 'products', label: 'Products', icon: <Package className="h-[18px] w-[18px]" /> },
    { id: 'collections', label: 'Collections', icon: <Layers className="h-[18px] w-[18px]" /> },
    { id: 'workshop', label: 'Workshop', icon: <Wrench className="h-[18px] w-[18px]" /> },
  ]

  const videoItems: NavItem[] = [
    { id: 'video-scripts', label: 'Video Scripts', icon: <Video className="h-[18px] w-[18px]" /> },
  ]

  const toolsItems: NavItem[] = [
    { id: 'quality', label: 'Quality', icon: <ShieldCheck className="h-[18px] w-[18px]" /> },
    { id: 'revamp', label: 'Revamp', icon: <RefreshCw className="h-[18px] w-[18px]" /> },
    { id: 'image-studio', label: 'Image Studio', icon: <Sparkles className="h-[18px] w-[18px]" /> },
  ]

  function renderNavItem(item: NavItem) {
    const isActive = activeView === item.id
    return (
      <button
        key={item.id}
        onClick={() => onNavigate(item.id)}
        className={cn(
          'flex w-full items-center gap-2.5 border-l-[2.5px] px-4 py-[7px] text-[13px] transition-all select-none',
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
        <span className="flex-1 text-left">{item.label}</span>
        {item.badge && (
          <span
            className="ml-auto rounded-[10px] px-[7px] py-px text-[10px] font-mono font-medium"
            style={{
              background: item.badgeVariant === 'green' ? 'var(--gtd-accent-light)' : item.badgeVariant === 'amber' ? 'rgba(212,147,10,0.1)' : 'var(--surface2)',
              color: item.badgeVariant === 'green' ? 'var(--gtd-accent)' : item.badgeVariant === 'amber' ? '#d4930a' : 'var(--text4)',
            }}
          >
            {item.badge}
          </span>
        )}
      </button>
    )
  }

  function renderSectionLabel(label: string, icon?: React.ReactNode) {
    return (
      <div
        className="flex items-center gap-1.5 px-4 pt-3.5 pb-1.5 text-[9px] font-medium tracking-[1.5px] uppercase font-mono"
        style={{ color: 'var(--text4)' }}
      >
        {icon && <span className="opacity-60">{icon}</span>}
        {label}
      </div>
    )
  }

  return (
    <aside className="flex h-full flex-col overflow-y-auto border-r pt-3.5" style={{ background: 'var(--bg-warm)', borderColor: 'var(--border)' }}>

      {/* ââ Blog Articles ââ */}
      {renderSectionLabel('Content Brain', <BookOpen className="h-3 w-3" />)}
      {contentBrainItems.map(renderNavItem)}
      <div className="mx-4 my-2 h-px" style={{ background: 'var(--border)' }} />
      {renderSectionLabel('Articles')}
      {createItems.map(renderNavItem)}

      {hasCurrentArticle && (
        <>
          <div className="mx-4 my-2 h-px" style={{ background: 'var(--border)' }} />
          {renderSectionLabel('Current Article')}
          {articleItems.map(renderNavItem)}
        </>
      )}

      {/* ââ Ultimate Guides ââ */}
      <div className="mx-4 my-2 h-px" style={{ background: 'var(--border)' }} />
      {renderSectionLabel('Library')}
      {libraryItems.map(renderNavItem)}
      <div className="mx-4 my-2 h-px" style={{ background: 'var(--border)' }} />
      {renderSectionLabel('Video', <Video className="h-3 w-3" />)}
      {videoItems.map(renderNavItem)}
      <div className="mx-4 my-2 h-px" style={{ background: 'var(--border)' }} />
      {renderSectionLabel('Ultimate Guides', <BookOpen className="h-3 w-3" />)}
      {guideCreateItems.map(renderNavItem)}

      {hasCurrentGuide && (
        <>
          <div className="mx-4 mt-1 mb-0 h-px" style={{ background: 'var(--border)', opacity: 0.5 }} />
          {renderSectionLabel('Current Guide')}
          {guideWorkflowItems.map(renderNavItem)}
        </>
      )}

      {/* ââ Library ââ */}
      

      {/* u2500u2500 Tools u2500u2500 */}
      <div className="mx-4 my-2 h-px" style={{ background: 'var(--border)' }} />
      {/* ââ Workflow Mini-Tracker ââ */}
            {/* Tools */}
      <div className="mx-4 my-2 h-px" style={{ background: 'var(--border)' }} />
      {renderSectionLabel('Tools', <Sparkles className="h-3 w-3" />)}
      {toolsItems.map(renderNavItem)}

      {workflowSteps && workflowSteps.length > 0 && (
        <>
          <div className="mx-4 my-2 h-px" style={{ background: 'var(--border)' }} />
          <div className="px-4 py-3">
            <div
              className="mb-2.5 text-[9px] font-mono font-medium tracking-[1.2px] uppercase"
              style={{ color: 'var(--text4)' }}
            >
              Workflow
            </div>
            <div className="flex flex-col">
              {workflowSteps.map((step, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2 py-1 text-[12px]" style={{
                    color: step.status === 'done' ? 'var(--gtd-accent)' : step.status === 'current' ? 'var(--text1)' : 'var(--text4)',
                    fontWeight: step.status === 'current' ? 500 : 400,
                  }}>
                    <div
                      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-mono"
                      style={{
                        border: '1.5px solid',
                        borderColor: step.status === 'done' ? 'var(--gtd-accent)' : step.status === 'current' ? 'var(--text2)' : 'var(--border)',
                        background: step.status === 'done' ? 'var(--gtd-accent-light)' : step.status === 'current' ? 'var(--surface)' : 'transparent',
                        color: step.status === 'done' ? 'var(--gtd-accent)' : step.status === 'current' ? 'var(--text1)' : 'var(--text4)',
                      }}
                    >
                      {step.status === 'done' ? <Check className="h-2.5 w-2.5" /> : i + 1}
                    </div>
                    {step.label}
                  </div>
                  {i < workflowSteps.length - 1 && (
                    <div
                      className="ml-[8px] h-2 w-[1.5px]"
                      style={{
                        background: step.status === 'done' ? 'var(--gtd-accent)' : 'var(--border)',
                        opacity: step.status === 'done' ? 0.35 : 1,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
