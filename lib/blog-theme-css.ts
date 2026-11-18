// ============================================================================
// lib/blog-theme-css.ts — copy of the Shopify theme asset ppw-blog.css, used
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

import { PPW_COLLECTIONS_CSS } from './theme-css'

export const PPW_BLOG_CSS = `/* ============================================================================
   ppw-blog.css, PPW blog article design system, v1 (Phase 1)
   Theme asset. Loaded in layout/theme.liquid alongside ppw-collections.css.

   NAMESPACE RULE: every class in this file is prefixed .ppwb-.
   No name here appears in the legacy blog CSS (PPW_STYLES) or in
   ppw-collections.css. Legacy articles keep their inline <style> block and
   render exactly as they do today. The one deliberate exception is
   .faq-modern, which is reused as-is from ppw-collections.css and is
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
   Gold never carries text at body size; use --ppwb-gold-ink (4.87:1).
   Body links use --ppwb-link #0A6BA3 (5.76:1), the brand blue darkened to
   clear WCAG AA. Brand blue #0A86CB is kept for large/non-text accents only.
------------------------------------------------------------------------- */
:root {
  --ppwb-navy:        #09195B;
  --ppwb-navy-deep:   #050F38;
  --ppwb-gold:        #C8A96E;
  --ppwb-gold-ink:    #8A6D2F;
  --ppwb-gold-soft:   rgba(200,169,110,.16);
  --ppwb-blue:        #0A86CB;
  --ppwb-link:        #0A6BA3;
  --ppwb-ink:         #12182B;
  --ppwb-body:        #333C52;
  --ppwb-muted:       #596183;
  --ppwb-cream:       #FAF7F1;
  --ppwb-gray:        #F8F8F8;
  --ppwb-border:      #E5E7EB;
  --ppwb-rule:        #DFE3EA;
  --ppwb-white:       #FFFFFF;
  --ppwb-warn:        #B45309;
  --ppwb-warn-bg:     #FFFBEB;

  --ppwb-font: Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

  /* Type scale, desktop values. Mobile overrides in section 12. */
  --ppwb-t-h1:      46px;
  --ppwb-t-deck:    20px;
  --ppwb-t-h2:      28px;
  --ppwb-t-h3:      20px;
  --ppwb-t-body:    18px;
  --ppwb-t-answer:  21px;
  --ppwb-t-small:   15px;
  --ppwb-t-meta:    12px;
  --ppwb-t-kicker:  11px;
  --ppwb-t-num:     34px;

  /* Spacing, 4px base */
  --ppwb-s1: 4px;  --ppwb-s2: 8px;  --ppwb-s3: 12px; --ppwb-s4: 16px;
  --ppwb-s5: 20px; --ppwb-s6: 24px; --ppwb-s7: 32px; --ppwb-s8: 48px;
  --ppwb-s9: 64px; --ppwb-s10: 96px;

  /* Rhythm, the only two vertical values a block should use */
  /* Vertical rhythm. Tightened Aug 2026: 40/64 read as airy in isolation but
     left too much dead space between sections once real articles carried
     callouts, spec strips and step lists. Mobile overrides are unchanged. */
  --ppwb-block:  32px;   /* gap between blocks inside a section */
  --ppwb-sectn:  48px;   /* gap between H2 sections */

  --ppwb-r-sm: 6px; --ppwb-r-md: 10px; --ppwb-r-lg: 12px; --ppwb-r-xl: 14px;
  --ppwb-shadow:      0 8px 22px rgba(0,0,0,.05);
  --ppwb-shadow-hov:  0 12px 30px rgba(0,0,0,.10);
  --ppwb-glow:        0 10px 26px rgba(200,169,110,.28);
  --ppwb-t-fast: .12s ease; --ppwb-t-base: .2s ease;

  /* Measure. Text column is 720px (~68 characters at 18px Poppins). */
  --ppwb-col:  720px;
  --ppwb-wide: 960px;
}

/* ---------------------------------------------------------------------------
   2. SHELL + MEASURE
   .ppwb-article is the single wrapper the generator emits. Everything inside
   sits on the 720px text column; .ppwb-wide opts a block out to 960px.
------------------------------------------------------------------------- */
/* Border-box, scoped. The live theme has no universal reset, only per-component
   Shopify selectors, so padded blocks inherited content-box and overflowed
   their wrapper. Every future block relies on this rule. */
.ppwb-article, .ppwb-article *, .ppwb-article *::before, .ppwb-article *::after { box-sizing: border-box; }

.ppwb-article {
  font-family: var(--ppwb-font);
  font-size: var(--ppwb-t-body);
  line-height: 1.72;
  color: var(--ppwb-body);
  -webkit-font-smoothing: antialiased;
  display: grid;
  grid-template-columns: 1fr min(var(--ppwb-col), 100% - 40px) 1fr;
  padding: 0 0 var(--ppwb-s10);
}
.ppwb-article > * { grid-column: 2; }
.ppwb-wide  { grid-column: 2; width: min(var(--ppwb-wide), 100%); justify-self: center; }
.ppwb-bleed { grid-column: 1 / -1; width: 100%; }

@media (min-width: 1040px) {
  .ppwb-wide { width: var(--ppwb-wide); max-width: none; margin-left: calc((var(--ppwb-col) - var(--ppwb-wide)) / 2); }
}

/* Images: behaviour is specified here so the publish pipeline can stop
   patching every <img> inline. Retires the loading="lazy" strip and the
   inline max-width workaround for template_version 2 articles. */
.ppwb-article img { max-width: 100%; height: auto; display: block; opacity: 1; }

/* ---------------------------------------------------------------------------
   3. TYPE
   Uppercase is structural only: kicker, H2, badges, CTA. Titles, H3s and
   body stay sentence case, this is a reading surface.
------------------------------------------------------------------------- */
.ppwb-kicker {
  font: 700 var(--ppwb-t-kicker)/1 var(--ppwb-font);
  letter-spacing: .18em; text-transform: uppercase;
  color: var(--ppwb-gold-ink);
  display: inline-flex; align-items: center; gap: var(--ppwb-s2);
}
.ppwb-kicker::before {
  content: ""; width: 22px; height: 2px; background: var(--ppwb-gold); flex: none;
}
.ppwb-h1 {
  font: 900 var(--ppwb-t-h1)/1.06 var(--ppwb-font);
  letter-spacing: -.02em; color: var(--ppwb-navy);
  margin: var(--ppwb-s5) 0 0; text-wrap: balance;
}
.ppwb-deck {
  font: 400 var(--ppwb-t-deck)/1.55 var(--ppwb-font);
  color: var(--ppwb-muted); margin: var(--ppwb-s4) 0 0; max-width: 62ch;
  text-wrap: pretty;
}
.ppwb-h2 {
  font: 800 var(--ppwb-t-h2)/1.15 var(--ppwb-font);
  letter-spacing: .02em; text-transform: uppercase; color: var(--ppwb-navy);
  margin: var(--ppwb-sectn) 0 var(--ppwb-s5); scroll-margin-top: 88px;
}
.ppwb-h3 {
  font: 800 var(--ppwb-t-h3)/1.3 var(--ppwb-font);
  color: var(--ppwb-navy); margin: var(--ppwb-s7) 0 var(--ppwb-s3);
  scroll-margin-top: 88px;
}
.ppwb-p { margin: 0 0 var(--ppwb-s5); text-wrap: pretty; }
.ppwb-p:last-child { margin-bottom: 0; }
.ppwb-lead { font-size: 19px; color: var(--ppwb-ink); }
.ppwb-small { font-size: var(--ppwb-t-small); line-height: 1.65; }
.ppwb-note { font-size: var(--ppwb-t-small); color: var(--ppwb-muted); }

.ppwb-a, .ppwb-article p a, .ppwb-li a {
  color: var(--ppwb-link); text-decoration: underline;
  text-decoration-thickness: 1px; text-underline-offset: 2px;
  transition: color var(--ppwb-t-fast);
}
.ppwb-a:hover, .ppwb-article p a:hover, .ppwb-li a:hover { color: var(--ppwb-navy); }

.ppwb-ul, .ppwb-ol { margin: 0 0 var(--ppwb-s5); padding-left: 0; list-style: none; }
.ppwb-li { position: relative; padding-left: var(--ppwb-s6); margin-bottom: var(--ppwb-s3); }
.ppwb-ul > .ppwb-li::before {
  content: ""; position: absolute; left: 4px; top: 12px;
  width: 6px; height: 6px; border-radius: 50%; background: var(--ppwb-gold);
}
.ppwb-ol { counter-reset: ppwb-ol; }
.ppwb-ol > .ppwb-li { counter-increment: ppwb-ol; padding-left: var(--ppwb-s7); }
.ppwb-ol > .ppwb-li::before {
  content: counter(ppwb-ol) "."; position: absolute; left: 0; top: 0;
  font: 800 16px/1.72 var(--ppwb-font); color: var(--ppwb-gold-ink);
}
.ppwb-li strong { color: var(--ppwb-ink); font-weight: 700; }

/* ---------------------------------------------------------------------------
   4. ARTICLE HEADER, image-free by default
   The hero is typographic. An image, when one exists, is an enhancement
   appended below the meta row (.ppwb-hero-img), never a requirement.
------------------------------------------------------------------------- */
.ppwb-head { padding: var(--ppwb-s9) 0 var(--ppwb-s7); }
.ppwb-crumb {
  font: 500 var(--ppwb-t-meta)/1 var(--ppwb-font); color: var(--ppwb-muted);
  display: flex; flex-wrap: wrap; gap: var(--ppwb-s2); align-items: center;
  margin-bottom: var(--ppwb-s6);
}
.ppwb-crumb a { color: var(--ppwb-muted); text-decoration: none; }
.ppwb-crumb a:hover { color: var(--ppwb-link); }
.ppwb-crumb span { color: var(--ppwb-rule); }

.ppwb-meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--ppwb-s3);
  margin-top: var(--ppwb-s6); padding-top: var(--ppwb-s5);
  border-top: 1px solid var(--ppwb-rule);
  font: 500 13px/1.4 var(--ppwb-font); color: var(--ppwb-muted);
}
.ppwb-meta strong { color: var(--ppwb-ink); font-weight: 700; }
.ppwb-meta-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--ppwb-rule); }
.ppwb-meta-flag {
  font: 700 10px/1 var(--ppwb-font); letter-spacing: .06em; text-transform: uppercase;
  color: var(--ppwb-gold-ink); background: var(--ppwb-gold-soft);
  border-radius: 999px; padding: 5px 9px;
}
.ppwb-hero-img { margin-top: var(--ppwb-s7); border-radius: var(--ppwb-r-lg); overflow: hidden; }

/* ---------------------------------------------------------------------------
   5. ANSWER BOX, the signature block
   Core, not optional. 40–60 words, top of every article. Navy fill is the
   loudest moment in the template and appears exactly once.
------------------------------------------------------------------------- */
.ppwb-answer {
  background: var(--ppwb-navy); color: var(--ppwb-white);
  border-radius: var(--ppwb-r-xl); padding: var(--ppwb-s7) var(--ppwb-s7) var(--ppwb-s6);
  margin: var(--ppwb-s4) 0 var(--ppwb-block); position: relative; overflow: hidden;
}
.ppwb-answer::before {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--ppwb-gold);
}
.ppwb-answer-label {
  font: 700 var(--ppwb-t-kicker)/1 var(--ppwb-font);
  letter-spacing: .18em; text-transform: uppercase; color: var(--ppwb-gold);
  display: block; margin-bottom: var(--ppwb-s4);
}
.ppwb-answer-text {
  font: 500 var(--ppwb-t-answer)/1.5 var(--ppwb-font);
  color: var(--ppwb-white); margin: 0; text-wrap: pretty;
}
.ppwb-answer-text strong { font-weight: 700; color: #DCEBFA; }
.ppwb-answer-src {
  margin: var(--ppwb-s5) 0 0; padding-top: var(--ppwb-s4);
  border-top: 1px solid rgba(255,255,255,.14);
  font: 500 var(--ppwb-t-meta)/1.5 var(--ppwb-font); color: rgba(255,255,255,.62);
}
.ppwb-answer-src a { color: #9DC9E8; text-decoration: underline; }

/* ---------------------------------------------------------------------------
   6. TAKEAWAYS + TOC
   The article's only wash. Cream, once, above the body.
------------------------------------------------------------------------- */
.ppwb-glance {
  background: var(--ppwb-cream); border-radius: var(--ppwb-r-xl);
  padding: var(--ppwb-s7); margin: 0 0 var(--ppwb-block);
}
.ppwb-glance-label {
  font: 700 var(--ppwb-t-kicker)/1 var(--ppwb-font); letter-spacing: .18em;
  text-transform: uppercase; color: var(--ppwb-gold-ink); margin-bottom: var(--ppwb-s5);
}
.ppwb-glance-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ppwb-s4); }
.ppwb-glance-item {
  position: relative; padding-left: var(--ppwb-s6);
  font-size: var(--ppwb-t-small); line-height: 1.6; color: var(--ppwb-body);
}
.ppwb-glance-item::before {
  content: ""; position: absolute; left: 0; top: 9px; width: 8px; height: 2px; background: var(--ppwb-gold);
}
.ppwb-glance-item strong { color: var(--ppwb-navy); font-weight: 700; }

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
.ppwb-toc {
  background: var(--ppwb-cream); border: 1px solid var(--ppwb-border);
  border-left: 3px solid var(--ppwb-gold); border-radius: var(--ppwb-r-md);
  padding: var(--ppwb-s4) var(--ppwb-s5); margin: 0 0 var(--ppwb-block);
  /* No max-width: the article grid already holds this to --ppwb-col. */
}
.ppwb-toc-tgl { position: absolute; opacity: 0; width: 0; height: 0; }
.ppwb-toc-label {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font: 700 var(--ppwb-t-kicker)/1 var(--ppwb-font); letter-spacing: .16em;
  text-transform: uppercase; color: var(--ppwb-muted);
  cursor: pointer; margin: 0; user-select: none;
}
.ppwb-toc-chev { font-size: 13px; color: var(--ppwb-gold-ink); transition: transform var(--ppwb-t-fast); }
.ppwb-toc-tgl:checked ~ .ppwb-toc-label .ppwb-toc-chev { transform: rotate(180deg); }
.ppwb-toc-tgl:focus-visible ~ .ppwb-toc-label {
  outline: 2px solid var(--ppwb-link); outline-offset: 4px; border-radius: 3px;
}

.ppwb-toc-list {
  display: none; list-style: none; margin: var(--ppwb-s4) 0 0; padding: 0;
  counter-reset: ppwbtoc;
}
.ppwb-toc-tgl:checked ~ .ppwb-toc-list { display: block; }
.ppwb-toc-list li {
  counter-increment: ppwbtoc; position: relative; padding-left: 24px;
  margin: 0 0 9px; break-inside: avoid;
}
.ppwb-toc-list li:last-child { margin-bottom: 0; }
.ppwb-toc-list li::before {
  content: counter(ppwbtoc); position: absolute; left: 0; top: 2px;
  font: 700 11px/1.5 var(--ppwb-font); color: var(--ppwb-gold-ink);
}
.ppwb-toc-link {
  /* Every pill property is unset explicitly. Overriding only font and colour
     leaves the chip's background, border, radius and padding alive in the
     cascade, which produces a pill wearing new typography. */
  background: none; border: 0; border-radius: 0; padding: 0;
  box-shadow: none; transition: none;
  font: 500 14px/1.5 var(--ppwb-font); color: var(--ppwb-navy); text-decoration: none;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ppwb-toc-link:hover {
  background: none; border-color: transparent;
  color: var(--ppwb-link); text-decoration: underline;
}

@media (min-width: 760px) {
  /* Two equal columns. At --ppwb-col 720px each item is 321px, which fits 40
     characters of 14px Poppins 500 before wrapping. Measured, not estimated.
     Labels are written to a 34-character target so a capital or a long final
     word cannot tip a line; anything longer wraps and is clamped at two. */
  .ppwb-toc-list { display: block; columns: 2; column-gap: 34px; margin-top: var(--ppwb-s3); }
  .ppwb-toc-label { cursor: default; margin-bottom: 2px; }
  .ppwb-toc-chev { display: none; }
}

/* ---------------------------------------------------------------------------
   7. CALLOUTS, one shape, four semantic variants
------------------------------------------------------------------------- */
.ppwb-call {
  border: 1px solid var(--ppwb-border); border-left: 3px solid var(--ppwb-gold);
  border-radius: var(--ppwb-r-md); background: var(--ppwb-white);
  padding: var(--ppwb-s5) var(--ppwb-s6); margin: var(--ppwb-block) 0;
  box-shadow: var(--ppwb-shadow); font-size: var(--ppwb-t-small); line-height: 1.65;
}
.ppwb-call-label {
  font: 700 10px/1 var(--ppwb-font); letter-spacing: .06em; text-transform: uppercase;
  color: var(--ppwb-gold-ink); display: block; margin-bottom: var(--ppwb-s2);
}
.ppwb-call p { margin: 0; }
.ppwb-call-warn  { border-left-color: var(--ppwb-warn); background: var(--ppwb-warn-bg); }
.ppwb-call-warn  .ppwb-call-label { color: var(--ppwb-warn); }
.ppwb-call-expert { border-left-color: var(--ppwb-navy); background: var(--ppwb-gray); }
.ppwb-call-expert .ppwb-call-label { color: var(--ppwb-navy); }
.ppwb-call-spec  { border-left-color: var(--ppwb-blue); }
.ppwb-call-spec  .ppwb-call-label { color: var(--ppwb-link); }

/* ---------------------------------------------------------------------------
   8. STEPS, SPECS, QUOTE, FIGURE
   The oversized gold numeral is carried over from collections unchanged
   in spirit, it is the second loud moment and appears at most once.
------------------------------------------------------------------------- */
.ppwb-steps { display: grid; gap: var(--ppwb-s4); margin: var(--ppwb-block) 0; counter-reset: ppwb-step; }
.ppwb-step {
  counter-increment: ppwb-step; display: grid; grid-template-columns: 54px 1fr;
  gap: var(--ppwb-s4); align-items: start;
  border: 1px solid var(--ppwb-border); border-radius: var(--ppwb-r-lg);
  background: var(--ppwb-white); padding: var(--ppwb-s5) var(--ppwb-s6);
  transition: box-shadow var(--ppwb-t-base), transform var(--ppwb-t-base);
}
.ppwb-step:hover { transform: translateY(-2px); box-shadow: var(--ppwb-shadow-hov); }
.ppwb-step::before {
  content: counter(ppwb-step, decimal-leading-zero);
  font: 900 var(--ppwb-t-num)/1 var(--ppwb-font); color: var(--ppwb-gold);
  letter-spacing: -.03em;
}
.ppwb-step-title { font: 700 16px/1.35 var(--ppwb-font); color: var(--ppwb-navy); margin: 0 0 var(--ppwb-s2); }
.ppwb-step-body { font-size: var(--ppwb-t-small); line-height: 1.65; margin: 0; }

.ppwb-specs { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--ppwb-s4); margin: var(--ppwb-block) 0; }
.ppwb-spec { border-top: 2px solid var(--ppwb-gold); padding-top: var(--ppwb-s4); }
.ppwb-spec-num { font: 900 30px/1 var(--ppwb-font); color: var(--ppwb-navy); letter-spacing: -.02em; }
.ppwb-spec-label {
  font: 700 10px/1 var(--ppwb-font); letter-spacing: .06em; text-transform: uppercase;
  color: var(--ppwb-muted); margin: var(--ppwb-s3) 0 var(--ppwb-s2);
}
.ppwb-spec-note { font-size: 13px; line-height: 1.55; color: var(--ppwb-muted); margin: 0; }

.ppwb-quote { margin: var(--ppwb-block) 0; padding-left: var(--ppwb-s6); border-left: 3px solid var(--ppwb-gold); }
.ppwb-quote-text { font: 500 22px/1.45 var(--ppwb-font); color: var(--ppwb-navy); margin: 0; text-wrap: pretty; }
.ppwb-quote-by { font: 500 13px/1.5 var(--ppwb-font); color: var(--ppwb-muted); margin: var(--ppwb-s4) 0 0; }

.ppwb-fig { margin: var(--ppwb-block) 0; }
.ppwb-fig img { border-radius: var(--ppwb-r-lg); width: 100%; }
.ppwb-fig-cap {
  font: 500 13px/1.55 var(--ppwb-font); color: var(--ppwb-muted);
  margin-top: var(--ppwb-s3); padding-left: var(--ppwb-s3); border-left: 2px solid var(--ppwb-gold);
}
/* No-image state: a figure with no asset renders nothing. The generator must
   omit .ppwb-fig entirely rather than shipping a placeholder box. */
.ppwb-fig:empty, .ppwb-fig[data-ppwb-state="empty"] { display: none; }

/* ---------------------------------------------------------------------------
   9. PRODUCTS + COMPARISON
------------------------------------------------------------------------- */
.ppwb-picks { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--ppwb-s5); margin: var(--ppwb-block) 0; }
.ppwb-pick {
  display: flex; flex-direction: column; text-decoration: none;
  border: 1px solid var(--ppwb-border); border-radius: var(--ppwb-r-lg);
  background: var(--ppwb-white); overflow: hidden;
  transition: transform var(--ppwb-t-base), box-shadow var(--ppwb-t-base), border-color var(--ppwb-t-base);
}
.ppwb-pick:hover { transform: translateY(-4px); box-shadow: var(--ppwb-glow); border-color: var(--ppwb-gold); }
.ppwb-pick-img { position: relative; background: var(--ppwb-gray); aspect-ratio: 4 / 3; display: grid; place-items: center; overflow: hidden; }
.ppwb-pick-img img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.ppwb-pick-img[data-ppwb-state="empty"]::after {
  content: attr(data-ppwb-fallback);
  font: 700 var(--ppwb-t-kicker)/1.4 var(--ppwb-font); letter-spacing: .12em;
  text-transform: uppercase; color: var(--ppwb-muted); text-align: center; padding: 0 var(--ppwb-s5);
}
.ppwb-pick-body { padding: var(--ppwb-s5); display: flex; flex-direction: column; gap: var(--ppwb-s2); flex: 1; }
.ppwb-pick-vendor { font: 700 10px/1 var(--ppwb-font); letter-spacing: .1em; text-transform: uppercase; color: var(--ppwb-link); }
.ppwb-pick-title { font: 700 15px/1.35 var(--ppwb-font); color: var(--ppwb-navy); margin: 0; }
.ppwb-pick-specs { display: grid; gap: 5px; font-size: 13px; line-height: 1.45; color: var(--ppwb-muted); margin: var(--ppwb-s1) 0; }
.ppwb-pick-price { font: 800 18px/1 var(--ppwb-font); color: var(--ppwb-navy); margin-top: auto; padding-top: var(--ppwb-s3); }
.ppwb-pick-cta {
  font: 700 11px/1 var(--ppwb-font); letter-spacing: .06em; text-transform: uppercase;
  color: var(--ppwb-link); margin-top: var(--ppwb-s3);
}

.ppwb-cmp-wrap { margin: var(--ppwb-block) 0; border: 1px solid var(--ppwb-border); border-radius: var(--ppwb-r-xl); overflow: hidden; background: var(--ppwb-white); }
.ppwb-cmp { width: 100%; border-collapse: collapse; font-size: 14px; }
.ppwb-cmp thead th {
  background: var(--ppwb-navy); color: var(--ppwb-white); text-align: left;
  font: 700 10px/1.2 var(--ppwb-font); letter-spacing: .08em; text-transform: uppercase;
  padding: var(--ppwb-s4) var(--ppwb-s5);
}
.ppwb-cmp td { padding: var(--ppwb-s4) var(--ppwb-s5); border-top: 1px solid var(--ppwb-border); color: var(--ppwb-body); vertical-align: top; }
.ppwb-cmp-model { font-weight: 700; color: var(--ppwb-navy); }
.ppwb-cmp-strong { font-weight: 700; color: var(--ppwb-gold-ink); }
.ppwb-cmp tbody tr:hover { background: var(--ppwb-cream); }

/* Comparison table rows that name a product PPW sells link to it, with a
   thumbnail, the way collection pages do. Added by linkComparisonTable() in
   lib/article-v2.ts after generation; the model never writes these. */
.ppwb-cmp-link  { display: flex; align-items: center; gap: 10px; color: var(--ppwb-navy); text-decoration: none; font-weight: 700; }
.ppwb-cmp-link:hover { color: var(--ppwb-link); }
.ppwb-cmp-thumb { width: 44px; height: 44px; flex: none; object-fit: cover; border-radius: 6px; background: var(--ppwb-cream); border: 1px solid var(--ppwb-border); }

/* Guide comparison tables. A guide page is not held to the article measure,
   and its tables carry more editorial columns than a blog's, so at 44px the
   thumbnail read as an icon and the columns crowded. Full page width, a 72px
   thumbnail like the collection pages, and the model column given room. */
.ppwb-guidepage .ppwb-cmp-wrap { max-width: none; }
.ppwb-guidepage .ppwb-cmp { font-size: 15px; }
.ppwb-guidepage .ppwb-cmp-link { gap: 14px; align-items: flex-start; }
.ppwb-guidepage td.ppwb-cmp-model { min-width: 260px; }
.ppwb-guidepage .ppwb-cmp tbody tr { transition: background var(--ppwb-t-base); }
.ppwb-guidepage .ppwb-cmp-link::after { content: " \\203A"; color: var(--ppwb-link); font-weight: 700; }
/* 96px, the size collection compare tables use. Two things kept the guide
   thumbnail at a dot you could not read: the base rule is 44px, and
   .ppwb-article img with height:auto outranks .ppwb-cmp-thumb on
   specificity (0,1,1 beats 0,1,0), so any square set on the class alone was
   half-ignored. Both dimensions are declared here on a two-class selector,
   and contain rather than cover so a product shot is not cropped. */
.ppwb-guidepage .ppwb-cmp .ppwb-cmp-thumb {
  width: 96px; height: 96px; min-width: 96px;
  object-fit: contain; background: var(--ppwb-white);
  border-radius: 8px; padding: 4px;
}
@media (max-width: 720px) {
  .ppwb-guidepage .ppwb-cmp .ppwb-cmp-thumb { width: 72px; height: 72px; min-width: 72px; }
  .ppwb-guidepage td.ppwb-cmp-model { min-width: 0; }
}

/* ---------------------------------------------------------------------------
   10. HANDOFFS, guide link, shop CTA, author, sources, related
------------------------------------------------------------------------- */
.ppwb-guide {
  display: flex; gap: var(--ppwb-s5); align-items: center; justify-content: space-between;
  flex-wrap: wrap; margin: var(--ppwb-block) 0;
  border: 1px solid var(--ppwb-border); border-left: 3px solid var(--ppwb-gold);
  border-radius: var(--ppwb-r-md); padding: var(--ppwb-s5) var(--ppwb-s6); text-decoration: none;
  transition: box-shadow var(--ppwb-t-base), border-color var(--ppwb-t-base);
}
.ppwb-guide:hover { box-shadow: var(--ppwb-glow); border-color: var(--ppwb-gold); }
.ppwb-guide-label { font: 700 var(--ppwb-t-kicker)/1 var(--ppwb-font); letter-spacing: .18em; text-transform: uppercase; color: var(--ppwb-gold-ink); }
.ppwb-guide-title { font: 700 16px/1.35 var(--ppwb-font); color: var(--ppwb-navy); margin: var(--ppwb-s2) 0 0; }
.ppwb-guide-go { font: 700 11px/1 var(--ppwb-font); letter-spacing: .06em; text-transform: uppercase; color: var(--ppwb-link); white-space: nowrap; }

.ppwb-shop {
  background: var(--ppwb-navy); border-radius: var(--ppwb-r-xl); color: var(--ppwb-white);
  padding: var(--ppwb-s8) var(--ppwb-s7); margin: var(--ppwb-sectn) 0 0; text-align: center;
}
.ppwb-shop-label { font: 700 var(--ppwb-t-kicker)/1 var(--ppwb-font); letter-spacing: .18em; text-transform: uppercase; color: var(--ppwb-gold); }
.ppwb-shop-title { font: 800 26px/1.15 var(--ppwb-font); letter-spacing: .02em; text-transform: uppercase; color: var(--ppwb-white); margin: var(--ppwb-s4) 0 var(--ppwb-s3); }
.ppwb-shop-sub { font-size: var(--ppwb-t-small); color: rgba(255,255,255,.72); margin: 0 auto var(--ppwb-s6); max-width: 46ch; }
.ppwb-btn {
  display: inline-block; font: 700 12px/1 var(--ppwb-font); letter-spacing: .06em;
  text-transform: uppercase; text-decoration: none; border-radius: var(--ppwb-r-sm);
  padding: 15px 26px; background: var(--ppwb-gold); color: #2A2007;
  transition: background .15s ease, box-shadow .15s ease;
}
.ppwb-btn:hover { background: #DFC18E; box-shadow: var(--ppwb-glow); }
.ppwb-btn-ghost { background: transparent; color: var(--ppwb-white); box-shadow: inset 0 0 0 1px rgba(255,255,255,.34); }
.ppwb-btn-ghost:hover { background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px var(--ppwb-white); }
.ppwb-shop-row { display: flex; gap: var(--ppwb-s3); justify-content: center; flex-wrap: wrap; }
.ppwb-shop-trust { font: 500 var(--ppwb-t-meta)/1 var(--ppwb-font); color: rgba(255,255,255,.55); margin-top: var(--ppwb-s6); }

.ppwb-author {
  display: grid; grid-template-columns: 64px 1fr; gap: var(--ppwb-s5);
  border-top: 2px solid var(--ppwb-gold); padding-top: var(--ppwb-s6); margin: var(--ppwb-sectn) 0 0;
}
.ppwb-author-photo { width: 64px; height: 64px; border-radius: 50%; background: var(--ppwb-gray); object-fit: cover; }
.ppwb-author-photo[data-ppwb-state="empty"] {
  display: grid; place-items: center; font: 800 20px/1 var(--ppwb-font); color: var(--ppwb-navy);
}
.ppwb-author-name { font: 700 16px/1.3 var(--ppwb-font); color: var(--ppwb-navy); margin: 0; }
.ppwb-author-cred { font: 500 12px/1.4 var(--ppwb-font); letter-spacing: .04em; text-transform: uppercase; color: var(--ppwb-gold-ink); margin: var(--ppwb-s2) 0 var(--ppwb-s3); }
.ppwb-author-bio { font-size: 14px; line-height: 1.65; margin: 0; color: var(--ppwb-muted); }
.ppwb-review { font: 500 13px/1.5 var(--ppwb-font); color: var(--ppwb-muted); margin: var(--ppwb-s4) 0 0; }

.ppwb-sources { margin: var(--ppwb-sectn) 0 0; }
.ppwb-sources-label { font: 700 var(--ppwb-t-kicker)/1 var(--ppwb-font); letter-spacing: .18em; text-transform: uppercase; color: var(--ppwb-muted); margin-bottom: var(--ppwb-s4); }
.ppwb-sources-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--ppwb-s3); counter-reset: ppwb-src; }
.ppwb-source { counter-increment: ppwb-src; position: relative; padding-left: var(--ppwb-s6); font-size: 13px; line-height: 1.6; color: var(--ppwb-muted); }
.ppwb-source::before { content: counter(ppwb-src); position: absolute; left: 0; top: 0; font: 700 12px/1.6 var(--ppwb-font); color: var(--ppwb-gold-ink); }

.ppwb-related { margin: var(--ppwb-sectn) 0 0; }
.ppwb-related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--ppwb-s4); }
.ppwb-tile {
  display: block; text-decoration: none; border: 1px solid var(--ppwb-border);
  border-radius: var(--ppwb-r-md); padding: var(--ppwb-s5);
  transition: transform var(--ppwb-t-base), box-shadow var(--ppwb-t-base), border-color var(--ppwb-t-base);
}
.ppwb-tile:hover { transform: translateY(-3px); box-shadow: var(--ppwb-glow); border-color: var(--ppwb-gold); }
.ppwb-tile-hub { font: 700 9.5px/1 var(--ppwb-font); letter-spacing: .1em; text-transform: uppercase; color: var(--ppwb-gold-ink); }
.ppwb-tile-title { font: 700 14px/1.4 var(--ppwb-font); color: var(--ppwb-navy); margin: var(--ppwb-s3) 0 0; }
.ppwb-tile-meta { font: 500 11px/1 var(--ppwb-font); color: var(--ppwb-muted); margin-top: var(--ppwb-s3); }

/* ---------------------------------------------------------------------------
   11. FAQ
   Markup uses .faq-modern from ppw-collections.css, reused as-is and not
   redefined here. Only the article-side wrapper is namespaced.
------------------------------------------------------------------------- */
.ppwb-faq { display: flex; flex-direction: column; gap: var(--ppwb-s3); margin: var(--ppwb-block) 0 0; }

/* ---------------------------------------------------------------------------
   12. RESPONSIVE, mobile is the primary canvas
------------------------------------------------------------------------- */
@media (max-width: 860px) {
  .ppwb-picks, .ppwb-related-grid, .ppwb-specs { grid-template-columns: 1fr; }
  .ppwb-related-grid { gap: var(--ppwb-s3); }
}

@media (max-width: 720px) {
  :root {
    --ppwb-t-h1: 32px; --ppwb-t-deck: 17px; --ppwb-t-h2: 22px; --ppwb-t-h3: 18px;
    --ppwb-t-body: 17px; --ppwb-t-answer: 18px; --ppwb-t-num: 28px;
    --ppwb-block: 32px; --ppwb-sectn: 44px;
  }
  .ppwb-head { padding: var(--ppwb-s7) 0 var(--ppwb-s6); }
  .ppwb-answer, .ppwb-glance { padding: var(--ppwb-s6) var(--ppwb-s5); }
  .ppwb-step { grid-template-columns: 1fr; gap: var(--ppwb-s2); padding: var(--ppwb-s5); }
  .ppwb-shop { padding: var(--ppwb-s7) var(--ppwb-s5); }
  .ppwb-btn { display: block; }
  /* The jump nav is a single-column block below 760px already; nothing to
     override here now that the pill row is gone. */

  /* Comparison table becomes stacked cards. This is a design, not a scroll
     fallback: each row is a card, each cell labelled from data-ppwb-col. */
  .ppwb-cmp-wrap { border: 0; }
  .ppwb-cmp, .ppwb-cmp tbody, .ppwb-cmp tr, .ppwb-cmp td { display: block; width: 100%; }
  .ppwb-cmp thead { display: none; }
  .ppwb-cmp tbody tr {
    border: 1px solid var(--ppwb-border); border-radius: var(--ppwb-r-lg);
    margin-bottom: var(--ppwb-s3); padding: var(--ppwb-s4) var(--ppwb-s5); background: var(--ppwb-white);
  }
  .ppwb-cmp tbody tr:hover { background: var(--ppwb-white); }
  .ppwb-cmp td { border: 0; padding: var(--ppwb-s2) 0; display: flex; justify-content: space-between; gap: var(--ppwb-s4); }
  .ppwb-cmp td::before {
    content: attr(data-ppwb-col); flex: none;
    font: 700 10px/1.6 var(--ppwb-font); letter-spacing: .06em; text-transform: uppercase; color: var(--ppwb-muted);
  }
  .ppwb-cmp td.ppwb-cmp-model {
    display: block; font: 700 16px/1.3 var(--ppwb-font); color: var(--ppwb-navy);
    padding-bottom: var(--ppwb-s3); margin-bottom: var(--ppwb-s2); border-bottom: 1px solid var(--ppwb-border);
  }
  .ppwb-cmp td.ppwb-cmp-model::before { content: none; }
}

/* ---------------------------------------------------------------------------
   13. FOCUS
   Every hover affordance has a matching :focus-visible. The browser default
   outline is near invisible on navy and on the gold button, so focus is drawn
   as a 2px ring plus a 2px offset in the colour that contrasts with the
   element's own background.
------------------------------------------------------------------------- */
.ppwb-article a:focus-visible,
.ppwb-article summary:focus-visible,
.ppwb-article button:focus-visible {
  outline: 2px solid var(--ppwb-link);
  outline-offset: 2px;
  border-radius: var(--ppwb-r-sm);
}
/* Cards: the ring follows the card's own corner radius. */
.ppwb-pick:focus-visible, .ppwb-tile:focus-visible, .ppwb-guide:focus-visible {
  outline: 2px solid var(--ppwb-link); outline-offset: 3px;
  box-shadow: var(--ppwb-glow); border-color: var(--ppwb-gold);
}
.ppwb-pick:focus-visible { border-radius: var(--ppwb-r-lg); }
.ppwb-tile:focus-visible { border-radius: var(--ppwb-r-md); }
.ppwb-guide:focus-visible { border-radius: var(--ppwb-r-md); }
/* On navy and gold fills, blue would disappear, ring in white/navy instead. */
.ppwb-answer a:focus-visible, .ppwb-shop a:focus-visible { outline-color: var(--ppwb-white); }
.ppwb-btn:focus-visible { outline: 2px solid var(--ppwb-white); outline-offset: 3px; }
.ppwb-toc-link:focus-visible { outline: 2px solid var(--ppwb-navy); outline-offset: 2px; }

/* ---------------------------------------------------------------------------
   14. REDUCED MOTION
   Opt out of the card lifts and the gold glow. Hover still reads: the border
   goes gold and a flat shadow remains, so the affordance survives without
   any movement.
------------------------------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  .ppwb-article *, .ppwb-article *::before, .ppwb-article *::after {
    transition-duration: .01ms !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
  .ppwb-step:hover, .ppwb-pick:hover, .ppwb-tile:hover { transform: none; }
  .ppwb-pick:hover, .ppwb-tile:hover, .ppwb-guide:hover { box-shadow: var(--ppwb-shadow); }
  .ppwb-btn:hover { box-shadow: none; }
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
.article-template:has(.ppwb-article) .article-template__title { display: none; }

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
.ppwb-article .ppwb-toc-link        { color: var(--ppwb-navy); }
.ppwb-article .ppwb-toc-link:hover  { color: var(--ppwb-link); }
.ppwb-article .ppwb-btn             { color: #2A2007; }
.ppwb-article .ppwb-btn-ghost       { color: var(--ppwb-white); }
.ppwb-article .ppwb-crumb a         { color: var(--ppwb-muted); }
.ppwb-article .ppwb-a               { color: var(--ppwb-link); }
.ppwb-article .ppwb-cmp-link        { color: var(--ppwb-navy); }
.ppwb-article .ppwb-cmp-link:hover  { color: var(--ppwb-link); }
.ppwb-article .ppwb-answer-src a    { color: #9DC9E8; }
.ppwb-article .ppwb-pick-cta        { color: var(--ppwb-link); }
.ppwb-article .ppwb-guide-go        { color: var(--ppwb-link); }
.ppwb-page .ppwb-hubnav-link        { color: var(--ppwb-navy); }
.ppwb-page .ppwb-hsec-all           { color: var(--ppwb-link); }
.ppwb-page .ppwb-more-btn           { color: var(--ppwb-navy); }

/* Featured image. The theme renders it full-bleed at the top of the article,
   which on desktop pushes the real header a long way down. Cap it to the
   article measure on wide screens; mobile is already fine, so it is untouched. */
@media (min-width: 900px) {
  .article-template:has(.ppwb-article) .article-template__hero,
  .article-template:has(.ppwb-article) .article-template__hero img,
  .article-template:has(.ppwb-article) .article-template__header img {
    max-height: 420px;
    object-fit: cover;
  }
}

/* ---------------------------------------------------------------------------
   15. PRINT
------------------------------------------------------------------------- */
@media print {
  .ppwb-toc, .ppwb-shop, .ppwb-related { display: none; }
  .ppwb-answer { background: var(--ppwb-white); color: var(--ppwb-navy); border: 2px solid var(--ppwb-navy); }
  .ppwb-answer-text { color: var(--ppwb-navy); }
}

/* ============================================================================
   PHASE 3, HUB AND INDEX
   Two listing surfaces, same namespace. They share the article's palette
   roles: navy structure, gold ornament, blue interactivity.

   The nine-colour article-type badge palette is FIXED INPUT and is carried
   over unchanged as --ppwb-type-*. It is the one place the rainbow survives,
   because it encodes meaning the reader has already learned. Hub cards get
   at most one type badge each, so no card ever shows two accent colours.
   ========================================================================= */

:root {
  /* Article-type badges, unchanged from the March 2026 system */
  --ppwb-type-sauna:    #dc3545;
  --ppwb-type-cold:     #17a2b8;
  --ppwb-type-fitness:  #28a745;
  --ppwb-type-wellness: #6f42c1;
  --ppwb-type-listicle: #fd7e14;
  --ppwb-type-celeb:    #e83e8c;
  --ppwb-type-science:  #20c997;
  --ppwb-type-guide:    #0066cc;
  --ppwb-type-clinical: #09195B; /* NEW, see note in README. Navy, deliberately sober */
}

.ppwb-page {
  box-sizing: border-box; font-family: var(--ppwb-font);
  font-size: var(--ppwb-t-body); line-height: 1.72; color: var(--ppwb-body);
  -webkit-font-smoothing: antialiased;
  padding-bottom: var(--ppwb-s10);
}
.ppwb-page, .ppwb-page *, .ppwb-page *::before, .ppwb-page *::after { box-sizing: border-box; }
.ppwb-page img { max-width: 100%; height: auto; display: block; opacity: 1; }
.ppwb-shell { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
.ppwb-page a:focus-visible {
  outline: 2px solid var(--ppwb-link); outline-offset: 3px; border-radius: var(--ppwb-r-sm);
}

/* --- Listing hero. Navy, one per page, mirrors the collection hubs ------- */
.ppwb-lhero { background: var(--ppwb-navy); color: var(--ppwb-white); padding: var(--ppwb-s9) 0; }
.ppwb-lhero-kick {
  font: 700 var(--ppwb-t-kicker)/1 var(--ppwb-font); letter-spacing: .18em;
  text-transform: uppercase; color: var(--ppwb-gold);
  display: inline-flex; align-items: center; gap: var(--ppwb-s2);
}
.ppwb-lhero-kick::before { content: ""; width: 22px; height: 2px; background: var(--ppwb-gold); }
.ppwb-lhero-title {
  font: 900 44px/1.05 var(--ppwb-font); letter-spacing: -.02em; text-transform: uppercase;
  color: var(--ppwb-white); margin: var(--ppwb-s5) 0 0; max-width: 22ch;
}
.ppwb-lhero-sub { font-size: var(--ppwb-t-small); color: rgba(255,255,255,.72); margin: var(--ppwb-s4) 0 0; max-width: 58ch; }
.ppwb-lhero-stats { display: flex; flex-wrap: wrap; gap: var(--ppwb-s7); margin-top: var(--ppwb-s7); }
.ppwb-lhero-stat { display: grid; gap: var(--ppwb-s1); }
.ppwb-lhero-num { font: 900 28px/1 var(--ppwb-font); color: var(--ppwb-gold); }
.ppwb-lhero-lbl { font: 700 10px/1 var(--ppwb-font); letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.58); }

/* --- Hub navigation, six hubs incl. Clinical ----------------------------- */
.ppwb-hubnav { border-bottom: 1px solid var(--ppwb-rule); background: var(--ppwb-white); }
.ppwb-hubnav-row {
  display: flex; gap: var(--ppwb-s2); overflow-x: auto; padding: var(--ppwb-s4) 0;
  scrollbar-width: none;
}
.ppwb-hubnav-row::-webkit-scrollbar { display: none; }
.ppwb-hubnav-link {
  flex: none; font: 700 12px/1 var(--ppwb-font); letter-spacing: .04em; text-transform: uppercase;
  color: var(--ppwb-navy); text-decoration: none; padding: 11px 16px;
  border: 1px solid var(--ppwb-border); border-radius: 999px; background: var(--ppwb-white);
  transition: background var(--ppwb-t-fast), color var(--ppwb-t-fast), border-color var(--ppwb-t-fast);
}
.ppwb-hubnav-link:hover { background: var(--ppwb-gray); border-color: var(--ppwb-navy); }
.ppwb-hubnav-link[aria-current="true"] { background: var(--ppwb-navy); border-color: var(--ppwb-navy); color: var(--ppwb-white); }

/* --- Hub section ---------------------------------------------------------- */
.ppwb-hsec { padding: var(--ppwb-s9) 0 0; }
.ppwb-hsec-head {
  display: flex; align-items: flex-end; justify-content: space-between; gap: var(--ppwb-s5);
  flex-wrap: wrap; border-bottom: 2px solid var(--ppwb-gold); padding-bottom: var(--ppwb-s4);
  margin-bottom: var(--ppwb-s6);
}
.ppwb-hsec-kick { font: 700 var(--ppwb-t-kicker)/1 var(--ppwb-font); letter-spacing: .18em; text-transform: uppercase; color: var(--ppwb-gold-ink); }
.ppwb-hsec-title { font: 800 26px/1.1 var(--ppwb-font); letter-spacing: .02em; text-transform: uppercase; color: var(--ppwb-navy); margin: var(--ppwb-s3) 0 0; }
.ppwb-hsec-sub { font-size: var(--ppwb-t-small); color: var(--ppwb-muted); margin: var(--ppwb-s3) 0 0; max-width: 64ch; }
.ppwb-hsec-all { font: 700 11px/1 var(--ppwb-font); letter-spacing: .06em; text-transform: uppercase; color: var(--ppwb-link); text-decoration: none; white-space: nowrap; }
.ppwb-hsec-all:hover { color: var(--ppwb-navy); }

.ppwb-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--ppwb-s5); }
.ppwb-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--ppwb-s4); }
.ppwb-grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--ppwb-s5); }

/* --- Article card. Type badge is the only accent colour on the card ------ */
.ppwb-card {
  display: flex; flex-direction: column; text-decoration: none; background: var(--ppwb-white);
  border: 1px solid var(--ppwb-border); border-radius: var(--ppwb-r-md); padding: var(--ppwb-s5);
  transition: transform var(--ppwb-t-base), box-shadow var(--ppwb-t-base), border-color var(--ppwb-t-base);
}
.ppwb-card:hover { transform: translateY(-4px); box-shadow: var(--ppwb-glow); border-color: var(--ppwb-gold); }
.ppwb-card:focus-visible { outline: 2px solid var(--ppwb-link); outline-offset: 3px; border-radius: var(--ppwb-r-md); }
.ppwb-type {
  align-self: flex-start; font: 700 9.5px/1 var(--ppwb-font); letter-spacing: .06em;
  text-transform: uppercase; color: var(--ppwb-white); background: var(--ppwb-navy);
  border-radius: 999px; padding: 6px 10px;
}
.ppwb-type-sauna    { background: var(--ppwb-type-sauna); }
.ppwb-type-cold     { background: var(--ppwb-type-cold); }
.ppwb-type-fitness  { background: var(--ppwb-type-fitness); }
.ppwb-type-wellness { background: var(--ppwb-type-wellness); }
.ppwb-type-listicle { background: var(--ppwb-type-listicle); color: #3B2506; }
.ppwb-type-celeb    { background: var(--ppwb-type-celeb); }
.ppwb-type-science   { background: var(--ppwb-type-science); color: #06331F; }
.ppwb-type-guide    { background: var(--ppwb-type-guide); }
.ppwb-type-clinical { background: var(--ppwb-type-clinical); }
.ppwb-card-title { font: 700 15px/1.4 var(--ppwb-font); color: var(--ppwb-navy); margin: var(--ppwb-s4) 0 0; text-wrap: pretty; }
.ppwb-card-dek { font-size: 13.5px; line-height: 1.6; color: var(--ppwb-muted); margin: var(--ppwb-s3) 0 0; }
.ppwb-card-foot {
  display: flex; align-items: center; gap: var(--ppwb-s3); margin-top: auto;
  padding-top: var(--ppwb-s5); font: 500 11px/1 var(--ppwb-font); color: var(--ppwb-muted);
}
.ppwb-card-foot .ppwb-meta-dot { flex: none; }
/* Bulk-import dates read as noise on every card. The generator prints a real
   updated date, or nothing at all. */
.ppwb-card-foot [data-ppwb-optional] { display: inline; }

/* --- Guide card, taller, gold rule, no type badge ----------------------- */
.ppwb-gcard {
  display: flex; flex-direction: column; text-decoration: none;
  border: 1px solid var(--ppwb-border); border-top: 3px solid var(--ppwb-gold);
  border-radius: var(--ppwb-r-md); padding: var(--ppwb-s6) var(--ppwb-s5);
  background: var(--ppwb-cream);
  transition: transform var(--ppwb-t-base), box-shadow var(--ppwb-t-base);
}
.ppwb-gcard:hover { transform: translateY(-4px); box-shadow: var(--ppwb-glow); }
.ppwb-gcard-kick { font: 700 10px/1 var(--ppwb-font); letter-spacing: .12em; text-transform: uppercase; color: var(--ppwb-gold-ink); }
.ppwb-gcard-title { font: 800 18px/1.25 var(--ppwb-font); color: var(--ppwb-navy); margin: var(--ppwb-s4) 0 0; }
.ppwb-gcard-meta { font: 500 11px/1 var(--ppwb-font); letter-spacing: .04em; text-transform: uppercase; color: var(--ppwb-muted); margin-top: auto; padding-top: var(--ppwb-s5); }

/* --- Featured tier, index only ------------------------------------------ */
.ppwb-feat { display: grid; grid-template-columns: 1.4fr 1fr; gap: var(--ppwb-s5); margin-bottom: var(--ppwb-s8); }
.ppwb-feat-main {
  display: flex; flex-direction: column; justify-content: flex-end; text-decoration: none;
  background: var(--ppwb-navy); color: var(--ppwb-white); border-radius: var(--ppwb-r-xl);
  padding: var(--ppwb-s8) var(--ppwb-s7); min-height: 320px; position: relative; overflow: hidden;
  transition: box-shadow var(--ppwb-t-base);
}
.ppwb-feat-main::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--ppwb-gold); }
.ppwb-feat-main:hover { box-shadow: var(--ppwb-glow); }
.ppwb-feat-main .ppwb-card-title { font: 900 30px/1.12 var(--ppwb-font); color: var(--ppwb-white); letter-spacing: -.01em; margin: var(--ppwb-s5) 0 0; max-width: 26ch; }
.ppwb-feat-main .ppwb-card-dek { color: rgba(255,255,255,.72); font-size: var(--ppwb-t-small); max-width: 46ch; }
.ppwb-feat-main .ppwb-card-foot { color: rgba(255,255,255,.55); }
.ppwb-feat-side { display: grid; gap: var(--ppwb-s4); align-content: start; }

/* --- Filter row, index -------------------------------------------------- */
.ppwb-filters {
  display: flex; flex-wrap: wrap; gap: var(--ppwb-s3); align-items: center;
  padding: var(--ppwb-s5) 0; border-bottom: 1px solid var(--ppwb-rule); margin-bottom: var(--ppwb-s7);
}
.ppwb-filters-label { font: 700 10px/1 var(--ppwb-font); letter-spacing: .12em; text-transform: uppercase; color: var(--ppwb-muted); margin-right: var(--ppwb-s2); }
.ppwb-chip {
  font: 600 12px/1 var(--ppwb-font); color: var(--ppwb-navy); text-decoration: none;
  border: 1px solid var(--ppwb-border); border-radius: 999px; padding: 9px 14px;
  background: var(--ppwb-white); cursor: pointer;
  transition: background var(--ppwb-t-fast), color var(--ppwb-t-fast), border-color var(--ppwb-t-fast);
}
.ppwb-chip:hover { background: var(--ppwb-gray); border-color: var(--ppwb-navy); }
.ppwb-chip[aria-pressed="true"] { background: var(--ppwb-navy); border-color: var(--ppwb-navy); color: var(--ppwb-white); }
.ppwb-chip-count { opacity: .6; margin-left: 5px; font-weight: 500; }
.ppwb-count { font: 500 12px/1 var(--ppwb-font); color: var(--ppwb-muted); margin-left: auto; }

/* Load more replaces 82 pages of numbered pagination. */
.ppwb-more { display: flex; justify-content: center; margin-top: var(--ppwb-s8); }
.ppwb-more-btn {
  font: 700 12px/1 var(--ppwb-font); letter-spacing: .06em; text-transform: uppercase;
  color: var(--ppwb-navy); background: var(--ppwb-white); border: 1px solid var(--ppwb-navy);
  border-radius: var(--ppwb-r-sm); padding: 15px 28px; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.ppwb-more-btn:hover { background: var(--ppwb-navy); color: var(--ppwb-white); }
.ppwb-more-btn:focus-visible { outline: 2px solid var(--ppwb-link); outline-offset: 3px; }

/* Empty filter result. A listing surface needs a real no-results state. */
.ppwb-empty {
  border: 1px dashed var(--ppwb-gold); border-radius: var(--ppwb-r-lg);
  padding: var(--ppwb-s8) var(--ppwb-s6); text-align: center;
}
.ppwb-empty-title { font: 800 18px/1.2 var(--ppwb-font); color: var(--ppwb-navy); margin: 0; }
.ppwb-empty-sub { font-size: var(--ppwb-t-small); color: var(--ppwb-muted); margin: var(--ppwb-s3) 0 0; }

@media (max-width: 1000px) {
  .ppwb-grid4 { grid-template-columns: repeat(2, 1fr); }
  .ppwb-feat { grid-template-columns: 1fr; }
}
@media (max-width: 860px) {
  .ppwb-grid3 { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .ppwb-grid3, .ppwb-grid4, .ppwb-grid2 { grid-template-columns: 1fr; }
  .ppwb-lhero { padding: var(--ppwb-s7) 0; }
  .ppwb-lhero-title { font-size: 30px; }
  .ppwb-lhero-stats { gap: var(--ppwb-s5); }
  .ppwb-hsec { padding-top: var(--ppwb-s7); }
  .ppwb-feat-main { padding: var(--ppwb-s6) var(--ppwb-s5); min-height: 0; }
  .ppwb-feat-main .ppwb-card-title { font-size: 24px; }
  .ppwb-count { margin-left: 0; width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .ppwb-page *, .ppwb-page *::before, .ppwb-page *::after {
    transition-duration: .01ms !important; animation-duration: .01ms !important;
  }
  .ppwb-card:hover, .ppwb-gcard:hover { transform: none; box-shadow: var(--ppwb-shadow); }
  .ppwb-feat-main:hover { box-shadow: none; }
}

/* ============================================================================
   PHASE 4, ULTIMATE GUIDES (Aug 2026)
   Guides are Shopify pages at /pages/{slug}, assembled by lib/guide-v2.ts on
   the article system above: same tokens, same blocks, same measure. These are
   the only additions. Everything else a guide renders is already defined.
   ========================================================================= */

/* Hero image sits under the header meta row, inside the text column. */
.ppwb-guide-hero { margin: var(--ppwb-s7) 0 0; }
.ppwb-guide-hero img { width: 100%; border-radius: var(--ppwb-r-lg); }

/* A guide runs 6,000 to 8,000 words, so the cream wash above the body holds
   up to six takeaways and a fourteen-entry nav. Nothing to change; the blocks
   scale. The only guide-specific rhythm rule is a little more air before the
   product cards, which land mid-page rather than above the body. */
.ppwb-guidepage .ppwb-picks { margin-top: var(--ppwb-s6); }

/* Related ultimate guides: the hub's guide card, in a grid after the FAQ. */
.ppwb-guide-related { margin: var(--ppwb-sectn) 0 0; }
.ppwb-guide-related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--ppwb-s4); }
.ppwb-guide-related .ppwb-gcard { padding: var(--ppwb-s5); }
.ppwb-guide-related .ppwb-gcard-title { font-size: 16px; }
.ppwb-guide-related .ppwb-card-dek { font-size: 13px; margin-top: var(--ppwb-s2); }
.ppwb-guide-related .ppwb-gcard:focus-visible {
  outline: 2px solid var(--ppwb-link); outline-offset: 3px; border-radius: var(--ppwb-r-md);
}

/* Sources cited. Guides may cite off-site (articles never do); the list is
   built from the outbound links the body actually kept after verification. */
.ppwb-sources .ppwb-a { color: var(--ppwb-link); }

/* Host theme reconciliation for PAGE templates. The page template prints its
   own title banner (div.page-title holding h1.page-title__title, verified on
   the live theme 24 Aug 2026) above body_html. Scoped with :has() so only a
   v2 guide page hides it. The page modifier class is ppwb-guidepage, NOT
   ppwb-guide: that name belongs to the "Go deeper" guide-link box above. */
.shopify-section:has(.ppwb-guidepage) .page-title,
.main-page-title:has(+ * .ppwb-guidepage) { display: none; }

@media (max-width: 860px) {
  .ppwb-guide-related-grid { grid-template-columns: 1fr; gap: var(--ppwb-s3); }
}
@media print {
  .ppwb-guide-related { display: none; }
}

/* ── 16. Carried content images (revamp keep-images mode) ─────────────
   Figures inserted by the revamp carry step. One per content section,
   full column width, soft corners to match the card language. */
.ppwb-figure { margin: var(--ppwb-s4, 24px) 0; }
.ppwb-figure img { width: 100%; height: auto; border-radius: 12px; display: block; }
.ppwb-figcap { font-size: 0.82rem; color: var(--ppwb-ink-soft, #6b7280); margin-top: 8px; }
`

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">'

/** Everything a v2 article needs to render exactly as it will on the site. */
export const BLOG_PREVIEW_HEAD =
  `${FONT_LINK}<style>${PPW_COLLECTIONS_CSS}</style><style>${PPW_BLOG_CSS}</style>` +
  `<style>html,body{margin:0;padding:0;background:#fff}</style>`

/** Wrap article body_html in a full document for an iframe srcDoc. */
export function buildBlogPreviewDocument(bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `${BLOG_PREVIEW_HEAD}</head><body>${bodyHtml || ''}</body></html>`
}
