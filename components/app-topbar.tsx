'use client'

export type AppMode = 'articles' | 'collections' | 'product-filters'

const MODE_LABELS: Record<AppMode, string> = {
  articles: 'Articles',
  collections: 'Collections',
  'product-filters': 'Product Filters',
}

interface AppTopbarProps {
  isGenerating?: boolean
  generationMessage?: string
  mode?: AppMode
  onModeChange?: (mode: AppMode) => void
}

export function AppTopbar({ isGenerating, generationMessage, mode = 'articles', onModeChange }: AppTopbarProps) {
  return (
    <header
      className="flex items-center gap-3 px-5 relative z-10"
      style={{
        gridColumn: '1 / -1',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        height: 'var(--header-h)',
      }}
    >
      {/* Logo */}
      <div className="font-serif font-semibold text-[17px] tracking-[-0.3px]" style={{ color: 'var(--gtd-accent)' }}>
        GTD
        <span className="font-normal text-[14px] ml-1" style={{ color: 'var(--text3)' }}>Content Studio</span>
      </div>

      {/* Mode switcher — distinct buttons */}
      <div className="ml-5 flex items-center gap-2">
        {(['articles', 'collections', 'product-filters'] as AppMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange?.(m)}
            className="rounded-[9px] px-5 py-2 text-[13.5px] transition-all"
            style={{
              background: mode === m ? 'var(--gtd-accent)' : 'var(--bg)',
              color: mode === m ? '#fff' : 'var(--text2)',
              fontWeight: mode === m ? 600 : 500,
              border: mode === m ? '1px solid var(--gtd-accent)' : '1px solid var(--border)',
              boxShadow: mode === m ? '0 2px 6px rgba(0,0,0,0.12)' : '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Generation status (only when active) */}
      {isGenerating && (
        <>
          <div className="h-6 w-px mx-1" style={{ background: 'var(--border)' }} />
          <span className="text-[12px]" style={{ color: 'var(--text3)' }}>
            {generationMessage || 'Generating...'}
          </span>
        </>
      )}

      {/* Right side */}
      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text2)' }}>
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full font-serif text-[12px] font-semibold"
            style={{
              background: 'var(--gtd-accent-light)',
              border: '1.5px solid var(--gtd-accent)',
              color: 'var(--gtd-accent)',
            }}
          >
            R
          </div>
          Ryan
        </div>
      </div>
    </header>
  )
}
