// ============================================================================
// lib/theme-css.ts — copy of the Shopify theme asset ppw-collections.css,
// used ONLY to style in-app preview iframes (srcDoc). The live source of
// truth is the theme asset; update both together when the design changes.
// v2 (July 31): + component classes — shared styling moved out of inline
// attributes to keep body_html under the Shopify 64 KB cap.
// ============================================================================

export const PPW_COLLECTIONS_CSS = `
/* ============================================================
   PPW COLLECTIONS — THEME STYLESHEET  (v1 · July 29 2026)
   Shopify: Online Store → Themes → Edit code → Assets →
   Add new asset → ppw-collections.css → paste this file.
   Then in layout/theme.liquid, inside <head>, add:
   {{ 'ppw-collections.css' | asset_url | stylesheet_tag }}

   Scope: ONLY what inline styles cannot do — hover states,
   FAQ accordion behavior, responsive grid collapses.
   Everything else in the new collection design is inline.
   Class names map 1:1 to what the Generate tool emits.
   ============================================================ */

/* ── HOVER STATES ──────────────────────────────────────────── */

/* Nav pills + secondary buttons: navy fill on hover */
.ppw-hv-nav { transition: background-color .18s, color .18s, border-color .18s; }
.ppw-hv-nav:hover { background: #09195B !important; color: #fff !important; border-color: #09195B !important; }

/* Product / pick cards: gold glow lift (the premium signal) */
.ppw-hv-gold { transition: box-shadow .2s, transform .2s, border-color .2s; }
.ppw-hv-gold:hover {
  box-shadow: 0 14px 34px rgba(200,169,110,.4) !important;
  transform: translateY(-4px);
  border-color: #c8a96e !important;
}

/* Light tiles (sub-collection nav, small links): subtle gold border lift */
.ppw-hv-tile { transition: background-color .18s, border-color .18s, transform .18s; }
.ppw-hv-tile:hover { background: #fff !important; border-color: #c8a96e !important; transform: translateY(-2px); }

/* Neutral card lift (no gold — learn cards, info cards) */
.ppw-hv-lift { transition: box-shadow .2s, transform .2s; }
.ppw-hv-lift:hover { transform: translateY(-2px); box-shadow: 0 14px 36px rgba(0,0,0,.08) !important; }

/* Primary navy CTA on dark/footer contexts: gold-light text on hover */
.ppw-hv-navy-gold { transition: background-color .18s, color .18s, border-color .18s; }
.ppw-hv-navy-gold:hover { background: #09195B !important; border-color: #09195B !important; color: #dfc18e !important; }

/* Cream wash hover (soft rows, list items) */
.ppw-hv-cream { transition: background-color .18s, border-color .18s; }
.ppw-hv-cream:hover { background: #fdfaf4 !important; border-color: #c8a96e !important; }

/* Gold-light fill hover (gold buttons) */
.ppw-hv-goldfill { transition: background-color .18s; }
.ppw-hv-goldfill:hover { background: #dfc18e !important; }

/* ── FAQ ACCORDION (.faq-modern) ───────────────────────────── */

.faq-modern details summary { cursor: pointer; list-style: none; }
.faq-modern details summary::-webkit-details-marker { display: none; }
.faq-modern .chev { display: inline-block; transition: transform .2s; }
.faq-modern details[open] .chev { transform: rotate(180deg); }
.faq-modern details .body { overflow: hidden; }

/* ── RESPONSIVE GRIDS ──────────────────────────────────────────
   The generator puts grid-template-columns on these CLASSES
   (not inline) so they can collapse on mobile. gap/other grid
   props stay inline. */

.ppw-g2 { display: grid; grid-template-columns: repeat(2, 1fr); }
.ppw-g3 { display: grid; grid-template-columns: repeat(3, 1fr); }
.ppw-g4 { display: grid; grid-template-columns: repeat(4, 1fr); }
.ppw-g5 { display: grid; grid-template-columns: repeat(5, 1fr); }

/* Hero/overview splits: text + fixed media column */
.ppw-split-380 { display: grid; grid-template-columns: minmax(0,1fr) 380px; }
.ppw-split-340 { display: grid; grid-template-columns: minmax(0,1fr) 340px; }
.ppw-split-320 { display: grid; grid-template-columns: minmax(0,1fr) 320px; }
.ppw-split-300 { display: grid; grid-template-columns: minmax(0,1fr) 300px; }

/* Compare row: image column + flexible columns */
.ppw-row-210 { display: grid; grid-template-columns: 210px repeat(3, minmax(0,1fr)); }

@media (max-width: 980px) {
  .ppw-g4, .ppw-g5 { grid-template-columns: repeat(2, 1fr); }
  .ppw-g3 { grid-template-columns: repeat(2, 1fr); }
  .ppw-row-210 { grid-template-columns: 140px repeat(3, minmax(0,1fr)); }
}

@media (max-width: 700px) {
  .ppw-g2, .ppw-g3, .ppw-g4, .ppw-g5 { grid-template-columns: 1fr; }
  .ppw-split-380, .ppw-split-340, .ppw-split-320, .ppw-split-300 { grid-template-columns: 1fr; }
  .ppw-row-210 { grid-template-columns: 1fr; }
}

/* ── SMALL SAFETIES ────────────────────────────────────────── */

/* Sticky-nav anchor offset so section jumps don't hide under headers */
.ppw-anchor { scroll-margin-top: 110px; }

/* Images inside design sections never overflow */
[id="overview"] img, [id="picks"] img, [id="compare"] img,
[id="lineup"] img, [id="tiers"] img { max-width: 100%; height: auto; }

/* ══ v2 COMPONENT CLASSES (July 31) ═══════════════════════════
   Shared styling moved OUT of inline attributes: Shopify caps
   collection body_html at 64 KB and fully-inline pages on big
   collections (sauna heaters) blew past it. The Generate tool
   emits these classes; only one-off values stay inline. */

.ppw-sec{padding:44px clamp(16px,4vw,40px);scroll-margin-top:110px}
.ppw-sec-cream{background:#faf7f1;border-top:1px solid #eee3d1}
.ppw-sec-b{border-top:1px solid #e5e7eb}
.ppw-sec-navy{background:#09195B}
.ppw-sec-blush{background:#fff9f6;border-top:1px solid #f0e4dc}
.ppw-eyebrow{display:inline-block;font:700 10.5px/1 Poppins,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#8a6d2f;border:1px solid rgba(200,169,110,.55);background:rgba(200,169,110,.1);border-radius:999px;padding:7px 12px;margin-bottom:14px}
.ppw-eyebrow-light{color:#dfc18e;border-color:rgba(223,193,142,.45);background:rgba(223,193,142,.1)}
.ppw-h2{margin:0 0 24px;font:800 28px/1.05 Poppins,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:#09195B}
.ppw-p{margin:0 0 12px;font:400 15px/1.65 Poppins,sans-serif;color:#4b5563;max-width:72ch}
.ppw-pill{padding:7px 13px;border:1px solid #e5e7eb;border-radius:999px;font:600 12px/1 Poppins,sans-serif;color:#09195B;text-decoration:none}
.ppw-check{display:flex;gap:11px;align-items:flex-start;font:400 14.5px/1.55 Poppins,sans-serif;color:#374151}
.ppw-check>span:first-child{flex:none;width:20px;height:20px;margin-top:2px;border-radius:50%;background:#dcfce7;display:grid;place-items:center}
.ppw-check strong{color:#111827;font-weight:700}
.ppw-fig{margin:0;border:1px solid #eef0f3;border-radius:14px;padding:14px;box-shadow:0 8px 22px rgba(0,0,0,.06);background:#fff}
.ppw-fig img{width:100%;border-radius:10px;display:block}
.ppw-pick{display:flex;flex-direction:column;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,.04);text-decoration:none;color:inherit}
.ppw-pick-img{position:relative;aspect-ratio:1;background:#f4f6f9}
.ppw-pick-img img{width:100%;height:100%;object-fit:cover;display:block}
.ppw-badge{position:absolute;top:11px;left:11px;font:700 9.5px/1 Poppins,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:6px 9px;border-radius:999px}
.ppw-badge-gold{background:rgba(200,169,110,.16);color:#7d6229;border:1px solid rgba(200,169,110,.65)}
.ppw-badge-navy{background:#09195B;color:#fff}
.ppw-badge-dark{background:#111827;color:#fff}
.ppw-pick-body{padding:16px;display:flex;flex-direction:column;flex:1}
.ppw-pick-vendor{font:600 10.5px/1 Poppins,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#1E40AF;margin-bottom:7px}
.ppw-pick-title{font:700 15px/1.3 Poppins,sans-serif;color:#09195B;margin-bottom:10px}
.ppw-pick-specs{display:flex;flex-direction:column;gap:5px;flex:1;margin-bottom:10px}
.ppw-pick-specs span{font:400 12.5px/1.5 Poppins,sans-serif;color:#4b5563}
.ppw-pick-price{font:800 15px/1 Poppins,sans-serif;color:#09195B;margin-bottom:12px}
.ppw-cta{display:block;text-align:center;background:#09195B;color:#fff;font:700 12px/1 Poppins,sans-serif;letter-spacing:.04em;text-transform:uppercase;padding:12px;border-radius:8px}
.ppw-gcard{border:1px solid #eeeef3;border-radius:14px;background:#fff;padding:22px 20px;box-shadow:0 10px 28px rgba(0,0,0,.06)}
.ppw-ghead{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.ppw-gnum{flex:none;width:44px;height:44px;border-radius:999px;background:rgba(200,169,110,.14);border:1px solid rgba(200,169,110,.5);display:grid;place-items:center;font:800 16px/1 Poppins,sans-serif;color:#8a6d2f}
.ppw-gcard h3{margin:0;font:800 17px/1.15 Poppins,sans-serif;text-transform:uppercase;letter-spacing:.02em;color:#09195B}
.ppw-gcard p{margin:0;font:400 13.5px/1.6 Poppins,sans-serif;color:#4b5563}
.ppw-gcard p strong,.ppw-bcard p strong{color:#111827;font-weight:700}
.ppw-glist{display:flex;flex-direction:column;gap:9px}
.ppw-bcard{border:1px solid #e5e7eb;border-radius:12px;padding:20px;display:flex;gap:16px;background:#fff}
.ppw-bicon{flex:none;width:46px;height:46px;border-radius:12px;background:#f9fafb;border:1px solid #eef0f3;display:grid;place-items:center;font-size:20px}
.ppw-bcard h3{margin:0 0 6px;font:800 15px/1.2 Poppins,sans-serif;text-transform:uppercase;letter-spacing:.02em;color:#09195B}
.ppw-bcard p{margin:0;font:400 13.5px/1.6 Poppins,sans-serif;color:#4b5563}
.ppw-btile{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:12px;text-decoration:none;color:inherit}
.ppw-blogo{height:44px;border-radius:6px;background:#f9fafb;display:grid;place-items:center;overflow:hidden;font:700 11px/1 Poppins,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#8b93a5}
.ppw-blogo img{max-height:38px;max-width:85%;object-fit:contain}
.ppw-btile-name{font:800 14px/1.2 Poppins,sans-serif;color:#09195B;margin-bottom:5px}
.ppw-btile-sub{font:400 12px/1.5 Poppins,sans-serif;color:#6b7280}
.ppw-btile-cta{margin-top:auto;font:700 11px/1 Poppins,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#1E40AF}
.ppw-stat{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px}
.ppw-stat-num{font:800 30px/1 Poppins,sans-serif;color:#b3903f;margin-bottom:10px}
.ppw-stat h3{margin:0 0 6px;font:800 14px/1.2 Poppins,sans-serif;text-transform:uppercase;letter-spacing:.02em;color:#09195B}
.ppw-stat p{margin:0;font:400 13px/1.6 Poppins,sans-serif;color:#4b5563}
.ppw-own{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:20px}
.ppw-own-head{display:flex;align-items:center;gap:11px;margin-bottom:12px}
.ppw-own h3{margin:0;font:800 15px/1.2 Poppins,sans-serif;text-transform:uppercase;letter-spacing:.02em;color:#fff}
.ppw-own p{margin:0 0 12px;font:400 13.5px/1.65 Poppins,sans-serif;color:rgba(255,255,255,.8)}
.ppw-own-meta{display:flex;flex-direction:column;gap:7px}
.ppw-own-meta span{font:500 12.5px/1.4 Poppins,sans-serif;color:rgba(255,255,255,.72)}
.ppw-pillar{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;border:1px solid #e5e7eb;border-left:3px solid #c8a96e;border-radius:12px;padding:24px 26px;margin-bottom:18px;background:#fff;text-decoration:none;color:inherit}
.ppw-pillar-kicker{font:700 10px/1 Poppins,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8a6d2f;margin-bottom:9px}
.ppw-pillar-title{font:800 21px/1.2 Poppins,sans-serif;text-transform:uppercase;letter-spacing:.02em;color:#09195B}
.ppw-pillar-cta{flex:none;font:700 11.5px/1 Poppins,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:#1E40AF;white-space:nowrap}
.ppw-ltile{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px;display:block;text-decoration:none;color:inherit}
.ppw-ltile-kicker{font:600 10px/1 Poppins,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8b93a5;margin-bottom:9px}
.ppw-ltile-title{font:700 14.5px/1.35 Poppins,sans-serif;color:#09195B}
.ppw-faqcol{display:flex;flex-direction:column;gap:10px}
.faq-modern .item details{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 4px 14px rgba(0,0,0,.04)}
.faq-modern .item summary{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 20px;font:700 14.5px/1.4 Poppins,sans-serif;color:#111827}
.faq-modern .item .chev{flex:none;color:#1E40AF;font:700 15px/1 Poppins,sans-serif}
.faq-modern .item .body{padding:0 20px 20px;font:400 14px/1.7 Poppins,sans-serif;color:#374151}
.faq-modern .item .body p{margin:0}
.ppw-cmp-wrap{border:1px solid #e5e7eb;border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 8px 22px rgba(0,0,0,.04)}
.ppw-cmp-scroll{overflow-x:auto}
.ppw-cmp{border-collapse:collapse;width:100%;min-width:640px}
.ppw-cmp th{padding:14px 16px;background:#09195B;color:#dfc18e;font:700 10.5px/1.3 Poppins,sans-serif;letter-spacing:.1em;text-transform:uppercase;text-align:left}
.ppw-cmp th+th{border-left:1px solid rgba(255,255,255,.1)}
.ppw-cmp td{padding:14px 16px;border-top:1px solid #f1f3f6;font:400 13px/1.5 Poppins,sans-serif;color:#4b5563;vertical-align:top}
.ppw-cmp .ti{width:140px;text-align:center}
.ppw-cmp .ti img{width:96px;height:auto;border-radius:8px;border:1px solid #e5e7eb;display:inline-block}
.ppw-cmp .ti div{margin-top:.35rem;font:700 12px/1.3 Poppins,sans-serif;color:#09195B}
.ppw-cmp .tm{font-weight:700;color:#09195B}
.ppw-cmp .tp{font-weight:800;color:#09195B;white-space:nowrap}
.ppw-cmp .ts{color:#1E40AF;font:700 12px/1 Poppins,sans-serif;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;white-space:nowrap}
.ppw-glance{border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#f9fafb}
.ppw-glance-label{font:700 10.5px/1 Poppins,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8a6d2f;margin-bottom:14px}
.ppw-glance-rows{display:flex;flex-direction:column;gap:12px}
.ppw-glance-row{display:flex;justify-content:space-between;gap:12px;padding-bottom:10px;border-bottom:1px solid #e9ecf1}
.ppw-glance-row:last-child{padding-bottom:0;border-bottom:none}
.ppw-glance-row span:first-child{font:500 12.5px/1.4 Poppins,sans-serif;color:#6b7280}
.ppw-glance-row span:last-child{font:700 12.5px/1.4 Poppins,sans-serif;color:#111827;text-align:right}
.ppw-tier{border:1px solid #e5e7eb;border-radius:14px;background:#fff;overflow:hidden}
.ppw-tier-mid{border:2px solid #c8a96e;box-shadow:0 14px 36px rgba(200,169,110,.35)}
.ppw-tier-head{padding:18px 20px;border-bottom:1px solid #f1f3f6}
.ppw-tier-mid .ppw-tier-head{background:#c8a96e}
.ppw-tier-kicker{font:700 10px/1 Poppins,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8b93a5;margin-bottom:8px}
.ppw-tier-mid .ppw-tier-kicker{color:rgba(9,25,91,.7)}
.ppw-tier-name{font:800 18px/1.15 Poppins,sans-serif;text-transform:uppercase;letter-spacing:.02em;color:#09195B}
.ppw-tier-body{padding:18px 20px;display:flex;flex-direction:column;gap:12px}
.ppw-tier-row{display:flex;justify-content:space-between;gap:10px}
.ppw-tier-row span:first-child{font:500 12.5px Poppins,sans-serif;color:#6b7280}
.ppw-tier-row span:last-child{font:700 12.5px Poppins,sans-serif;color:#111827;text-align:right}
.ppw-tier-body p{margin:4px 0 0;font:400 13px/1.6 Poppins,sans-serif;color:#4b5563}
.ppw-fitcard{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px}
.ppw-fitcard h3{margin:0 0 14px;font:800 14px/1.2 Poppins,sans-serif;text-transform:uppercase;letter-spacing:.04em}
.ppw-fitlist{display:flex;flex-direction:column;gap:10px}
.ppw-fit-row{display:flex;gap:10px;font:400 14px/1.55 Poppins,sans-serif;color:#374151}
.ppw-fit-row>span:first-child{flex:none;font:700 14px/1.5 Poppins,sans-serif}
.ppw-ctile{border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px;display:flex;gap:12px;align-items:flex-start;background:#fff}
.ppw-ctile-title{font:700 13px/1.3 Poppins,sans-serif;color:#09195B;margin-bottom:4px}
.ppw-ctile-sub{font:400 12.5px/1.5 Poppins,sans-serif;color:#6b7280}
`;

export const PREVIEW_HEAD = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${PPW_COLLECTIONS_CSS}</style>`;
