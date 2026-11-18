// ============================================================================
// lib/collection-improve-engine.ts — section-replacement engine for the
// collection Improve flow.
//
// Root-cause fix from docs/PPW_Collection_Tool_Eval_Barrel_Sauna.md:
//   "The tool must output complete section replacements, not appended
//    additions... Never create a new section with a different class name to
//    replace the functionality of an existing one."
//
// Every mutation here REPLACES in place, preserves the page's own class names
// and wrappers, clones existing FAQ item markup for new questions, and merges
// all JSON-LD into ONE @graph block (FAQPage + ItemList only — the Shopify
// theme already emits BreadcrumbList).
// ============================================================================

export type Block = { heading: string; start: number; end: number; html: string };

const stripTags = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Split the page into top-level <section> blocks (v0 pages), falling back to
 *  H2-boundary pseudo-blocks when the page isn't section-based. */
export function blocksOf(html: string): Block[] {
  const blocks: Block[] = [];
  const sectionRe = /<section\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(html)) !== null) {
    const start = m.index;
    const close = html.indexOf("</section>", start);
    if (close === -1) continue;
    const end = close + "</section>".length;
    const inner = html.slice(start, end);
    const h2 = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    blocks.push({ heading: h2 ? stripTags(h2[1]) : "", start, end, html: inner });
    sectionRe.lastIndex = end;
  }
  if (blocks.length > 0) return blocks;
  // H2-boundary fallback
  const idx: number[] = [];
  for (const mm of html.matchAll(/<h2\b/gi)) if (mm.index !== undefined) idx.push(mm.index);
  idx.push(html.length);
  for (let i = 0; i < idx.length - 1; i++) {
    const chunk = html.slice(idx[i], idx[i + 1]);
    const h2 = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    blocks.push({ heading: h2 ? stripTags(h2[1]) : "", start: idx[i], end: idx[i + 1], html: chunk });
  }
  return blocks;
}

export function findBlock(blocks: Block[], re: RegExp): Block | null {
  return blocks.find((b) => re.test(b.heading)) || null;
}

/** Replace a block's exact range. Returns new html. */
export function replaceBlock(html: string, block: Block, newHtml: string): string {
  return html.slice(0, block.start) + newHtml + html.slice(block.end);
}

/** Remove a block entirely. */
export function removeBlock(html: string, block: Block): string {
  return html.slice(0, block.start) + html.slice(block.end);
}

/** Insert content immediately after a block. */
export function insertAfterBlock(html: string, block: Block, addition: string): string {
  return html.slice(0, block.end) + "\n" + addition + html.slice(block.end);
}

// ── FAQ item handling: clone the page's OWN item markup ─────────────────────

export type FaqItem = { html: string; q: string; a: string };

const ITEM_PATTERNS: RegExp[] = [
  // .faq-modern wrapper style: <div class="item"><details>...</details></div>
  /<div class="item">\s*<details[\s\S]*?<\/details>\s*<\/div>/gi,
  // bare details (any class flavor)
  /<details[\s\S]*?<\/details>/gi,
];

export function extractFaqItems(faqHtml: string): { items: FaqItem[]; pattern: RegExp } {
  for (const pat of ITEM_PATTERNS) {
    pat.lastIndex = 0;
    const matches = [...faqHtml.matchAll(pat)];
    if (matches.length > 0) {
      const items = matches.map((m) => {
        const h = m[0];
        const summary = h.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
        let q = "";
        if (summary) {
          const span = summary[1].match(/<span[^>]*>([\s\S]*?)<\/span>/i);
          q = stripTags(span ? span[1] : summary[1]).replace(/[+−]\s*$/, "").trim();
        }
        const bodyM =
          h.match(/<div class="body"[^>]*>([\s\S]*?)<\/div>\s*<\/details>/i) ||
          h.match(/<div[^>]*class="[^"]*ppw-faq-answer[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
          h.match(/<\/summary>([\s\S]*?)<\/details>/i);
        return { html: h, q, a: bodyM ? stripTags(bodyM[1]) : "" };
      });
      return { items, pattern: pat };
    }
  }
  return { items: [], pattern: ITEM_PATTERNS[1] };
}

/** Build a new FAQ item by cloning an existing item's exact markup and
 *  swapping only the question and answer text. */
export function cloneFaqItem(template: string, q: string, a: string): string {
  // CRITICAL: every replacement below uses a FUNCTION, never a template
  // string. Q/A text regularly contains prices like "$20,639" and in a string
  // replacement "$2" means "insert capture group 2" — which once spliced the
  // OLD answer into the middle of the new one. Function replacements do no
  // $-substitution. Full overwrite of the body container, never insertion.
  let out = template;
  out = out.replace(/(<summary[^>]*>)([\s\S]*?)(<\/summary>)/i, (_all, open: string, inner: string, close: string) => {
    if (/<span/i.test(inner)) {
      const swapped = inner.replace(/(<span[^>]*>)([\s\S]*?)(<\/span>)/i, (_m, so: string, _si: string, sc: string) => so + q + sc);
      return open + swapped + close;
    }
    return open + q + close;
  });
  if (/<div class="body"/i.test(out)) {
    out = out.replace(/(<div class="body"[^>]*>)([\s\S]*?)(<\/div>\s*<\/details>)/i, (_m, o: string, _i: string, c: string) => `${o}<p>${a}</p>${c}`);
  } else if (/ppw-faq-answer/i.test(out)) {
    out = out.replace(/(<div[^>]*class="[^"]*ppw-faq-answer[^"]*"[^>]*>)([\s\S]*?)(<\/div>)/i, (_m, o: string, _i: string, c: string) => `${o}<p>${a}</p>${c}`);
  } else {
    out = out.replace(/(<\/summary>)([\s\S]*?)(<\/details>)/i, (_m, o: string, _i: string, c: string) => `${o}<p>${a}</p>${c}`);
  }
  return out;
}

/** Section deletion and nav-link deletion are ALWAYS paired: removes topnav
 *  anchors pointing at the block's id(s) or matching its heading text. */
export function removeNavLinksFor(html: string, block: Block): string {
  let out = html;
  const ids = new Set<string>();
  const secId = block.html.match(/<section\b[^>]*id="([^"]+)"/i)?.[1];
  if (secId) ids.add(secId);
  for (const m of block.html.slice(0, 400).matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  for (const id of ids) {
    out = out.replace(new RegExp(`<a\\b[^>]*href="#${id.replace(/[.*+?^$()|[\\]{}]/g, "\\$&")}"[^>]*>[\\s\\S]*?<\\/a>`, "gi"), "");
  }
  const headWords = block.heading.trim().split(/\s+/).slice(0, 2).join("[\\s]+");
  if (headWords.length > 3) {
    out = out.replace(new RegExp(`<a\\b[^>]*href="#[^"]*"[^>]*>\\s*${headWords}[^<]{0,40}<\\/a>`, "gi"), "");
  }
  // Tidy the nav: collapse the blank gap a removed link leaves behind.
  out = out.replace(/(<nav\b[^>]*ppw-topnav[\s\S]*?<\/nav>)/i, (nav) => nav.replace(/\n[ \t]*\n+/g, "\n"));
  return out;
}

// ── Schema: single @graph block ──────────────────────────────────────────────

/** Strip every ld+json script from the body and return them parsed. */
export function extractAndStripSchema(html: string): { html: string; blocks: any[] } {
  const blocks: any[] = [];
  const out = html.replace(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, (_m, raw: string) => {
    try {
      const p = JSON.parse(raw.trim());
      if (Array.isArray(p)) blocks.push(...p);
      else if (p["@graph"]) blocks.push(...p["@graph"]);
      else blocks.push(p);
    } catch { /* drop malformed */ }
    return "";
  });
  return { html: out, blocks };
}

/** Build the ONE allowed schema block: FAQPage (rebuilt) + ItemList (kept or
 *  provided). BreadcrumbList deliberately omitted — the theme emits its own. */
export function buildUnifiedSchema(
  faqPairs: { q: string; a: string }[],
  existingBlocks: any[],
  itemListOverride?: any | null
): string {
  const graph: any[] = [];
  if (faqPairs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faqPairs.map((p) => ({
        "@type": "Question",
        name: p.q,
        acceptedAnswer: { "@type": "Answer", text: p.a.split(/\s+/).slice(0, 200).join(" ") },
      })),
    });
  }
  const existingItemList = existingBlocks.find((b) => b && b["@type"] === "ItemList");
  const itemList = itemListOverride || existingItemList;
  if (itemList) graph.push(itemList);
  if (graph.length === 0) return "";
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>`;
}
