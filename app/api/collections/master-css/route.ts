import { NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

/**
 * GET /api/collections/master-css
 *
 * Assembles the MASTER collection stylesheet live from the canonical pages:
 * hyperbaric-chambers (base — the most refined) plus any selectors the other
 * reference pages define that the base lacks. There is no static master CSS
 * file anywhere — styles live embedded per collection — so this endpoint IS
 * the master, always current.
 *
 *   ?doc=1  -> markdown doc with Claude Design Studio context + fenced CSS
 *   (default) -> raw text/css download
 */

export const maxDuration = 120;

const API_VERSION = "2024-10";
const CANONICAL = ["hyperbaric-chambers", "barrel-saunas", "infrared-saunas", "cold-plunges"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TOKENS_HEADER = `/* ============================================================
   GTD MASTER COLLECTION STYLESHEET
   Assembled live from: ${CANONICAL.join(", ")}
   Base: hyperbaric-chambers (canonical). Others contribute only
   selectors the base lacks (source-commented below).

   DESIGN TOKENS
   Accent:        #1E40AF   (--gtd-accent)
   Gold:          #c8a96e   (--gtd-gold — champagne, from homepage + new PDPs)
   Gold light:    #dfc18e   (--gtd-gold-light)
   Gold alphas:   rgba(200,169,110, .08-.15 washes / .2-.3 borders / .35-.4 glows)
   Cream:         #f5f0e8 / #ede5d4 (warm section backgrounds)
   Navy ramp:     #09195B / #14297a / #1f3aa3 (headings, dark surfaces)
   Border:        #e5e7eb   (--gtd-border)
   Muted bg:      #f9fafb   (--gtd-muted)
   Body text:     #374151 / #4b5563
   Card radius:   12-16px
   Card shadow:   0 4px 14px rgba(0,0,0,.04) to 0 10px 28px rgba(0,0,0,.06)
   Class prefix:  gtd-   (FAQ accordion: .faq-modern .item / .chev / .body)

   GOLD USAGE (matches homepage + new product pages — keep it scarce):
   YES: section eyebrow/kicker labels above H2s (gold text + thin gold border,
        like the PDP "Product Overview" tags); featured-tile badges (gold
        outline or text on cream/navy); accent dividers + quote border-left;
        hover glow on premium tiles (box-shadow gold @ .35-.4); soft section
        washes (gold @ .08-.12 or cream) to alternate section backgrounds;
        brand-bar labels/dots.
   NO:  body text, in-content links (stay #1E40AF), backgrounds at full
        opacity, more than one gold-filled button per viewport. Blue remains
        the default action color in collection content; gold-filled CTAs are
        reserved for the highest-emphasis tile per section (homepage pattern).
   ============================================================ */\n\n`;

const DESIGN_STUDIO_PREAMBLE = `# GTD Master Collection CSS — for Claude Design Studio

Paste this context before any design request:

> I run Green Thumb Depot, a premium wellness equipment ecommerce store selling high-ticket products including infrared saunas ($1,899 to $21,995), hyperbaric chambers ($4,495 to $42,999), and home gym equipment. Buyers are health-conscious, research-oriented, and spending significant money. The design should feel premium, clinical-clean, and trustworthy rather than flashy or lifestyle-heavy.
>
> Brand variables to preserve throughout: Accent #1E40AF (blue) · Premium gold #c8a96e with light variant #dfc18e (used as an alpha ramp rgba(200,169,110,.08-.4)) · Cream backgrounds #f5f0e8/#ede5d4 · Navy ramp #09195B/#14297a/#1f3aa3 · Border #e5e7eb · Muted background #f9fafb · Body text #374151 and #4b5563 · Card radius 12-16px · Card shadow 0 4px 14px rgba(0,0,0,.04) to 0 10px 28px rgba(0,0,0,.06). CSS class names must use the gtd- prefix. Output should be clean HTML and CSS I can adapt for Shopify collection descriptions.
>
> Gold is the premium signal, used sparingly like on our homepage and product pages: section eyebrow/kicker labels (gold text + thin gold border), featured-tile badges, accent dividers and quote borders, hover glows on premium tiles, and soft low-alpha section washes. Gold never colors body text or in-content links (those stay blue #1E40AF), and at most one gold-filled CTA per viewport.

Below is the CURRENT production CSS (merged from the four most refined live collections). New designs should redefine these classes rather than invent new naming.

`;

function topRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") { depth--; if (depth === 0) { rules.push(css.slice(start, i + 1).trim()); start = i + 1; } }
  }
  return rules.filter(Boolean);
}
const selOf = (r: string) => r.slice(0, r.indexOf("{")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();

async function bodyHtmlFor(handle: string, token: string): Promise<string> {
  for (const type of ["custom", "smart"] as const) {
    const res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${API_VERSION}/${type}_collections.json?handle=${encodeURIComponent(handle)}&limit=1`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (res.ok) {
      const d = await res.json();
      const hit = d?.[`${type}_collections`]?.[0];
      if (hit) return hit.body_html || "";
    }
    await sleep(600);
  }
  return "";
}

const styleOf = (html: string) =>
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .filter((c) => /\.gtd-|faq-modern/.test(c))
    .join("\n");

export async function GET(request: NextRequest) {
  try {
    const token = await getShopifyAccessToken();
    const [baseHandle, ...rest] = CANONICAL;
    const base = styleOf(await bodyHtmlFor(baseHandle, token));
    if (!base) return NextResponse.json({ error: `No embedded style block found on ${baseHandle}` }, { status: 500 });

    const seen = new Set(topRules(base).map(selOf));
    let additions = "";
    for (const h of rest) {
      await sleep(600);
      const css = styleOf(await bodyHtmlFor(h, token));
      const fresh: string[] = [];
      for (const r of topRules(css)) {
        const s = selOf(r);
        if (s && !seen.has(s)) { seen.add(s); fresh.push(r); }
      }
      if (fresh.length) additions += `\n\n/* ── from ${h} ── */\n` + fresh.join("\n");
    }

    const css = TOKENS_HEADER + base.trim() + additions;
    const wantDoc = new URL(request.url).searchParams.get("doc");
    if (wantDoc) {
      const md = DESIGN_STUDIO_PREAMBLE + "```css\n" + css + "\n```\n";
      return new NextResponse(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": 'attachment; filename="GTD-Master-Collection-CSS-for-Design-Studio.md"',
        },
      });
    }
    return new NextResponse(css, {
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Content-Disposition": 'attachment; filename="gtd-master-collection.css"',
      },
    });
  } catch (error) {
    console.error("[master-css] Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "master-css failed" }, { status: 500 });
  }
}
