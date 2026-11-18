// ============================================================================
// lib/blog-theme-css.ts — copy of the Shopify theme asset gtd-blog.css, used
// ONLY to style in-app preview iframes (srcDoc). The live source of truth is
// the theme asset; update both together when the design changes.
//
// Mirrors lib/theme-css.ts, which does the same job for collection pages.
//
// BLOG_PREVIEW_HEAD loads Poppins, then the collection stylesheet, then this
// one, in the same order theme.liquid does. The collection sheet is included
// because template_version 2 articles reuse its .faq-modern accordion, and
// because loading both is what actually happens on the live site.
// ============================================================================

import { GTD_COLLECTIONS_CSS } from './theme-css'

export const GTD_BLOG_CSS = `/* ============================================================================
   gtd-blog.css, GTD blog article design system, v1 (Phase 1)
   Theme asset. Loaded in layout/theme.liquid alongside gtd-collections.css.

   NAMESPACE RULE: every class in this file is prefixed .gtdb-.
   No name here appears in the legacy blog CSS (GTD_STYLES) or in
   gtd-collections.css. Legacy articles keep their inline <style> block and
   render exactly as they do today. The one deliberate exception is
   .faq-modern, which is reused as-is from gtd-collections.css and is
   therefore NOT defined in this file.

   Sizes are in px throughout. This file never relies on the theme's ~10px
   root font size (the legacy rem scale is not carried over).
   ========================================================================= */

/* ---------------------------------------------------------------------------
   1. TOKENS
   Colour roles, fixed:
     navy  = structure  (headings, dark fills, solid CTAs)
     gold  = ornament   (kickers, numerals, rules, hover glow), never a link
     blue  = interactivity (inline links, small CTA text, chevrons)
   Gold never carries text at body size; use --gtdb-gold-ink (4.87:1).
   Body links use --gtdb-link #0A6BA3 (5.76:1), the brand blue darkened to
   clear WCAG AA. Brand blue #0A86CB is kept for large/non-text accents only.
------------------------------------------------------------------------- */
:root {
  --gtdb-navy:        #09195B;
  --gtdb-navy-deep:   #050F38;
  --gtdb-gold:        #C8A96E;
  --gtdb-gold-ink:    #8A6D2F;
  --gtdb-gold-soft:   rgba(200,169,110,.16);
  --gtdb-blue:        #0A86CB;
  --gtdb-link:        #0A6BA3;
  --gtdb-ink:         #12182B;
  --gtdb-body:        #333C52;
  --gtdb-muted:       #596183;
  --gtdb-cream:       #FAF7F1;
  --gtdb-gray:        #F8F8F8;
  --gtdb-border:      #E5E7EB;
  --gtdb-rule:        #DFE3EA;
  --gtdb-white:       #FFFFFF;
  --gtdb-warn:        #B45309;
  --gtdb-warn-bg:     #FFFBEB;

  --gtdb-font: Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

  /* Type scale, desktop values. Mobile overrides in section 12. */
  --gtdb-t-h1:      46px;
  --gtdb-t-deck:    20px;
  --gtdb-t-h2:      28px;
  --gtdb-t-h3:      20px;
  --gtdb-t-body:    18px;
  --gtdb-t-answer:  21px;
  --gtdb-t-small:   15px;
  --gtdb-t-meta:    12px;
  --gtdb-t-kicker:  11px;
  --gtdb-t-num:     34px;

  /* Spacing, 4px base */
  --gtdb-s1: 4px;  --gtdb-s2: 8px;  --gtdb-s3: 12px; --gtdb-s4: 16px;
  --gtdb-s5: 20px; --gtdb-s6: 24px; --gtdb-s7: 32px; --gtdb-s8: 48px;
  --gtdb-s9: 64px; --gtdb-s10: 96px;

  /* Rhythm, the only two vertical values a block should use */
  /* Vertical rhythm. Tightened Aug 2026: 40/64 read as airy in isolation but
     left too much dead space between sections once real articles carried
     callouts, spec strips and step lists. Mobile overrides are unchanged. */
  --gtdb-block:  32px;   /* gap between blocks inside a section */
  --gtdb-sectn:  48px;   /* gap between H2 sections */

  --gtdb-r-sm: 6px; --gtdb-r-md: 10px; --gtdb-r-lg: 12px; --gtdb-r-xl: 14px;
  --gtdb-shadow:      0 8px 22px rgba(0,0,0,.05);
  --gtdb-shadow-hov:  0 12px 30px rgba(0,0,0,.10);
  --gtdb-glow:        0 10px 26px rgba(200,169,110,.28);
  --gtdb-t-fast: .12s ease; --gtdb-t-base: .2s ease;

  /* Measure. Text column is 720px (~68 characters at 18px Poppins). */
  --gtdb-col:  720px;
  --gtdb-wide: 960px;
}

/* ---------------------------------------------------------------------------
   2. SHELL + MEASURE
   .gtdb-article is the single wrapper the generator emits. Everything inside
   sits on the 720px text column; .gtdb-wide opts a block out to 960px.
------------------------------------------------------------------------- */
/* Border-box, scoped. The live theme has no universal reset, only per-component
   Shopify selectors, so padded blocks inherited content-box and overflowed
   their wrapper. Every future block relies on this rule. */
.gtdb-article, .gtdb-article *, .gtdb-article *::before, .gtdb-article *::after { box-sizing: border-box; }

.gtdb-article {
  font-family: var(--gtdb-font);
  font-size: var(--gtdb-t-body);
  line-height: 1.72;
  color: var(--gtdb-body);
  -webkit-font-smoothing: antialiased;
  display: grid;
  grid-template-columns: 1fr min(var(--gtdb-col), 100% - 40px) 1fr;
  padding: 0 0 var(--gtdb-s10);
}
.gtdb-article > * { grid-column: 2; }
.gtdb-wide  { grid-column: 2; width: min(var(--gtdb-wide), 100%); justify-self: center; }
.gtdb-bleed { grid-column: 1 / -1; width: 100%; }

@media (min-width: 1040px) {
  .gtdb-wide { width: var(--gtdb-wide); max-width: none; margin-left: calc((var(--gtdb-col) - var(--gtdb-wide)) / 2); }
}

/* Images: behaviour is specified here so the publish pipeline can stop
   patching every <img> inline. Retires the loading="lazy" strip and the
   inline max-width workaround for template_version 2 articles. */
.gtdb-article img { max-width: 100%; height: auto; display: block; opacity: 1; }

/* ---------------------------------------------------------------------------
   3. TYPE
   Uppercase is structural only: kicker, H2, badges, CTA. Titles, H3s and
   body stay sentence case, this is a reading surface.
------------------------------------------------------------------------- */
.gtdb-kicker {
  font: 700 var(--gtdb-t-kicker)/1 var(--gtdb-font);
  letter-spacing: .18em; text-transform: uppercase;
  color: var(--gtdb-gold-ink);
  display: inline-flex; align-items: center; gap: var(--gtdb-s2);
}
.gtdb-kicker::before {
  content: ""; width: 22px; height: 2px; background: var(--gtdb-gold); flex: none;
}
.gtdb-h1 {
  font: 900 var(--gtdb-t-h1)/1.06 var(--gtdb-font);
  letter-spacing: -.02em; color: var(--gtdb-navy);
  margin: var(--gtdb-s5) 0 0; text-wrap: balance;
}
.gtdb-deck {
  font: 400 var(--gtdb-t-deck)/1.55 var(--gtdb-font);
  color: var(--gtdb-muted); margin: var(--gtdb-s4) 0 0; max-width: 62ch;
  text-wrap: pretty;
}
.gtdb-h2 {
  font: 800 var(--gtdb-t-h2)/1.15 var(--gtdb-font);
  letter-spacing: .02em; text-transform: uppercase; color: var(--gtdb-navy);
  margin: var(--gtdb-sectn) 0 var(--gtdb-s5); scroll-margin-top: 88px;
}
.gtdb-h3 {
  font: 800 var(--gtdb-t-h3)/1.3 var(--gtdb-font);
  color: var(--gtdb-navy); margin: var(--gtdb-s7) 0 var(--gtdb-s3);
  scroll-margin-top: 88px;
}
.gtdb-p { margin: 0 0 var(--gtdb-s5); text-wrap: pretty; }
.gtdb-p:last-child { margin-bottom: 0; }
.gtdb-lead { font-size: 19px; color: var(--gtdb-ink); }
.gtdb-small { font-size: var(--gtdb-t-small); line-height: 1.65; }
.gtdb-note { font-size: var(--gtdb-t-small); color: var(--gtdb-muted); }

.gtdb-a, .gtdb-article p a, .gtdb-li a {
  color: var(--gtdb-link); text-decoration: underline;
  text-decoration-thickness: 1px; text-underline-offset: 2px;
  transition: color var(--gtdb-t-fast);
}
.gtdb-a:hover, .gtdb-article p a:hover, .gtdb-li a:hover { color: var(--gtdb-navy); }

.gtdb-ul, .gtdb-ol { margin: 0 0 var(--gtdb-s5); padding-left: 0; list-style: none; }
.gtdb-li { position: relative; padding-left: var(--gtdb-s6); margin-bottom: var(--gtdb-s3); }
.gtdb-ul > .gtdb-li::before {
  content: ""; position: absolute; left: 4px; top: 12px;
  width: 6px; height: 6px; border-radius: 50%; background: var(--gtdb-gold);
}
.gtdb-ol { counter-reset: gtdb-ol; }
.gtdb-ol > .gtdb-li { counter-increment: gtdb-ol; padding-left: var(--gtdb-s7); }
.gtdb-ol > .gtdb-li::before {
  content: counter(gtdb-ol) "."; position: absolute; left: 0; top: 0;
  font: 800 16px/1.72 var(--gtdb-font); color: var(--gtdb-gold-ink);
}
.gtdb-li strong { color: var(--gtdb-ink); font-weight: 700; }

/* ---------------------------------------------------------------------------
   4. ARTICLE HEADER, image-free by default
   The hero is typographic. An image, when one exists, is an enhancement
   appended below the meta row (.gtdb-hero-img), never a requirement.
------------------------------------------------------------------------- */
.gtdb-head { padding: var(--gtdb-s9) 0 var(--gtdb-s7); }
.gtdb-crumb {
  font: 500 var(--gtdb-t-meta)/1 var(--gtdb-font); color: var(--gtdb-muted);
  display: flex; flex-wrap: wrap; gap: var(--gtdb-s2); align-items: center;
  margin-bottom: var(--gtdb-s6);
}
.gtdb-crumb a { color: var(--gtdb-muted); text-decoration: none; }
.gtdb-crumb a:hover { color: var(--gtdb-link); }
.gtdb-crumb span { color: var(--gtdb-rule); }

.gtdb-meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--gtdb-s3);
  margin-top: var(--gtdb-s6); padding-top: var(--gtdb-s5);
  border-top: 1px solid var(--gtdb-rule);
  font: 500 13px/1.4 var(--gtdb-font); color: var(--gtdb-muted);
}
.gtdb-meta strong { color: var(--gtdb-ink); font-weight: 700; }
.gtdb-meta-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--gtdb-rule); }
.gtdb-meta-flag {
  font: 700 10px/1 var(--gtdb-font); letter-spacing: .06em; text-transform: uppercase;
  color: var(--gtdb-gold-ink); background: var(--gtdb-gold-soft);
  border-radius: 999px; padding: 5px 9px;
}
.gtdb-hero-img { margin-top: var(--gtdb-s7); border-radius: var(--gtdb-r-lg); overflow: hidden; }

/* ---------------------------------------------------------------------------
   5. ANSWER BOX, the signature block
   Core, not optional. 40–60 words, top of every article. Navy fill is the
   loudest moment in the template and appears exactly once.
------------------------------------------------------------------------- */
.gtdb-answer {
  background: var(--gtdb-navy); color: var(--gtdb-white);
  border-radius: var(--gtdb-r-xl); padding: var(--gtdb-s7) var(--gtdb-s7) var(--gtdb-s6);
  margin: var(--gtdb-s4) 0 var(--gtdb-block); position: relative; overflow: hidden;
}
.gtdb-answer::before {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--gtdb-gold);
}
.gtdb-answer-label {
  font: 700 var(--gtdb-t-kicker)/1 var(--gtdb-font);
  letter-spacing: .18em; text-transform: uppercase; color: var(--gtdb-gold);
  display: block; margin-bottom: var(--gtdb-s4);
}
.gtdb-answer-text {
  font: 500 var(--gtdb-t-answer)/1.5 var(--gtdb-font);
  color: var(--gtdb-white); margin: 0; text-wrap: pretty;
}
.gtdb-answer-text strong { font-weight: 700; color: #DCEBFA; }
.gtdb-answer-src {
  margin: var(--gtdb-s5) 0 0; padding-top: var(--gtdb-s4);
  border-top: 1px solid rgba(255,255,255,.14);
  font: 500 var(--gtdb-t-meta)/1.5 var(--gtdb-font); color: rgba(255,255,255,.62);
}
.gtdb-answer-src a { color: #9DC9E8; text-decoration: underline; }

/* ---------------------------------------------------------------------------
   6. TAKEAWAYS + TOC
   The article's only wash. Cream, once, above the body.
------------------------------------------------------------------------- */
.gtdb-glance {
  background: var(--gtdb-cream); border-radius: var(--gtdb-r-xl);
  padding: var(--gtdb-s7); margin: 0 0 var(--gtdb-block);
}
.gtdb-glance-label {
  font: 700 var(--gtdb-t-kicker)/1 var(--gtdb-font); letter-spacing: .18em;
  text-transform: uppercase; color: var(--gtdb-gold-ink); margin-bottom: var(--gtdb-s5);
}
.gtdb-glance-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--gtdb-s4); }
.gtdb-glance-item {
  position: relative; padding-left: var(--gtdb-s6);
  font-size: var(--gtdb-t-small); line-height: 1.6; color: var(--gtdb-body);
}
.gtdb-glance-item::before {
  content: ""; position: absolute; left: 0; top: 9px; width: 8px; height: 2px; background: var(--gtdb-gold);
}
.gtdb-glance-item strong { color: var(--gtdb-navy); font-weight: 700; }

/* Rebuilt Aug 2026. Was a row of pills capped at 6 entries: each chip ran ~40px
   tall, so an 11-section article advertised five of them and the reader thought
   the piece ended at section five. Plain text links in two columns hold all 11
   in 228px, less than six pills took, so the cap is gone.

   Desktop: two columns, always open. Mobile: collapsed accordion.
   The toggle is a checkbox, not <details>, because a closed <details> cannot be
   forced open by CSS at a breakpoint. Chromium hides the content through the UA
   stylesheet and display:block !important does not override it, so the nav would
   stay collapsed on desktop. Measured in headless Chromium at 360 and 1200px.
   The input is visually hidden but focusable, so it stays keyboard operable, and
   no script travels inside body_html. */
.gtdb-toc {
  background: var(--gtdb-cream); border: 1px solid var(--gtdb-border);
  border-left: 3px solid var(--gtdb-gold); border-radius: var(--gtdb-r-md);
  padding: var(--gtdb-s4) var(--gtdb-s5); margin: 0 0 var(--gtdb-block);
  /* No max-width: the article grid already holds this to --gtdb-col. */
}
.gtdb-toc-tgl { position: absolute; opacity: 0; width: 0; height: 0; }
.gtdb-toc-label {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font: 700 var(--gtdb-t-kicker)/1 var(--gtdb-font); letter-spacing: .16em;
  text-transform: uppercase; color: var(--gtdb-muted);
  cursor: pointer; margin: 0; user-select: none;
}
.gtdb-toc-chev { font-size: 13px; color: var(--gtdb-gold-ink); transition: transform var(--gtdb-t-fast); }
.gtdb-toc-tgl:checked ~ .gtdb-toc-label .gtdb-toc-chev { transform: rotate(180deg); }
.gtdb-toc-tgl:focus-visible ~ .gtdb-toc-label {
  outline: 2px solid var(--gtdb-link); outline-offset: 4px; border-radius: 3px;
}

.gtdb-toc-list {
  display: none; list-style: none; margin: var(--gtdb-s4) 0 0; padding: 0;
  counter-reset: gtdbtoc;
}
.gtdb-toc-tgl:checked ~ .gtdb-toc-list { display: block; }
.gtdb-toc-list li {
  counter-increment: gtdbtoc; position: relative; padding-left: 24px;
  margin: 0 0 9px; break-inside: avoid;
}
.gtdb-toc-list li:last-child { margin-bottom: 0; }
.gtdb-toc-list li::before {
  content: counter(gtdbtoc); position: absolute; left: 0; top: 2px;
  font: 700 11px/1.5 var(--gtdb-font); color: var(--gtdb-gold-ink);
}
.gtdb-toc-link {
  /* Every pill property is unset explicitly. Overriding only font and colour
     leaves the chip's background, border, radius and padding alive in the
     cascade, which produces a pill wearing new typography. */
  background: none; border: 0; border-radius: 0; padding: 0;
  box-shadow: none; transition: none;
  font: 500 14px/1.5 var(--gtdb-font); color: var(--gtdb-navy); text-decoration: none;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.gtdb-toc-link:hover {
  background: none; border-color: transparent;
  color: var(--gtdb-link); text-decoration: underline;
}

@media (min-width: 760px) {
  /* Two equal columns. At --gtdb-col 720px each item is 321px, which fits 40
     characters of 14px Poppins 500 before wrapping. Measured, not estimated.
     Labels are written to a 34-character target so a capital or a long final
     word cannot tip a line; anything longer wraps and is clamped at two. */
  .gtdb-toc-list { display: block; columns: 2; column-gap: 34px; margin-top: var(--gtdb-s3); }
  .gtdb-toc-label { cursor: default; margin-bottom: 2px; }
  .gtdb-toc-chev { display: none; }
}

/* ---------------------------------------------------------------------------
   7. CALLOUTS, one shape, four semantic variants
------------------------------------------------------------------------- */
.gtdb-call {
  border: 1px solid var(--gtdb-border); border-left: 3px solid var(--gtdb-gold);
  border-radius: var(--gtdb-r-md); background: var(--gtdb-white);
  padding: var(--gtdb-s5) var(--gtdb-s6); margin: var(--gtdb-block) 0;
  box-shadow: var(--gtdb-shadow); font-size: var(--gtdb-t-small); line-height: 1.65;
}
.gtdb-call-label {
  font: 700 10px/1 var(--gtdb-font); letter-spacing: .06em; text-transform: uppercase;
  color: var(--gtdb-gold-ink); display: block; margin-bottom: var(--gtdb-s2);
}
.gtdb-call p { margin: 0; }
.gtdb-call-warn  { border-left-color: var(--gtdb-warn); background: var(--gtdb-warn-bg); }
.gtdb-call-warn  .gtdb-call-label { color: var(--gtdb-warn); }
.gtdb-call-expert { border-left-color: var(--gtdb-navy); background: var(--gtdb-gray); }
.gtdb-call-expert .gtdb-call-label { color: var(--gtdb-navy); }
.gtdb-call-spec  { border-left-color: var(--gtdb-blue); }
.gtdb-call-spec  .gtdb-call-label { color: var(--gtdb-link); }

/* ---------------------------------------------------------------------------
   8. STEPS, SPECS, QUOTE, FIGURE
   The oversized gold numeral is carried over from collections unchanged
   in spirit, it is the second loud moment and appears at most once.
------------------------------------------------------------------------- */
.gtdb-steps { display: grid; gap: var(--gtdb-s4); margin: var(--gtdb-block) 0; counter-reset: gtdb-step; }
.gtdb-step {
  counter-increment: gtdb-step; display: grid; grid-template-columns: 54px 1fr;
  gap: var(--gtdb-s4); align-items: start;
  border: 1px solid var(--gtdb-border); border-radius: var(--gtdb-r-lg);
  background: var(--gtdb-white); padding: var(--gtdb-s5) var(--gtdb-s6);
  transition: box-shadow var(--gtdb-t-base), transform var(--gtdb-t-base);
}
.gtdb-step:hover { transform: translateY(-2px); box-shadow: var(--gtdb-shadow-hov); }
.gtdb-step::before {
  content: counter(gtdb-step, decimal-leading-zero);
  font: 900 var(--gtdb-t-num)/1 var(--gtdb-font); color: var(--gtdb-gold);
  letter-spacing: -.03em;
}
.gtdb-step-title { font: 700 16px/1.35 var(--gtdb-font); color: var(--gtdb-navy); margin: 0 0 var(--gtdb-s2); }
.gtdb-step-body { font-size: var(--gtdb-t-small); line-height: 1.65; margin: 0; }

.gtdb-specs { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gtdb-s4); margin: var(--gtdb-block) 0; }
.gtdb-spec { border-top: 2px solid var(--gtdb-gold); padding-top: var(--gtdb-s4); }
.gtdb-spec-num { font: 900 30px/1 var(--gtdb-font); color: var(--gtdb-navy); letter-spacing: -.02em; }
.gtdb-spec-label {
  font: 700 10px/1 var(--gtdb-font); letter-spacing: .06em; text-transform: uppercase;
  color: var(--gtdb-muted); margin: var(--gtdb-s3) 0 var(--gtdb-s2);
}
.gtdb-spec-note { font-size: 13px; line-height: 1.55; color: var(--gtdb-muted); margin: 0; }

.gtdb-quote { margin: var(--gtdb-block) 0; padding-left: var(--gtdb-s6); border-left: 3px solid var(--gtdb-gold); }
.gtdb-quote-text { font: 500 22px/1.45 var(--gtdb-font); color: var(--gtdb-navy); margin: 0; text-wrap: pretty; }
.gtdb-quote-by { font: 500 13px/1.5 var(--gtdb-font); color: var(--gtdb-muted); margin: var(--gtdb-s4) 0 0; }

.gtdb-fig { margin: var(--gtdb-block) 0; }
.gtdb-fig img { border-radius: var(--gtdb-r-lg); width: 100%; }
.gtdb-fig-cap {
  font: 500 13px/1.55 var(--gtdb-font); color: var(--gtdb-muted);
  margin-top: var(--gtdb-s3); padding-left: var(--gtdb-s3); border-left: 2px solid var(--gtdb-gold);
}
/* No-image state: a figure with no asset renders nothing. The generator must
   omit .gtdb-fig entirely rather than shipping a placeholder box. */
.gtdb-fig:empty, .gtdb-fig[data-gtdb-state="empty"] { display: none; }

/* ---------------------------------------------------------------------------
   9. PRODUCTS + COMPARISON
------------------------------------------------------------------------- */
.gtdb-picks { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--gtdb-s5); margin: var(--gtdb-block) 0; }
.gtdb-pick {
  display: flex; flex-direction: column; text-decoration: none;
  border: 1px solid var(--gtdb-border); border-radius: var(--gtdb-r-lg);
  background: var(--gtdb-white); overflow: hidden;
  transition: transform var(--gtdb-t-base), box-shadow var(--gtdb-t-base), border-color var(--gtdb-t-base);
}
.gtdb-pick:hover { transform: translateY(-4px); box-shadow: var(--gtdb-glow); border-color: var(--gtdb-gold); }
.gtdb-pick-img { position: relative; background: var(--gtdb-gray); aspect-ratio: 4 / 3; display: grid; place-items: center; overflow: hidden; }
.gtdb-pick-img img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.gtdb-pick-img[data-gtdb-state="empty"]::after {
  content: attr(data-gtdb-fallback);
  font: 700 var(--gtdb-t-kicker)/1.4 var(--gtdb-font); letter-spacing: .12em;
  text-transform: uppercase; color: var(--gtdb-muted); text-align: center; padding: 0 var(--gtdb-s5);
}
.gtdb-pick-body { padding: var(--gtdb-s5); display: flex; flex-direction: column; gap: var(--gtdb-s2); flex: 1; }
.gtdb-pick-vendor { font: 700 10px/1 var(--gtdb-font); letter-spacing: .1em; text-transform: uppercase; color: var(--gtdb-link); }
.gtdb-pick-title { font: 700 15px/1.35 var(--gtdb-font); color: var(--gtdb-navy); margin: 0; }
.gtdb-pick-specs { display: grid; gap: 5px; font-size: 13px; line-height: 1.45; color: var(--gtdb-muted); margin: var(--gtdb-s1) 0; }
.gtdb-pick-price { font: 800 18px/1 var(--gtdb-font); color: var(--gtdb-navy); margin-top: auto; padding-top: var(--gtdb-s3); }
.gtdb-pick-cta {
  font: 700 11px/1 var(--gtdb-font); letter-spacing: .06em; text-transform: uppercase;
  color: var(--gtdb-link); margin-top: var(--gtdb-s3);
}

.gtdb-cmp-wrap { margin: var(--gtdb-block) 0; border: 1px solid var(--gtdb-border); border-radius: var(--gtdb-r-xl); overflow: hidden; background: var(--gtdb-white); }
.gtdb-cmp { width: 100%; border-collapse: collapse; font-size: 14px; }
.gtdb-cmp thead th {
  background: var(--gtdb-navy); color: var(--gtdb-white); text-align: left;
  font: 700 10px/1.2 var(--gtdb-font); letter-spacing: .08em; text-transform: uppercase;
  padding: var(--gtdb-s4) var(--gtdb-s5);
}
.gtdb-cmp td { padding: var(--gtdb-s4) var(--gtdb-s5); border-top: 1px solid var(--gtdb-border); color: var(--gtdb-body); vertical-align: top; }
.gtdb-cmp-model { font-weight: 700; color: var(--gtdb-navy); }
.gtdb-cmp-strong { font-weight: 700; color: var(--gtdb-gold-ink); }
.gtdb-cmp tbody tr:hover { background: var(--gtdb-cream); }

/* Comparison table rows that name a product GTD sells link to it, with a
   thumbnail, the way collection pages do. Added by linkComparisonTable() in
   lib/article-v2.ts after generation; the model never writes these. */
.gtdb-cmp-link  { display: flex; align-items: center; gap: 10px; color: var(--gtdb-navy); text-decoration: none; font-weight: 700; }
.gtdb-cmp-link:hover { color: var(--gtdb-link); }
.gtdb-cmp-thumb { width: 44px; height: 44px; flex: none; object-fit: cover; border-radius: 6px; background: var(--gtdb-cream); border: 1px solid var(--gtdb-border); }

/* Guide comparison tables. A guide page is not held to the article measure,
   and its tables carry more editorial columns than a blog's, so at 44px the
   thumbnail read as an icon and the columns crowded. Full page width, a 72px
   thumbnail like the collection pages, and the model column given room. */
.gtdb-guidepage .gtdb-cmp-wrap { max-width: none; }
.gtdb-guidepage .gtdb-cmp { font-size: 15px; }
.gtdb-guidepage .gtdb-cmp-link { gap: 14px; align-items: flex-start; }
.gtdb-guidepage td.gtdb-cmp-model { min-width: 260px; }
.gtdb-guidepage .gtdb-cmp tbody tr { transition: background var(--gtdb-t-base); }
.gtdb-guidepage .gtdb-cmp-link::after { content: " \\203A"; color: var(--gtdb-link); font-weight: 700; }
/* 96px, the size collection compare tables use. Two things kept the guide
   thumbnail at a dot you could not read: the base rule is 44px, and
   .gtdb-article img with height:auto outranks .gtdb-cmp-thumb on
   specificity (0,1,1 beats 0,1,0), so any square set on the class alone was
   half-ignored. Both dimensions are declared here on a two-class selector,
   and contain rather than cover so a product shot is not cropped. */
.gtdb-guidepage .gtdb-cmp .gtdb-cmp-thumb {
  width: 96px; height: 96px; min-width: 96px;
  object-fit: contain; background: var(--gtdb-white);
  border-radius: 8px; padding: 4px;
}
@media (max-width: 720px) {
  .gtdb-guidepage .gtdb-cmp .gtdb-cmp-thumb { width: 72px; height: 72px; min-width: 72px; }
  .gtdb-guidepage td.gtdb-cmp-model { min-width: 0; }
}

/* ---------------------------------------------------------------------------
   10. HANDOFFS, guide link, shop CTA, author, sources, related
------------------------------------------------------------------------- */
.gtdb-guide {
  display: flex; gap: var(--gtdb-s5); align-items: center; justify-content: space-between;
  flex-wrap: wrap; margin: var(--gtdb-block) 0;
  border: 1px solid var(--gtdb-border); border-left: 3px solid var(--gtdb-gold);
  border-radius: var(--gtdb-r-md); padding: var(--gtdb-s5) var(--gtdb-s6); text-decoration: none;
  transition: box-shadow var(--gtdb-t-base), border-color var(--gtdb-t-base);
}
.gtdb-guide:hover { box-shadow: var(--gtdb-glow); border-color: var(--gtdb-gold); }
.gtdb-guide-label { font: 700 var(--gtdb-t-kicker)/1 var(--gtdb-font); letter-spacing: .18em; text-transform: uppercase; color: var(--gtdb-gold-ink); }
.gtdb-guide-title { font: 700 16px/1.35 var(--gtdb-font); color: var(--gtdb-navy); margin: var(--gtdb-s2) 0 0; }
.gtdb-guide-go { font: 700 11px/1 var(--gtdb-font); letter-spacing: .06em; text-transform: uppercase; color: var(--gtdb-link); white-space: nowrap; }

.gtdb-shop {
  background: var(--gtdb-navy); border-radius: var(--gtdb-r-xl); color: var(--gtdb-white);
  padding: var(--gtdb-s8) var(--gtdb-s7); margin: var(--gtdb-sectn) 0 0; text-align: center;
}
.gtdb-shop-label { font: 700 var(--gtdb-t-kicker)/1 var(--gtdb-font); letter-spacing: .18em; text-transform: uppercase; color: var(--gtdb-gold); }
.gtdb-shop-title { font: 800 26px/1.15 var(--gtdb-font); letter-spacing: .02em; text-transform: uppercase; color: var(--gtdb-white); margin: var(--gtdb-s4) 0 var(--gtdb-s3); }
.gtdb-shop-sub { font-size: var(--gtdb-t-small); color: rgba(255,255,255,.72); margin: 0 auto var(--gtdb-s6); max-width: 46ch; }
.gtdb-btn {
  display: inline-block; font: 700 12px/1 var(--gtdb-font); letter-spacing: .06em;
  text-transform: uppercase; text-decoration: none; border-radius: var(--gtdb-r-sm);
  padding: 15px 26px; background: var(--gtdb-gold); color: #2A2007;
  transition: background .15s ease, box-shadow .15s ease;
}
.gtdb-btn:hover { background: #DFC18E; box-shadow: var(--gtdb-glow); }
.gtdb-btn-ghost { background: transparent; color: var(--gtdb-white); box-shadow: inset 0 0 0 1px rgba(255,255,255,.34); }
.gtdb-btn-ghost:hover { background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px var(--gtdb-white); }
.gtdb-shop-row { display: flex; gap: var(--gtdb-s3); justify-content: center; flex-wrap: wrap; }
.gtdb-shop-trust { font: 500 var(--gtdb-t-meta)/1 var(--gtdb-font); color: rgba(255,255,255,.55); margin-top: var(--gtdb-s6); }

.gtdb-author {
  display: grid; grid-template-columns: 64px 1fr; gap: var(--gtdb-s5);
  border-top: 2px solid var(--gtdb-gold); padding-top: var(--gtdb-s6); margin: var(--gtdb-sectn) 0 0;
}
.gtdb-author-photo { width: 64px; height: 64px; border-radius: 50%; background: var(--gtdb-gray); object-fit: cover; }
.gtdb-author-photo[data-gtdb-state="empty"] {
  display: grid; place-items: center; font: 800 20px/1 var(--gtdb-font); color: var(--gtdb-navy);
}
.gtdb-author-name { font: 700 16px/1.3 var(--gtdb-font); color: var(--gtdb-navy); margin: 0; }
.gtdb-author-cred { font: 500 12px/1.4 var(--gtdb-font); letter-spacing: .04em; text-transform: uppercase; color: var(--gtdb-gold-ink); margin: var(--gtdb-s2) 0 var(--gtdb-s3); }
.gtdb-author-bio { font-size: 14px; line-height: 1.65; margin: 0; color: var(--gtdb-muted); }
.gtdb-review { font: 500 13px/1.5 var(--gtdb-font); color: var(--gtdb-muted); margin: var(--gtdb-s4) 0 0; }

.gtdb-sources { margin: var(--gtdb-sectn) 0 0; }
.gtdb-sources-label { font: 700 var(--gtdb-t-kicker)/1 var(--gtdb-font); letter-spacing: .18em; text-transform: uppercase; color: var(--gtdb-muted); margin-bottom: var(--gtdb-s4); }
.gtdb-sources-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--gtdb-s3); counter-reset: gtdb-src; }
.gtdb-source { counter-increment: gtdb-src; position: relative; padding-left: var(--gtdb-s6); font-size: 13px; line-height: 1.6; color: var(--gtdb-muted); }
.gtdb-source::before { content: counter(gtdb-src); position: absolute; left: 0; top: 0; font: 700 12px/1.6 var(--gtdb-font); color: var(--gtdb-gold-ink); }

.gtdb-related { margin: var(--gtdb-sectn) 0 0; }
.gtdb-related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gtdb-s4); }
.gtdb-tile {
  display: block; text-decoration: none; border: 1px solid var(--gtdb-border);
  border-radius: var(--gtdb-r-md); padding: var(--gtdb-s5);
  transition: transform var(--gtdb-t-base), box-shadow var(--gtdb-t-base), border-color var(--gtdb-t-base);
}
.gtdb-tile:hover { transform: translateY(-3px); box-shadow: var(--gtdb-glow); border-color: var(--gtdb-gold); }
.gtdb-tile-hub { font: 700 9.5px/1 var(--gtdb-font); letter-spacing: .1em; text-transform: uppercase; color: var(--gtdb-gold-ink); }
.gtdb-tile-title { font: 700 14px/1.4 var(--gtdb-font); color: var(--gtdb-navy); margin: var(--gtdb-s3) 0 0; }
.gtdb-tile-meta { font: 500 11px/1 var(--gtdb-font); color: var(--gtdb-muted); margin-top: var(--gtdb-s3); }

/* ---------------------------------------------------------------------------
   11. FAQ
   Markup uses .faq-modern from gtd-collections.css, reused as-is and not
   redefined here. Only the article-side wrapper is namespaced.
------------------------------------------------------------------------- */
.gtdb-faq { display: flex; flex-direction: column; gap: var(--gtdb-s3); margin: var(--gtdb-block) 0 0; }

/* ---------------------------------------------------------------------------
   12. RESPONSIVE, mobile is the primary canvas
------------------------------------------------------------------------- */
@media (max-width: 860px) {
  .gtdb-picks, .gtdb-related-grid, .gtdb-specs { grid-template-columns: 1fr; }
  .gtdb-related-grid { gap: var(--gtdb-s3); }
}

@media (max-width: 720px) {
  :root {
    --gtdb-t-h1: 32px; --gtdb-t-deck: 17px; --gtdb-t-h2: 22px; --gtdb-t-h3: 18px;
    --gtdb-t-body: 17px; --gtdb-t-answer: 18px; --gtdb-t-num: 28px;
    --gtdb-block: 32px; --gtdb-sectn: 44px;
  }
  .gtdb-head { padding: var(--gtdb-s7) 0 var(--gtdb-s6); }
  .gtdb-answer, .gtdb-glance { padding: var(--gtdb-s6) var(--gtdb-s5); }
  .gtdb-step { grid-template-columns: 1fr; gap: var(--gtdb-s2); padding: var(--gtdb-s5); }
  .gtdb-shop { padding: var(--gtdb-s7) var(--gtdb-s5); }
  .gtdb-btn { display: block; }
  /* The jump nav is a single-column block below 760px already; nothing to
     override here now that the pill row is gone. */

  /* Comparison table becomes stacked cards. This is a design, not a scroll
     fallback: each row is a card, each cell labelled from data-gtdb-col. */
  .gtdb-cmp-wrap { border: 0; }
  .gtdb-cmp, .gtdb-cmp tbody, .gtdb-cmp tr, .gtdb-cmp td { display: block; width: 100%; }
  .gtdb-cmp thead { display: none; }
  .gtdb-cmp tbody tr {
    border: 1px solid var(--gtdb-border); border-radius: var(--gtdb-r-lg);
    margin-bottom: var(--gtdb-s3); padding: var(--gtdb-s4) var(--gtdb-s5); background: var(--gtdb-white);
  }
  .gtdb-cmp tbody tr:hover { background: var(--gtdb-white); }
  .gtdb-cmp td { border: 0; padding: var(--gtdb-s2) 0; display: flex; justify-content: space-between; gap: var(--gtdb-s4); }
  .gtdb-cmp td::before {
    content: attr(data-gtdb-col); flex: none;
    font: 700 10px/1.6 var(--gtdb-font); letter-spacing: .06em; text-transform: uppercase; color: var(--gtdb-muted);
  }
  .gtdb-cmp td.gtdb-cmp-model {
    display: block; font: 700 16px/1.3 var(--gtdb-font); color: var(--gtdb-navy);
    padding-bottom: var(--gtdb-s3); margin-bottom: var(--gtdb-s2); border-bottom: 1px solid var(--gtdb-border);
  }
  .gtdb-cmp td.gtdb-cmp-model::before { content: none; }
}

/* ---------------------------------------------------------------------------
   13. FOCUS
   Every hover affordance has a matching :focus-visible. The browser default
   outline is near invisible on navy and on the gold button, so focus is drawn
   as a 2px ring plus a 2px offset in the colour that contrasts with the
   element's own background.
------------------------------------------------------------------------- */
.gtdb-article a:focus-visible,
.gtdb-article summary:focus-visible,
.gtdb-article button:focus-visible {
  outline: 2px solid var(--gtdb-link);
  outline-offset: 2px;
  border-radius: var(--gtdb-r-sm);
}
/* Cards: the ring follows the card's own corner radius. */
.gtdb-pick:focus-visible, .gtdb-tile:focus-visible, .gtdb-guide:focus-visible {
  outline: 2px solid var(--gtdb-link); outline-offset: 3px;
  box-shadow: var(--gtdb-glow); border-color: var(--gtdb-gold);
}
.gtdb-pick:focus-visible { border-radius: var(--gtdb-r-lg); }
.gtdb-tile:focus-visible { border-radius: var(--gtdb-r-md); }
.gtdb-guide:focus-visible { border-radius: var(--gtdb-r-md); }
/* On navy and gold fills, blue would disappear, ring in white/navy instead. */
.gtdb-answer a:focus-visible, .gtdb-shop a:focus-visible { outline-color: var(--gtdb-white); }
.gtdb-btn:focus-visible { outline: 2px solid var(--gtdb-white); outline-offset: 3px; }
.gtdb-toc-link:focus-visible { outline: 2px solid var(--gtdb-navy); outline-offset: 2px; }

/* ---------------------------------------------------------------------------
   14. REDUCED MOTION
   Opt out of the card lifts and the gold glow. Hover still reads: the border
   goes gold and a flat shadow remains, so the affordance survives without
   any movement.
------------------------------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  .gtdb-article *, .gtdb-article *::before, .gtdb-article *::after {
    transition-duration: .01ms !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
  .gtdb-step:hover, .gtdb-pick:hover, .gtdb-tile:hover { transform: none; }
  .gtdb-pick:hover, .gtdb-tile:hover, .gtdb-guide:hover { box-shadow: var(--gtdb-shadow); }
  .gtdb-btn:hover { box-shadow: none; }
}

/* ---------------------------------------------------------------------------
   14b. HOST THEME RECONCILIATION

   The Shopify article template renders its own <h1 class="article-template__title">
   above the article body. A template_version 2 article renders the real header
   itself (kicker, H1, deck, byline), so the theme's title is a duplicate: two
   <h1> elements on the page, and the title shown twice before any content.
   Scoped with :has() so it applies only on pages carrying a v2 article;
   legacy articles keep the theme title exactly as before.
------------------------------------------------------------------------- */
.article-template:has(.gtdb-article) .article-template__title { display: none; }

/* Link colour. The theme wraps article body_html in \`.rte\`, and
   component-rte.css sets \`.rte a { color: … }\` at specificity (0,1,1). That
   outranks every single-class rule here, so any anchor whose text sits directly
   inside it rendered in the theme's colour instead of ours: the TOC pills and
   both CTA buttons came out near-black. Anchors whose text lives in a child
   element (product cards, tiles, the guide link) were unaffected, which is why
   this only showed up in two places.
   Re-asserted at (0,2,0) so our values win without !important. Keep any future
   anchor rule inside one of these two wrappers for the same reason. */
/* Hover was white here because the old jump links were navy-filled pills, so
   white text sat on a navy ground. The pills are gone and the ground is cream,
   so white hover text is invisible. Link blue, matching every other hovered
   link in the article. */
.gtdb-article .gtdb-toc-link        { color: var(--gtdb-navy); }
.gtdb-article .gtdb-toc-link:hover  { color: var(--gtdb-link); }
.gtdb-article .gtdb-btn             { color: #2A2007; }
.gtdb-article .gtdb-btn-ghost       { color: var(--gtdb-white); }
.gtdb-article .gtdb-crumb a         { color: var(--gtdb-muted); }
.gtdb-article .gtdb-a               { color: var(--gtdb-link); }
.gtdb-article .gtdb-cmp-link        { color: var(--gtdb-navy); }
.gtdb-article .gtdb-cmp-link:hover  { color: var(--gtdb-link); }
.gtdb-article .gtdb-answer-src a    { color: #9DC9E8; }
.gtdb-article .gtdb-pick-cta        { color: var(--gtdb-link); }
.gtdb-article .gtdb-guide-go        { color: var(--gtdb-link); }
.gtdb-page .gtdb-hubnav-link        { color: var(--gtdb-navy); }
.gtdb-page .gtdb-hsec-all           { color: var(--gtdb-link); }
.gtdb-page .gtdb-more-btn           { color: var(--gtdb-navy); }

/* Featured image. The theme renders it full-bleed at the top of the article,
   which on desktop pushes the real header a long way down. Cap it to the
   article measure on wide screens; mobile is already fine, so it is untouched. */
@media (min-width: 900px) {
  .article-template:has(.gtdb-article) .article-template__hero,
  .article-template:has(.gtdb-article) .article-template__hero img,
  .article-template:has(.gtdb-article) .article-template__header img {
    max-height: 420px;
    object-fit: cover;
  }
}

/* ---------------------------------------------------------------------------
   15. PRINT
------------------------------------------------------------------------- */
@media print {
  .gtdb-toc, .gtdb-shop, .gtdb-related { display: none; }
  .gtdb-answer { background: var(--gtdb-white); color: var(--gtdb-navy); border: 2px solid var(--gtdb-navy); }
  .gtdb-answer-text { color: var(--gtdb-navy); }
}

/* ============================================================================
   PHASE 3, HUB AND INDEX
   Two listing surfaces, same namespace. They share the article's palette
   roles: navy structure, gold ornament, blue interactivity.

   The nine-colour article-type badge palette is FIXED INPUT and is carried
   over unchanged as --gtdb-type-*. It is the one place the rainbow survives,
   because it encodes meaning the reader has already learned. Hub cards get
   at most one type badge each, so no card ever shows two accent colours.
   ========================================================================= */

:root {
  /* Article-type badges, unchanged from the March 2026 system */
  --gtdb-type-sauna:    #dc3545;
  --gtdb-type-cold:     #17a2b8;
  --gtdb-type-fitness:  #28a745;
  --gtdb-type-wellness: #6f42c1;
  --gtdb-type-listicle: #fd7e14;
  --gtdb-type-celeb:    #e83e8c;
  --gtdb-type-science:  #20c997;
  --gtdb-type-guide:    #0066cc;
  --gtdb-type-clinical: #09195B; /* NEW, see note in README. Navy, deliberately sober */
}

.gtdb-page {
  box-sizing: border-box; font-family: var(--gtdb-font);
  font-size: var(--gtdb-t-body); line-height: 1.72; color: var(--gtdb-body);
  -webkit-font-smoothing: antialiased;
  padding-bottom: var(--gtdb-s10);
}
.gtdb-page, .gtdb-page *, .gtdb-page *::before, .gtdb-page *::after { box-sizing: border-box; }
.gtdb-page img { max-width: 100%; height: auto; display: block; opacity: 1; }
.gtdb-shell { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
.gtdb-page a:focus-visible {
  outline: 2px solid var(--gtdb-link); outline-offset: 3px; border-radius: var(--gtdb-r-sm);
}

/* --- Listing hero. Navy, one per page, mirrors the collection hubs ------- */
.gtdb-lhero { background: var(--gtdb-navy); color: var(--gtdb-white); padding: var(--gtdb-s9) 0; }
.gtdb-lhero-kick {
  font: 700 var(--gtdb-t-kicker)/1 var(--gtdb-font); letter-spacing: .18em;
  text-transform: uppercase; color: var(--gtdb-gold);
  display: inline-flex; align-items: center; gap: var(--gtdb-s2);
}
.gtdb-lhero-kick::before { content: ""; width: 22px; height: 2px; background: var(--gtdb-gold); }
.gtdb-lhero-title {
  font: 900 44px/1.05 var(--gtdb-font); letter-spacing: -.02em; text-transform: uppercase;
  color: var(--gtdb-white); margin: var(--gtdb-s5) 0 0; max-width: 22ch;
}
.gtdb-lhero-sub { font-size: var(--gtdb-t-small); color: rgba(255,255,255,.72); margin: var(--gtdb-s4) 0 0; max-width: 58ch; }
.gtdb-lhero-stats { display: flex; flex-wrap: wrap; gap: var(--gtdb-s7); margin-top: var(--gtdb-s7); }
.gtdb-lhero-stat { display: grid; gap: var(--gtdb-s1); }
.gtdb-lhero-num { font: 900 28px/1 var(--gtdb-font); color: var(--gtdb-gold); }
.gtdb-lhero-lbl { font: 700 10px/1 var(--gtdb-font); letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.58); }

/* --- Hub navigation, six hubs incl. Clinical ----------------------------- */
.gtdb-hubnav { border-bottom: 1px solid var(--gtdb-rule); background: var(--gtdb-white); }
.gtdb-hubnav-row {
  display: flex; gap: var(--gtdb-s2); overflow-x: auto; padding: var(--gtdb-s4) 0;
  scrollbar-width: none;
}
.gtdb-hubnav-row::-webkit-scrollbar { display: none; }
.gtdb-hubnav-link {
  flex: none; font: 700 12px/1 var(--gtdb-font); letter-spacing: .04em; text-transform: uppercase;
  color: var(--gtdb-navy); text-decoration: none; padding: 11px 16px;
  border: 1px solid var(--gtdb-border); border-radius: 999px; background: var(--gtdb-white);
  transition: background var(--gtdb-t-fast), color var(--gtdb-t-fast), border-color var(--gtdb-t-fast);
}
.gtdb-hubnav-link:hover { background: var(--gtdb-gray); border-color: var(--gtdb-navy); }
.gtdb-hubnav-link[aria-current="true"] { background: var(--gtdb-navy); border-color: var(--gtdb-navy); color: var(--gtdb-white); }

/* --- Hub section ---------------------------------------------------------- */
.gtdb-hsec { padding: var(--gtdb-s9) 0 0; }
.gtdb-hsec-head {
  display: flex; align-items: flex-end; justify-content: space-between; gap: var(--gtdb-s5);
  flex-wrap: wrap; border-bottom: 2px solid var(--gtdb-gold); padding-bottom: var(--gtdb-s4);
  margin-bottom: var(--gtdb-s6);
}
.gtdb-hsec-kick { font: 700 var(--gtdb-t-kicker)/1 var(--gtdb-font); letter-spacing: .18em; text-transform: uppercase; color: var(--gtdb-gold-ink); }
.gtdb-hsec-title { font: 800 26px/1.1 var(--gtdb-font); letter-spacing: .02em; text-transform: uppercase; color: var(--gtdb-navy); margin: var(--gtdb-s3) 0 0; }
.gtdb-hsec-sub { font-size: var(--gtdb-t-small); color: var(--gtdb-muted); margin: var(--gtdb-s3) 0 0; max-width: 64ch; }
.gtdb-hsec-all { font: 700 11px/1 var(--gtdb-font); letter-spacing: .06em; text-transform: uppercase; color: var(--gtdb-link); text-decoration: none; white-space: nowrap; }
.gtdb-hsec-all:hover { color: var(--gtdb-navy); }

.gtdb-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gtdb-s5); }
.gtdb-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--gtdb-s4); }
.gtdb-grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--gtdb-s5); }

/* --- Article card. Type badge is the only accent colour on the card ------ */
.gtdb-card {
  display: flex; flex-direction: column; text-decoration: none; background: var(--gtdb-white);
  border: 1px solid var(--gtdb-border); border-radius: var(--gtdb-r-md); padding: var(--gtdb-s5);
  transition: transform var(--gtdb-t-base), box-shadow var(--gtdb-t-base), border-color var(--gtdb-t-base);
}
.gtdb-card:hover { transform: translateY(-4px); box-shadow: var(--gtdb-glow); border-color: var(--gtdb-gold); }
.gtdb-card:focus-visible { outline: 2px solid var(--gtdb-link); outline-offset: 3px; border-radius: var(--gtdb-r-md); }
.gtdb-type {
  align-self: flex-start; font: 700 9.5px/1 var(--gtdb-font); letter-spacing: .06em;
  text-transform: uppercase; color: var(--gtdb-white); background: var(--gtdb-navy);
  border-radius: 999px; padding: 6px 10px;
}
.gtdb-type-sauna    { background: var(--gtdb-type-sauna); }
.gtdb-type-cold     { background: var(--gtdb-type-cold); }
.gtdb-type-fitness  { background: var(--gtdb-type-fitness); }
.gtdb-type-wellness { background: var(--gtdb-type-wellness); }
.gtdb-type-listicle { background: var(--gtdb-type-listicle); color: #3B2506; }
.gtdb-type-celeb    { background: var(--gtdb-type-celeb); }
.gtdb-type-science   { background: var(--gtdb-type-science); color: #06331F; }
.gtdb-type-guide    { background: var(--gtdb-type-guide); }
.gtdb-type-clinical { background: var(--gtdb-type-clinical); }
.gtdb-card-title { font: 700 15px/1.4 var(--gtdb-font); color: var(--gtdb-navy); margin: var(--gtdb-s4) 0 0; text-wrap: pretty; }
.gtdb-card-dek { font-size: 13.5px; line-height: 1.6; color: var(--gtdb-muted); margin: var(--gtdb-s3) 0 0; }
.gtdb-card-foot {
  display: flex; align-items: center; gap: var(--gtdb-s3); margin-top: auto;
  padding-top: var(--gtdb-s5); font: 500 11px/1 var(--gtdb-font); color: var(--gtdb-muted);
}
.gtdb-card-foot .gtdb-meta-dot { flex: none; }
/* Bulk-import dates read as noise on every card. The generator prints a real
   updated date, or nothing at all. */
.gtdb-card-foot [data-gtdb-optional] { display: inline; }

/* --- Guide card, taller, gold rule, no type badge ----------------------- */
.gtdb-gcard {
  display: flex; flex-direction: column; text-decoration: none;
  border: 1px solid var(--gtdb-border); border-top: 3px solid var(--gtdb-gold);
  border-radius: var(--gtdb-r-md); padding: var(--gtdb-s6) var(--gtdb-s5);
  background: var(--gtdb-cream);
  transition: transform var(--gtdb-t-base), box-shadow var(--gtdb-t-base);
}
.gtdb-gcard:hover { transform: translateY(-4px); box-shadow: var(--gtdb-glow); }
.gtdb-gcard-kick { font: 700 10px/1 var(--gtdb-font); letter-spacing: .12em; text-transform: uppercase; color: var(--gtdb-gold-ink); }
.gtdb-gcard-title { font: 800 18px/1.25 var(--gtdb-font); color: var(--gtdb-navy); margin: var(--gtdb-s4) 0 0; }
.gtdb-gcard-meta { font: 500 11px/1 var(--gtdb-font); letter-spacing: .04em; text-transform: uppercase; color: var(--gtdb-muted); margin-top: auto; padding-top: var(--gtdb-s5); }

/* --- Featured tier, index only ------------------------------------------ */
.gtdb-feat { display: grid; grid-template-columns: 1.4fr 1fr; gap: var(--gtdb-s5); margin-bottom: var(--gtdb-s8); }
.gtdb-feat-main {
  display: flex; flex-direction: column; justify-content: flex-end; text-decoration: none;
  background: var(--gtdb-navy); color: var(--gtdb-white); border-radius: var(--gtdb-r-xl);
  padding: var(--gtdb-s8) var(--gtdb-s7); min-height: 320px; position: relative; overflow: hidden;
  transition: box-shadow var(--gtdb-t-base);
}
.gtdb-feat-main::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--gtdb-gold); }
.gtdb-feat-main:hover { box-shadow: var(--gtdb-glow); }
.gtdb-feat-main .gtdb-card-title { font: 900 30px/1.12 var(--gtdb-font); color: var(--gtdb-white); letter-spacing: -.01em; margin: var(--gtdb-s5) 0 0; max-width: 26ch; }
.gtdb-feat-main .gtdb-card-dek { color: rgba(255,255,255,.72); font-size: var(--gtdb-t-small); max-width: 46ch; }
.gtdb-feat-main .gtdb-card-foot { color: rgba(255,255,255,.55); }
.gtdb-feat-side { display: grid; gap: var(--gtdb-s4); align-content: start; }

/* --- Filter row, index -------------------------------------------------- */
.gtdb-filters {
  display: flex; flex-wrap: wrap; gap: var(--gtdb-s3); align-items: center;
  padding: var(--gtdb-s5) 0; border-bottom: 1px solid var(--gtdb-rule); margin-bottom: var(--gtdb-s7);
}
.gtdb-filters-label { font: 700 10px/1 var(--gtdb-font); letter-spacing: .12em; text-transform: uppercase; color: var(--gtdb-muted); margin-right: var(--gtdb-s2); }
.gtdb-chip {
  font: 600 12px/1 var(--gtdb-font); color: var(--gtdb-navy); text-decoration: none;
  border: 1px solid var(--gtdb-border); border-radius: 999px; padding: 9px 14px;
  background: var(--gtdb-white); cursor: pointer;
  transition: background var(--gtdb-t-fast), color var(--gtdb-t-fast), border-color var(--gtdb-t-fast);
}
.gtdb-chip:hover { background: var(--gtdb-gray); border-color: var(--gtdb-navy); }
.gtdb-chip[aria-pressed="true"] { background: var(--gtdb-navy); border-color: var(--gtdb-navy); color: var(--gtdb-white); }
.gtdb-chip-count { opacity: .6; margin-left: 5px; font-weight: 500; }
.gtdb-count { font: 500 12px/1 var(--gtdb-font); color: var(--gtdb-muted); margin-left: auto; }

/* Load more replaces 82 pages of numbered pagination. */
.gtdb-more { display: flex; justify-content: center; margin-top: var(--gtdb-s8); }
.gtdb-more-btn {
  font: 700 12px/1 var(--gtdb-font); letter-spacing: .06em; text-transform: uppercase;
  color: var(--gtdb-navy); background: var(--gtdb-white); border: 1px solid var(--gtdb-navy);
  border-radius: var(--gtdb-r-sm); padding: 15px 28px; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.gtdb-more-btn:hover { background: var(--gtdb-navy); color: var(--gtdb-white); }
.gtdb-more-btn:focus-visible { outline: 2px solid var(--gtdb-link); outline-offset: 3px; }

/* Empty filter result. A listing surface needs a real no-results state. */
.gtdb-empty {
  border: 1px dashed var(--gtdb-gold); border-radius: var(--gtdb-r-lg);
  padding: var(--gtdb-s8) var(--gtdb-s6); text-align: center;
}
.gtdb-empty-title { font: 800 18px/1.2 var(--gtdb-font); color: var(--gtdb-navy); margin: 0; }
.gtdb-empty-sub { font-size: var(--gtdb-t-small); color: var(--gtdb-muted); margin: var(--gtdb-s3) 0 0; }

@media (max-width: 1000px) {
  .gtdb-grid4 { grid-template-columns: repeat(2, 1fr); }
  .gtdb-feat { grid-template-columns: 1fr; }
}
@media (max-width: 860px) {
  .gtdb-grid3 { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .gtdb-grid3, .gtdb-grid4, .gtdb-grid2 { grid-template-columns: 1fr; }
  .gtdb-lhero { padding: var(--gtdb-s7) 0; }
  .gtdb-lhero-title { font-size: 30px; }
  .gtdb-lhero-stats { gap: var(--gtdb-s5); }
  .gtdb-hsec { padding-top: var(--gtdb-s7); }
  .gtdb-feat-main { padding: var(--gtdb-s6) var(--gtdb-s5); min-height: 0; }
  .gtdb-feat-main .gtdb-card-title { font-size: 24px; }
  .gtdb-count { margin-left: 0; width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .gtdb-page *, .gtdb-page *::before, .gtdb-page *::after {
    transition-duration: .01ms !important; animation-duration: .01ms !important;
  }
  .gtdb-card:hover, .gtdb-gcard:hover { transform: none; box-shadow: var(--gtdb-shadow); }
  .gtdb-feat-main:hover { box-shadow: none; }
}

/* ============================================================================
   PHASE 4, ULTIMATE GUIDES (Aug 2026)
   Guides are Shopify pages at /pages/{slug}, assembled by lib/guide-v2.ts on
   the article system above: same tokens, same blocks, same measure. These are
   the only additions. Everything else a guide renders is already defined.
   ========================================================================= */

/* Hero image sits under the header meta row, inside the text column. */
.gtdb-guide-hero { margin: var(--gtdb-s7) 0 0; }
.gtdb-guide-hero img { width: 100%; border-radius: var(--gtdb-r-lg); }

/* A guide runs 6,000 to 8,000 words, so the cream wash above the body holds
   up to six takeaways and a fourteen-entry nav. Nothing to change; the blocks
   scale. The only guide-specific rhythm rule is a little more air before the
   product cards, which land mid-page rather than above the body. */
.gtdb-guidepage .gtdb-picks { margin-top: var(--gtdb-s6); }

/* Related ultimate guides: the hub's guide card, in a grid after the FAQ. */
.gtdb-guide-related { margin: var(--gtdb-sectn) 0 0; }
.gtdb-guide-related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gtdb-s4); }
.gtdb-guide-related .gtdb-gcard { padding: var(--gtdb-s5); }
.gtdb-guide-related .gtdb-gcard-title { font-size: 16px; }
.gtdb-guide-related .gtdb-card-dek { font-size: 13px; margin-top: var(--gtdb-s2); }
.gtdb-guide-related .gtdb-gcard:focus-visible {
  outline: 2px solid var(--gtdb-link); outline-offset: 3px; border-radius: var(--gtdb-r-md);
}

/* Sources cited. Guides may cite off-site (articles never do); the list is
   built from the outbound links the body actually kept after verification. */
.gtdb-sources .gtdb-a { color: var(--gtdb-link); }

/* Host theme reconciliation for PAGE templates. The page template prints its
   own title banner (div.page-title holding h1.page-title__title, verified on
   the live theme 24 Aug 2026) above body_html. Scoped with :has() so only a
   v2 guide page hides it. The page modifier class is gtdb-guidepage, NOT
   gtdb-guide: that name belongs to the "Go deeper" guide-link box above. */
.shopify-section:has(.gtdb-guidepage) .page-title,
.main-page-title:has(+ * .gtdb-guidepage) { display: none; }

@media (max-width: 860px) {
  .gtdb-guide-related-grid { grid-template-columns: 1fr; gap: var(--gtdb-s3); }
}
@media print {
  .gtdb-guide-related { display: none; }
}

/* ── 16. Carried content images (revamp keep-images mode) ─────────────
   Figures inserted by the revamp carry step. One per content section,
   full column width, soft corners to match the card language. */
.gtdb-figure { margin: var(--gtdb-s4, 24px) 0; }
.gtdb-figure img { width: 100%; height: auto; border-radius: 12px; display: block; }
.gtdb-figcap { font-size: 0.82rem; color: var(--gtdb-ink-soft, #6b7280); margin-top: 8px; }
`

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">'

/** Everything a v2 article needs to render exactly as it will on the site. */
export const BLOG_PREVIEW_HEAD =
  `${FONT_LINK}<style>${GTD_COLLECTIONS_CSS}</style><style>${GTD_BLOG_CSS}</style>` +
  `<style>html,body{margin:0;padding:0;background:#fff}</style>`

/** Wrap article body_html in a full document for an iframe srcDoc. */
export function buildBlogPreviewDocument(bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `${BLOG_PREVIEW_HEAD}</head><body>${bodyHtml || ''}</body></html>`
}
