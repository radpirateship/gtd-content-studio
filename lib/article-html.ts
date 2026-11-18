import { GTD_STYLES } from './gtd-template'
import { isV2ArticleHtml } from './article-v2'

const STYLE_BLOCK_REGEX = /<style\b[^>]*>[\s\S]*?<\/style>/gi
const SCRIPT_BLOCK_REGEX = /<script\b[^>]*>[\s\S]*?<\/script>/gi
const HTML_SHELL_REGEX = /<\/?(?:html|head|body)\b[^>]*>/gi
const DOCTYPE_REGEX = /<!doctype[^>]*>/gi

export function isLegacyArticleDocumentHtml(html: string | null | undefined): boolean {
  if (!html) return false
  return /class=["'][^"']*gtd-wrap[^"']*["']/i.test(html)
    || /<article\b[^>]*class=["'][^"']*gtd-article[^"']*["']/i.test(html)
    || /<style\b/i.test(html)
}

function unwrapLegacyArticleShell(html: string): string {
  const articleMatch = html.match(/<article\b[^>]*class=["'][^"']*gtd-article[^"']*["'][^>]*>([\s\S]*?)<\/article>/i)
  if (articleMatch?.[1]) return articleMatch[1].trim()

  const wrapMatch = html.match(/<div\b[^>]*class=["'][^"']*gtd-wrap[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
  if (wrapMatch?.[1]) return wrapMatch[1].trim()

  return html
}

function stripDocumentNoise(html: string): string {
  return html
    .replace(DOCTYPE_REGEX, '')
    .replace(STYLE_BLOCK_REGEX, '')
    .replace(SCRIPT_BLOCK_REGEX, '')
    .replace(HTML_SHELL_REGEX, '')
    .trim()
}

export function normalizeArticleBodyHtml(html: string | null | undefined): string {
  if (!html) return ''

  // template_version 2 owns its own markup and image behaviour: .gtdb-article
  // is the wrapper, and gtd-blog.css sets max-width/height/opacity on images.
  // Unwrapping or patching it here would undo both. Pass it straight through.
  if (isV2ArticleHtml(html)) return html.trim()

  let normalized = html.trim()
  normalized = unwrapLegacyArticleShell(normalized)
  normalized = stripDocumentNoise(normalized)

  // Remove any leftover wrapper divs around the article body.
  normalized = normalized.replace(
    /^<div\b[^>]*class=["'][^"']*gtd-wrap[^"']*["'][^>]*>([\s\S]*?)<\/div>$/i,
    '$1'
  )
  normalized = normalized.replace(
    /^<article\b[^>]*class=["'][^"']*gtd-article[^"']*["'][^>]*>([\s\S]*?)<\/article>$/i,
    '$1'
  )

  // Strip loading="lazy" from <img>. The live theme has a CSS rule
  // `img[loading="lazy"] { opacity: 0 }` that expects lazysizes JS to
  // add a class which flips opacity back. Our plain <img> tags don't
  // use lazysizes attributes, so the rule makes published images
  // invisible. Removing the attribute is fine — the browser still
  // loads images normally and the page paints them.
  normalized = normalized.replace(/(<img\b[^>]*?)\s+loading=["']lazy["']/gi, '$1')

  // Add max-width:100%;height:auto inline style to <img> tags that don't
  // already have a style attribute. The live Shopify theme has a cascade
  // conflict where a later rule sets max-width:1440px on images, making
  // them blow out to near-viewport width. Inline styles beat any class
  // selector, so this is the reliable fix without touching the theme.
  // Articles that use placeholder divs instead of <img> tags are unaffected.
  // Note: string concat avoids a template-literal parsing quirk in Node's
  // TypeScript stripper when the literal starts with `<img`.
  normalized = normalized.replace(
    /<img\b([^>]*?)>/gi,
    function (match, attrs) {
      if (/\bstyle\s*=/i.test(attrs)) return match
      return '<img' + attrs + ' style="max-width:100%;height:auto">'
    }
  )

  return normalized.trim()
}

export function buildArticleDocumentHtml(bodyHtml: string, options?: { includeStyles?: boolean }): string {
  // Version 2 is already a complete document: its own <article class="gtdb-article">
  // wrapper, and no <style> block because gtd-blog.css is a theme asset.
  // Wrapping it in the legacy shell would nest it inside v1 markup and reapply
  // the frozen v1 CSS. Return as-is.
  if (isV2ArticleHtml(bodyHtml)) return bodyHtml.trim()

  const normalizedBodyHtml = normalizeArticleBodyHtml(bodyHtml)
  const styleBlock = options?.includeStyles === false ? '' : `${GTD_STYLES}\n\n`

  return `${styleBlock}<div class="gtd-wrap" style="max-width:920px;margin:0 auto;text-align:start;">
<article class="gtd-container gtd-article" itemscope itemtype="https://schema.org/Article">

${normalizedBodyHtml}

</article>
</div>`.trim()
}

export function buildPreviewArticleHtml(bodyHtml: string): string {
  return buildArticleDocumentHtml(bodyHtml, { includeStyles: false })
}

export function getPublishableArticleHtml(html: string | null | undefined): string {
  const bodyHtml = normalizeArticleBodyHtml(html)
  return buildArticleDocumentHtml(bodyHtml)
}

export function articleHasOverviewSection(html: string | null | undefined): boolean {
  const bodyHtml = normalizeArticleBodyHtml(html)
  return /<section\b[^>]*id=["']overview["'][^>]*>/i.test(bodyHtml)
    || /<div\b[^>]*class=["'][^"']*gtd-kicker[^"']*["'][^>]*>/i.test(bodyHtml)
    || /<h1\b/i.test(bodyHtml)
}

export function articleHasHeroMedia(html: string | null | undefined): boolean {
  const bodyHtml = normalizeArticleBodyHtml(html)
  return /class=["'][^"']*gtd-content-image[^"']*["']/i.test(bodyHtml)
    || /class=["'][^"']*gtd-hero-placeholder[^"']*["']/i.test(bodyHtml)
}
