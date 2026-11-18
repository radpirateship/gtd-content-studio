// PPW article style block — shared by generate + revamp article assembly.
// Extracted from app/api/generate/route.ts so revamp uses identical styling.
// ════════════════════════════════════════════════════════════════════════════
// FROZEN. LEGACY ONLY. DO NOT EDIT.
//
// This is the template_version 1 stylesheet. It ships inside the body_html of
// roughly a thousand published articles, and normalizeArticleBodyHtml strips
// and reattaches it whenever a legacy article is republished. Editing this
// constant therefore changes how existing articles render, including
// well-ranking ones with hand edits that cannot be regenerated.
//
// The live design system is the ppw-blog.css theme asset, emitted through
// lib/article-v2.ts as template_version 2. Make design changes there.
// ════════════════════════════════════════════════════════════════════════════
export const PPW_STYLES = `<style>
/* --- LAYOUT RESET & SAFETY NETS --- */
.ppw-wrap{max-width:1200px;margin:0 auto;padding:1rem;font-family:system-ui,-apple-system,sans-serif}
.ppw-topnav p, .ppw-grid p, .ppw-product-image-container p { display: contents; margin: 0; padding: 0; }
p:empty { display: none; }

/* --- SECTIONS & TYPOGRAPHY --- */
.ppw-section{margin:3rem 0; clear: both;}
.ppw-h1{color:#1a1a1a;margin-bottom:1rem;font-size:2.8rem;line-height:1.2;font-weight:700}
.ppw-sm{font-size:1.5rem!important;color:#666;line-height:1.6}
.ppw-center{text-align:center}

/* --- NAVIGATION (ROUNDED BUTTONS) --- */
.ppw-topnav{display:flex;gap:1rem;flex-wrap:wrap;padding:0;margin-bottom:3rem;background:transparent}
.ppw-topnav a{background:#0066cc!important;color:#fff!important;text-decoration:none;font-size:1.4rem!important;font-weight:600;padding:0.8rem 1.5rem;border-radius:50px;transition:background 0.2s;line-height:1;display:inline-block}
.ppw-topnav a:hover{background:#0052a3!important}

/* --- HEADERS & META --- */
.ppw-kicker{font-size:1.4rem;font-weight:600;text-transform:uppercase;color:#0066cc;margin-bottom:0.5rem}
.ppw-subtitle{font-size:1.8rem;color:#666;margin-top:0.5rem;line-height:1.4}
.ppw-meta{display:flex;gap:0.5rem;align-items:center;font-size:1.5rem;color:#666;margin-top:1rem}
.ppw-dot::before{content:"•"}

/* --- CONTAINERS --- */
.ppw-muted{background:#f8f9fa;padding:2.5rem;border-radius:12px;border:1px solid #e9ecef}
.ppw-callout{border-left:5px solid #0066cc;padding:1.5rem;background:#f0f7ff;border-radius:0 8px 8px 0;margin:2rem 0}

/* --- GRIDS & CARDS --- */
.ppw-grid{display:grid;gap:2rem;margin:2rem 0}
.ppw-grid.cols-2{grid-template-columns:repeat(2,1fr)}
.ppw-grid.cols-3{grid-template-columns:repeat(3,1fr)}
.ppw-card{border:1px solid #e0e0e0;border-radius:8px;padding:1.5rem;height:100%;background:#fff;display:flex;flex-direction:column}
.ppw-card-title{margin:0 0 1rem 0;font-size:1.8rem}

/* --- PRODUCTS --- */
.ppw-product-card{background:#fff;border:2px solid #e5e7eb;border-radius:16px;padding:2rem;display:flex;flex-direction:column;height:100%;position:relative;overflow:hidden;transition:all 0.3s ease}
.ppw-product-card:hover{box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);transform:translateY(-4px);border-color:#0066cc}
.ppw-product-card h3{font-size:1.8rem;margin:0.5rem 0;color:#111827}
.ppw-product-card ul{margin:1rem 0;padding-left:0;list-style:none;font-size:1.5rem}
.ppw-product-card li{margin-bottom:0.75rem;line-height:1.6}
.ppw-product-image-container{text-align:center;margin-bottom:1.5rem;width:100%;height:260px;display:flex;align-items:center;justify-content:center;background:#f3f4f6;border-radius:12px;overflow:hidden}
.ppw-product-image{max-width:100%;max-height:240px;object-fit:contain;transition:transform 0.3s}
.ppw-product-card:hover .ppw-product-image{transform:scale(1.05)}

/* --- BUTTONS & LINKS --- */
.ppw-links{color:#0066cc!important;text-decoration:none;font-weight:600}
.ppw-links:hover{text-decoration:underline}
.ppw-cta{display:inline-block;padding:1rem 2rem;background:#0066cc!important;color:#fff!important;text-decoration:none;border-radius:6px;font-weight:600;text-align:center;transition:background 0.2s}
.ppw-cta:hover{background:#0052a3!important;color:#fff!important}

/* --- IMAGES --- */
.ppw-content-image{width:100%;max-width:800px;display:block;margin:3rem auto !important;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);float:none !important}
.ppw-content-image img{width:100%;max-width:800px;height:auto;object-fit:contain;display:block;float:none !important;margin:0 auto !important}
.ppw-badge{display:inline-block;padding:0.35rem 1rem;border-radius:9999px;font-size:1.2rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#fff}

/* --- FAQ --- */
.ppw-faq-list{border-top:1px solid #ddd;margin-top:2rem}
.ppw-faq-item{border-bottom:1px solid #ddd}
.ppw-faq-question{width:100%;text-align:left;padding:1.5rem 0;font-size:1.6rem;font-weight:600;cursor:pointer;list-style:none;color:#333}
.ppw-faq-question::-webkit-details-marker{display:none}
.ppw-faq-question::before{content:"+";float:right;font-size:2rem;font-weight:300;color:#0066cc}
details[open] .ppw-faq-question::before{content:"\u2212"}
.ppw-faq-answer{padding:0 0 1.5rem 0;color:#555}

/* --- MOBILE --- */
@media(max-width:768px){
.ppw-grid.cols-2,.ppw-grid.cols-3{grid-template-columns:1fr}
.ppw-product-image-container{height:240px}
.ppw-product-image{max-height:220px}
.ppw-cta{width:100%}
}
</style>`;

