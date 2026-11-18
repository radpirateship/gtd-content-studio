// ============================================================================
// lib/collectionGrade.ts — Collection-page structural grader.
//
// Implements docs/GTD_Collection_Page_Rules.md FAITHFULLY (July 2026 rebuild —
// the earlier version was a partial distillation and was never wired into the
// audit queue). Every check cites the rule it enforces. Pure function, no I/O.
//
// Used by /api/collections/grade-all alongside computeSeoGrade (keyword
// rubric); the queue stores the combined 50/50 score.
// ============================================================================
import { BANNED_PHRASES } from './brandRules'
import { BRAND_COLLECTIONS } from './collection-link-map'

// Rules doc "General Formatting Rules" banned list (merged with brandRules).
export const DOC_BANNED: string[] = [
  'straightforward', 'honestly', 'genuinely', 'seamlessly', 'elevate your',
  'dive into', 'delve into', 'comprehensive solution', 'we are committed to',
]
const GENERIC_BULLET_OPENERS = /^(premium|high-quality|exceptional)\b/i
// -copy or single non-zero digit only; zero-padded -01 endings are model numbers.
const DUP_HANDLE = /(-copy\b|-[1-9]\b)(?=["'/?#]|$)/i
const BRAND_NAMES = BRAND_COLLECTIONS.map((b) => b.name.toLowerCase())

export type CheckStatus = 'pass' | 'warn' | 'fail'
export interface GradeCheck { id: string; label: string; status: CheckStatus; detail: string }

export interface CollectionGradeInput {
  title: string
  seoTitle: string
  seoDescription: string
  bodyHtml: string
  productCount?: number | null
  primaryKeyword?: string | null
  /** Brand collection pages grade against docs/GTD_Brand_Collection_Page_Rules.md */
  isBrand?: boolean
}

export interface CollectionGradeResult {
  score: number
  severity: number
  failCount: number
  warnCount: number
  checks: GradeCheck[]
  topIssues: string[]
}

// ── helpers ─────────────────────────────────────────────────────────────────
const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')

function toText(html: string): string {
  return decode(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}
const norm = (s: string) => decode(s).replace(/\s+/g, ' ').trim().toLowerCase()

// Plural/singular-tolerant keyword matching (doc keywords drift vs live copy).
function kwRe(kw: string, anchored = false): RegExp | null {
  const pattern = kw.toLowerCase().trim().split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, '').replace(/([^s])s$/, '$1') + 's?')
    .filter((w) => w.length > 2)
    .join('[\\s-]+')
  if (!pattern) return null
  try { return new RegExp((anchored ? '^\\s*' : '') + pattern, 'i') } catch { return null }
}
const kwIn = (text: string, kw: string) => { const r = kwRe(kw); return r ? r.test(text) : text.toLowerCase().includes(kw.toLowerCase()) }
const kwLeads = (text: string, kw: string) => { const r = kwRe(kw, true); return r ? r.test(text) : text.toLowerCase().startsWith(kw.toLowerCase()) }

function extractJsonLd(html: string): any[] {
  const blocks: any[] = []
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) blocks.push(...parsed)
      else if (parsed['@graph'] && Array.isArray(parsed['@graph'])) blocks.push(...parsed['@graph'])
      else blocks.push(parsed)
    } catch { /* malformed = missing */ }
  }
  return blocks
}
const findType = (blocks: any[], type: string) =>
  blocks.find((b) => b && (b['@type'] === type || (Array.isArray(b['@type']) && b['@type'].includes(type)))) || null

function h2Sections(html: string): { heading: string; body: string; index: number }[] {
  const out: { heading: string; body: string; index: number }[] = []
  const matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? html.length) : html.length
    out.push({ heading: toText(matches[i][1]), body: html.slice(start, end), index: start })
  }
  return out
}

function visibleFaqQuestions(html: string): string[] {
  const qs: string[] = []
  for (const m of html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/gi)) {
    // question lives in the first <span>; later spans are toggle chevrons (⌄/+/−)
    const firstSpan = m[1].match(/<span[^>]*>([\s\S]*?)<\/span>/i)
    qs.push(toText(firstSpan ? firstSpan[1] : m[1]).replace(/[+−⌄⌄ˇ]\s*$/, '').trim())
  }
  for (const m of html.matchAll(/<button[^>]*class="[^"]*gtd-acc-btn[^"]*"[^>]*>([\s\S]*?)<\/button>/gi)) qs.push(toText(m[1]).replace(/[+−-]\s*$/, '').trim())
  return qs.filter(Boolean)
}

// ── grader ──────────────────────────────────────────────────────────────────
export function gradeCollection(input: CollectionGradeInput): CollectionGradeResult {
  const { title, seoTitle, seoDescription, bodyHtml, productCount, primaryKeyword, isBrand } = input
  const html = bodyHtml || ''
  const text = toText(html)
  const lower = text.toLowerCase()
  const pk = (primaryKeyword || '').toLowerCase().trim()
  const checks: GradeCheck[] = []
  const add = (id: string, label: string, status: CheckStatus, detail: string) =>
    checks.push({ id, label, status, detail })

  // Pre-Generation Gate REMOVED per Ryan (July 2026): distributors are being
  // added, thin collections get optimized like everything else. productCount
  // is kept in the input for display only, never scored.

  // Rule: Title and H1. Category: keyword leads + commercial form.
  // Brand: brand name leads + product-type descriptor present (no "for sale").
  if (pk) {
    const t = title || ''
    const hasPk = kwIn(t, pk)
    const leads = kwLeads(t, pk)
    if (isBrand) {
      const words = t.trim().split(/\s+/)
      const hasDescriptor = words.length >= 2
      add('h1_commercial', 'H1: [Brand] [Product Type]',
        hasDescriptor && hasPk ? 'pass' : hasPk ? 'warn' : 'fail',
        hasDescriptor ? `"${title}"` : `"${title}" — brand name alone, add a product category descriptor`)
    } else {
      const commercial = /for sale/i.test(title || '') || /for sale/.test(pk)
      add('h1_commercial', 'H1: keyword leads, commercial form',
        !hasPk ? 'fail' : leads && commercial ? 'pass' : 'warn',
        `keyword ${hasPk ? (leads ? 'leads' : 'present but not leading') : 'MISSING'};${commercial ? '' : ' no commercial modifier ("for Sale")'} title="${title}"`)
    }
  }

  // Rule: Meta Title — [Primary] | [Secondary], ≤60 hard
  {
    const tl = (seoTitle || '').length
    const notes: string[] = []
    let st: CheckStatus = 'pass'
    if (!seoTitle) { st = 'fail'; notes.push('missing (never let Shopify auto-generate)') }
    else {
      if (tl > 60) { st = tl > 70 ? 'fail' : 'warn'; notes.push(`${tl} chars (hard limit 60)`) }
      // pipe-brand suffixes ("| Green Thumb Depot") are explicitly NOT
      // wanted (Ryan, Aug 3) — colon-style differentiator titles are the norm
      if (pk && !kwLeads(seoTitle, pk)) { if (st === 'pass') st = 'warn'; notes.push('primary keyword not first') }
    }
    add('meta_title', 'Meta title format', st, notes.join('; ') || `${tl} chars, piped, keyword-first`)
  }

  // Rule: Meta Description — 150-160, price anchor, brand, CTA
  {
    const d = seoDescription || ''
    const notes: string[] = []
    let st: CheckStatus = 'pass'
    if (!d) { st = 'fail'; notes.push('missing') }
    else {
      if (d.length < 140 || d.length > 160) { st = d.length < 120 || d.length > 175 ? 'fail' : 'warn'; notes.push(`${d.length} chars (want 140-160)`) }
      // House rule (25 Oct 2026): no prices in metas or copy, they go stale. A figure is a warning, not a requirement.
      if (/\$\s?\d/.test(d)) { if (st === 'pass') st = 'warn'; notes.push('carries a price figure (house rule: none)') }
      if (!/(shop|browse|explore|find|get|compare|see|discover)\b/i.test(d)) { if (st === 'pass') st = 'warn'; notes.push('no commercial CTA') }
    }
    add('meta_description', 'Meta description format', st, notes.join('; ') || 'length + CTA ok, no price')
  }

  const sections = h2Sections(html)

  // Rule: First H2 — [Keyword Variant] — [Differentiator]
  if (sections.length > 0 && pk) {
    const h = sections[0].heading
    const hasDash = h.includes('—')
    const hasKw = kwIn(h, pk) || pk.split(' ').every((w) => kwIn(h, w))
    add('first_h2', 'First H2: keyword — differentiator',
      hasKw && hasDash ? 'pass' : hasKw || hasDash ? 'warn' : 'fail',
      `"${h.slice(0, 70)}" (keyword:${hasKw ? '✓' : '✗'} em-dash separator:${hasDash ? '✓' : '✗'})`)
  }

  // Rule: Em-Dash — ONLY allowed in first H2
  {
    const firstH2Dashes = sections.length ? (sections[0].heading.match(/—/g) || []).length : 0
    const total = (text.match(/—/g) || []).length
    const illegal = Math.max(0, total - firstH2Dashes)
    add('em_dash_rule', 'Em dashes only in first H2', illegal === 0 ? 'pass' : 'fail',
      illegal ? `${illegal} em dash(es) outside the first H2` : 'clean')
  }

  // Rule: Overview Intro — brands in first 2 sentences, price anchor in first para
  {
    const intro = text.slice(0, 500)
    const firstTwoSentences = intro.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').toLowerCase()
    const brandEarly = BRAND_NAMES.some((b) => firstTwoSentences.includes(b))
    const priceInIntro = /\$\s?\d/.test(intro)
    // House rule (25 Oct 2026): no price anchor; a figure in the intro is the thing to fix.
    add('intro_rules', 'Intro: brands early, no price figure',
      priceInIntro ? 'warn' : brandEarly ? 'pass' : 'warn',
      `brands in first 2 sentences:${brandEarly ? '✓' : '✗'} price figure in intro:${priceInIntro ? 'yes (remove)' : 'none'}`)
  }

  // Rule: Overview Bullets — ≤6, bold-label-colon, no generic openers, no em dashes
  {
    const firstUl = html.match(/<ul[^>]*>([\s\S]*?)<\/ul>/i)
    if (firstUl) {
      const lis = [...firstUl[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1])
      const notes: string[] = []
      if (lis.length > 6) notes.push(`${lis.length} bullets (max 6)`)
      const noLabel = lis.filter((li) => !/<(strong|b)[^>]*>[^<]{2,40}:?<\/(strong|b)>\s*:?/i.test(li)).length
      if (noLabel > 0) notes.push(`${noLabel} bullet(s) without bold label + colon`)
      const generic = lis.filter((li) => GENERIC_BULLET_OPENERS.test(toText(li))).length
      if (generic > 0) notes.push(`${generic} bullet(s) start with generic adjective`)
      const dashy = lis.filter((li) => toText(li).includes('—')).length
      if (dashy > 0) notes.push(`${dashy} bullet(s) contain em dashes`)
      add('overview_bullets', 'Overview bullet format', notes.length === 0 ? 'pass' : dashy || noLabel > 2 ? 'fail' : 'warn',
        notes.join('; ') || `${lis.length} bullets, labeled, clean`)
    }
  }

  // Rules: FAQ count / position / first questions / schema match
  const faqQs = visibleFaqQuestions(html)
  const faqSection = sections.find((s) => /frequently asked|faq/i.test(s.heading))
  add('faq_count', 'FAQ count (12-14)',
    faqQs.length >= 12 && faqQs.length <= 14 ? 'pass' : faqQs.length >= 10 && faqQs.length <= 16 ? 'warn' : 'fail',
    `${faqQs.length} visible question(s)`)

  if (faqSection) {
    // v2 design (class="gtd-collection"): FAQ intentionally closes the page
    const isV2 = /class="gtd-collection"/.test(html)
    const featIdx = sections.find((s) => /featured/i.test(s.heading))?.index ?? Infinity
    add('faq_position', 'FAQ position',
      isV2 || faqSection.index < featIdx ? 'pass' : 'warn',
      isV2 ? 'v2 design: FAQ closes the page' : faqSection.index < featIdx ? 'ordered correctly' : 'FAQ appears after featured products')
  }

  if (faqQs.length >= 2) {
    const q1ok = /^what is the best/i.test(faqQs[0])
    const q2ok = /compare/i.test(faqQs[1])
    add('faq_intent_questions', 'FAQ opens with commercial-intent Qs',
      q1ok && q2ok ? 'pass' : 'warn',
      `Q1 "What is the best...":${q1ok ? '✓' : '✗'} Q2 brand comparison:${q2ok ? '✓' : '✗'}`)
  }

  const jsonld = extractJsonLd(html)
  const faqSchema = findType(jsonld, 'FAQPage')
  const schemaQs: string[] = faqSchema && Array.isArray(faqSchema.mainEntity)
    ? faqSchema.mainEntity.map((e: any) => norm(String(e?.name || ''))).filter(Boolean)
    : []
  if (!faqSchema) {
    add('faq_schema', 'FAQPage schema', 'fail', 'missing FAQPage JSON-LD')
  } else {
    const visSet = new Set(faqQs.map(norm))
    const schemaSet = new Set(schemaQs)
    const missingFromSchema = [...visSet].filter((q) => !schemaSet.has(q)).length
    const extraInSchema = [...schemaSet].filter((q) => !visSet.has(q)).length
    add('faq_schema', 'FAQ schema matches visible exactly',
      missingFromSchema === 0 && extraInSchema === 0 ? 'pass' : 'fail',
      missingFromSchema || extraInSchema
        ? `${missingFromSchema} visible not in schema; ${extraInSchema} in schema not visible`
        : `${schemaQs.length} questions, exact match`)
  }

  // Rule: Schema ItemList — 4 products, order matches page, clean handles, name field
  const itemList = findType(jsonld, 'ItemList')
  const pageProductUrls = [...html.matchAll(/href=["']([^"']*\/products\/[^"'?#]+)["']/gi)].map((m) => m[1])
  if (!itemList) {
    add('schema_itemlist', 'ItemList schema', 'fail', 'missing ItemList JSON-LD')
  } else {
    const els: any[] = Array.isArray(itemList.itemListElement) ? itemList.itemListElement : []
    const urls = els.map((e) => String(e?.url || e?.item?.url || '')).filter(Boolean)
    const notes: string[] = []
    if (els.length < 3 || els.length > 12) notes.push(`${els.length} items (want 3-4 category, up to 12 brand)`)
    const dups = urls.filter((u) => DUP_HANDLE.test(u))
    if (dups.length) notes.push(`duplicate-handle URL(s): ${dups.slice(0, 2).join(', ')}`)
    const pageSet = new Set(pageProductUrls.map((u) => u.replace(/^https?:\/\/[^/]+/, '')))
    const mismatched = urls.filter((u) => !pageSet.has(u.replace(/^https?:\/\/[^/]+/, ''))).length
    if (mismatched > 0 && pageProductUrls.length > 0) notes.push(`${mismatched} schema URL(s) not on page`)
    if (!/^(Featured .+|.+ Products) at Green Thumb Depot$/i.test(String(itemList.name || ''))) notes.push('name field not "Featured [X] / [Brand] Products at Green Thumb Depot"')
    add('schema_itemlist', 'ItemList schema (synced, clean)',
      dups.length || mismatched ? 'fail' : notes.length ? 'warn' : 'pass',
      notes.join('; ') || '4 items, synced with page')
  }

  // BreadcrumbList (T5, docs/GTD_Collection_14_Tasks.md): required in the
  // body @graph — Home + collection. Warn-level since some theme setups also
  // emit one at template level.
  {
    const bc = findType(jsonld, 'BreadcrumbList')
    add('schema_breadcrumb', 'BreadcrumbList in @graph', bc ? 'pass' : 'warn', bc ? 'present' : 'missing (T5)')
  }

  // Rule: Featured Products — 4 cards, tier badges, live prices, exact CTA
  {
    const featSection = sections.find((s) => /featured|recommend first|models to start/i.test(s.heading))
    const scope = featSection ? featSection.body : html
    const cards = (scope.match(/class=["'][^"']*gtd-(?:card|product|hv-gold)[^"']*["']/gi) || []).length
    const ctas = (scope.match(/view (?:product details|model)/gi) || []).length
    const prices = (scope.match(/\$\s?\d[\d,]*/g) || []).length
    const dupLinks = [...scope.matchAll(/href=["']([^"']*\/products\/[^"']+)["']/gi)].filter((m) => DUP_HANDLE.test(m[1])).length
    const notes: string[] = []
    if (cards === 0) { add('featured_products', 'Featured products (tiered picks)', 'fail', 'no product cards found') }
    else {
      if (cards < 3 || cards > 4) notes.push(`${cards} cards (want 3-4)`)
      if (ctas < Math.min(cards, 4)) notes.push(`${ctas}/${cards} view CTAs`)
      if (prices > 0) notes.push(`${prices} static price(s) in cards (house rule: none, the product grid shows live prices)`)
      if (dupLinks) notes.push(`${dupLinks} duplicate-handle link(s)`)
      add('featured_products', 'Featured products (tiered picks)',
        dupLinks ? 'fail' : notes.length ? 'warn' : 'pass',
        notes.join('; ') || `${cards} cards, CTAs`)
    }
  }

  // Rule: Buying Guide. Category: required, replaces comparison table.
  // Brand: conditional — the compare table IS the navigation tool and stays.
  {
    const bg = sections.find((s) => /buying guide|how to choose/i.test(s.heading))
    if (isBrand) {
      const hasCompare = sections.some((s) => /compare/i.test(s.heading)) || /<table\b/i.test(html)
      add('buying_guide', 'Brand nav: compare table present', hasCompare ? 'pass' : 'warn',
        hasCompare ? 'compare table present (primary brand navigation)' : 'no compare table — brand pages should have one')
    } else if (!bg) add('buying_guide', 'Buying guide section', 'fail', 'missing "Buying Guide" H2')
    else {
      // July 31 rule: compare tables COEXIST with the buying guide on
      // qualifying collections (median-price gate) — a table is no longer a
      // buying-guide violation.
      const cards = (bg.body.match(/class=["'][^"']*gtd-(?:card|hv-lift)/gi) || []).length
      const notes: string[] = []
      if (cards !== 3 && cards > 0) notes.push(`${cards} cards (want 3)`)
      add('buying_guide', 'Buying guide (3 cards)', notes.length ? 'warn' : 'pass', notes.join('; ') || '3 cards')
    }
  }

  // Rule: Key Benefits — 4 cards, emoji, outcome-named H3s
  {
    const kb = sections.find((s) => /key benefits/i.test(s.heading))
    if (!kb) add('key_benefits', 'Key Benefits section', 'fail', 'missing "Key Benefits" H2')
    else {
      const h3s = (kb.body.match(/<h3\b/gi) || []).length
      const hasEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(kb.body)
      const notes: string[] = []
      if (h3s !== 4) notes.push(`${h3s} benefit cards (want 4)`)
      if (!hasEmoji) notes.push('no emoji icons')
      add('key_benefits', 'Key Benefits (4 cards + emoji)', notes.length ? 'warn' : 'pass', notes.join('; ') || '4 cards')
    }
  }

  // Rule: Care and Warranty — 3 H3 subsections
  {
    const care = sections.find((s) => /care|warranty|maintenance/i.test(s.heading))
    if (!care) add('care_structure', 'Care & Warranty section', 'warn', 'missing care/warranty H2')
    else {
      const h3s = [...care.body.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => toText(m[1]).toLowerCase())
      // v1: Cleaning/Maintenance/Warranty. v2 equipment: Shipping/Setup/Warranty/Care.
      // v2 accessory: Warranty/Care/Returns.
      const wants = [/clean|care/i, /maintenance|install|return|shipping/i, /warranty/i]
      const covered = wants.filter((w) => h3s.some((h) => w.test(h))).length
      add('care_structure', 'Care/ownership subsections',
        covered === 3 ? 'pass' : covered >= 1 ? 'warn' : 'fail',
        `${covered}/3 subsections present (${h3s.length} H3s)`)
    }
  }

  // Rule: Learning Resources — "Complete [X] Learning Center", ≥4 blog links
  {
    const lc = sections.find((s) => /learning center/i.test(s.heading))
    const blogLinks = new Set([...html.matchAll(/href=["']([^"']*\/blogs\/[^"'#]+)["']/gi)].map((m) => m[1])).size
    const notes: string[] = []
    if (!lc) notes.push('no "Complete [Category] Learning Center" H2')
    else if (!/^complete .+ learning center$/i.test(lc.heading.trim())) notes.push(`heading "${lc.heading.slice(0, 50)}" (want "Complete [X] Learning Center")`)
    if (blogLinks < 4) notes.push(`${blogLinks} blog link(s) (want ≥4, 1 pillar + 3 cluster)`)
    add('learning_center', 'Learning Center (≥4 blog links)',
      blogLinks >= 4 && lc ? (notes.length ? 'warn' : 'pass') : blogLinks >= 1 ? 'warn' : 'fail',
      notes.join('; ') || `${blogLinks} blog links, correct heading`)
  }

  // Rule: Shipping Claims — "free shipping" only in delivery section
  {
    const delivery = sections.find((s) => /delivery|shipping/i.test(s.heading))
    const claims = [...html.matchAll(/free shipping/gi)]
    if (claims.length === 0) add('shipping_claims', 'Shipping claims', 'pass', 'no blanket claims')
    else {
      const outside = delivery
        ? claims.filter((m) => (m.index ?? 0) < delivery.index || (m.index ?? 0) > delivery.index + delivery.body.length).length
        : claims.length
      add('shipping_claims', 'Free shipping only in delivery section', outside === 0 ? 'warn' : 'fail',
        outside ? `${outside} "free shipping" claim(s) outside delivery section` : 'in delivery section only — verify accuracy')
    }
  }

  // Rule: Banned phrases (doc list + brand rules + Discover opener + "covered" pattern)
  {
    const all = [...new Set([...BANNED_PHRASES, ...DOC_BANNED])]
    const found = all.filter((p) => lower.includes(p.toLowerCase()))
    if (/whether you('| a)re [^.]{3,60}(covered|we have)/i.test(text)) found.push('"Whether you are X or Y..." pattern')
    for (const m of html.matchAll(/<(p|h2|h3)[^>]*>\s*discover\b/gi)) { found.push('"Discover" opener'); break }
    add('banned_phrases', 'Banned phrases / AI tells', found.length ? 'fail' : 'pass',
      found.length ? [...new Set(found)].slice(0, 6).join('; ') : 'clean')
  }

  // ── score ──
  const failCount = checks.filter((c) => c.status === 'fail').length
  const warnCount = checks.filter((c) => c.status === 'warn').length
  const total = checks.length
  const passCount = total - failCount - warnCount
  const score = total ? Math.round(((passCount + warnCount * 0.5) / total) * 100) : 0
  const severity = failCount * 2 + warnCount
  const topIssues = [
    ...checks.filter((c) => c.status === 'fail'),
    ...checks.filter((c) => c.status === 'warn'),
  ].map((c) => c.label)

  return { score, severity, failCount, warnCount, checks, topIssues }
}
