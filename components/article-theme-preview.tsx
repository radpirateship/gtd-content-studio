'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { buildBlogPreviewDocument } from '@/lib/blog-theme-css'

/**
 * Renders article body_html exactly as the live theme will, by loading the real
 * ppw-collections.css and ppw-blog.css into a sandboxed iframe. Same approach
 * the collection preview uses.
 *
 * Why an iframe rather than dangerouslySetInnerHTML into the app DOM:
 *   1. ppwb- classes have no styling inside the app, so previews were unstyled
 *      and there was no way to check an article before publishing.
 *   2. A legacy (v1) article carries its own <style> block, which leaks into
 *      and restyles the app when injected directly.
 *
 * Height is measured from the iframe's content so the preview grows with the
 * page instead of trapping the reader in a nested scrollbar.
 */
export function ArticleThemePreview({ html, minHeight = 600 }: { html: string; minHeight?: number }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(minHeight)

  const resize = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc?.documentElement) return
    const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0)
    if (h > 0) setHeight(Math.max(h + 24, minHeight))
  }, [minHeight])

  useEffect(() => {
    const t1 = setTimeout(resize, 250)    // after webfonts settle
    const t2 = setTimeout(resize, 1200)   // after images
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [html, resize])

  return (
    <iframe
      ref={frameRef}
      title="Article preview"
      sandbox="allow-same-origin"
      onLoad={resize}
      srcDoc={buildBlogPreviewDocument(html)}
      style={{ width: '100%', height, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}
    />
  )
}
