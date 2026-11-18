// ============================================================================
// lib/collection-task-enforcer.ts — deterministic enforcement of the 14
// verifiable tasks (docs/PPW_Collection_14_Tasks.md).
//
// Runs AFTER generation/assembly. Each task performs its own check on the
// final HTML and either fixes deterministically, applies provided AI content,
// or reports "failed" with the reason. No task trusts the AI to have
// complied — compliance is verified here.
// ============================================================================
import { blocksOf, findBlock, replaceBlock, removeBlock, extractFaqItems, cloneFaqItem, removeNavLinksFor } from "./collection-improve-engine";

export type TaskResult = { task: string; label: string; status: "pass" | "fixed" | "failed"; detail: string };

export interface EnforcerCtx {
  pk: string;
  catLabel: string;
  brands: string[];
  priceMin: number | null;
  collectionUrl: string;
  collectionTitle: string;
  /** live products for tile matching: title/handle/price/image */
  products: { title: string; handle: string; price: string; imageUrl?: string }[];
  /** Brand collection page — docs/PPW_Brand_Collection_Page_Rules.md */
  isBrand?: boolean;
  /** For brand pages: the brand's own name (leads Q1/H1). */
  brandName?: string;
  /** All carried brand names (competitor detection for brand Q2). */
  allBrandNames?: string[];
  /** AI-generated content available to apply */
  gen: {
    faqQ1?: { q: string; a: string } | null;
    faqQ2?: { q: string; a: string } | null;
    intro?: string | null;   // full <p> element
    bullets?: string | null; // full <ul> element
    brandDescription?: string | null; // for Brand schema on brand pages
  };
}

const FAQ_RE = /frequently asked|faq/i;
const VERBS = /^(define|choose|set|assess|select|plan|measure|compare|match|pick|decide|budget|verify|check|confirm|prioritize|evaluate|identify|determine)\b/i;
const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export function enforceTasks(htmlIn: string, ctx: EnforcerCtx): { html: string; results: TaskResult[] } {
  let html = htmlIn;
  const results: TaskResult[] = [];
  const R = (task: string, label: string, status: TaskResult["status"], detail = "") =>
    results.push({ task, label, status, detail });

  // ── T1 + T2: FAQ Q1/Q2 ─────────────────────────────────────────────────────
  {
    const blk = findBlock(blocksOf(html), FAQ_RE);
    if (!blk) {
      R("T1", "FAQ Q1 commercial intent", "failed", "no FAQ section found");
      R("T2", "FAQ Q2 brand comparison", "failed", "no FAQ section found");
    } else {
      const { items } = extractFaqItems(blk.html);
      let faqHtml = blk.html;
      // Corruption guard: after cloning, the item's extracted answer must
      // start with the intended answer's opening and must NOT contain the old
      // question/answer text (catches partial-insert bugs). Revert on failure.
      const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
      const safeSwap = (oldItem: { html: string; q: string; a: string }, q: string, a: string): { html: string; ok: boolean } => {
        const cloned = cloneFaqItem(oldItem.html, q, a);
        const re = extractFaqItems(cloned).items[0];
        const okQ = re && norm(re.q) === norm(q);
        const okA = re && norm(re.a).startsWith(norm(a).slice(0, 40)) && !norm(re.a).includes(norm(oldItem.a).slice(0, 40) || "\u0000");
        return okQ && okA ? { html: cloned, ok: true } : { html: oldItem.html, ok: false };
      };
      // T1 (brand pages: "What is the best [Brand] [product type]?")
      const q1Want = ctx.isBrand && ctx.brandName
        ? `what is the best ${ctx.brandName.toLowerCase()}`
        : `what is the best ${ctx.pk.toLowerCase()}`;
      const q1Ok = (q: string) => q.toLowerCase().startsWith("what is the best") && (!ctx.isBrand || !ctx.brandName || q.toLowerCase().includes(ctx.brandName.toLowerCase()));
      if (items[0] && q1Ok(items[0].q)) {
        R("T1", "FAQ Q1 commercial intent", "pass", items[0].q.slice(0, 60));
      } else if (items[0] && ctx.gen.faqQ1?.q) {
        const sw = safeSwap(items[0], ctx.gen.faqQ1.q, ctx.gen.faqQ1.a);
        if (sw.ok) { faqHtml = faqHtml.replace(items[0].html, () => sw.html); R("T1", "FAQ Q1 commercial intent", "fixed", `replaced with "${ctx.gen.faqQ1.q.slice(0, 50)}"`); }
        else R("T1", "FAQ Q1 commercial intent", "failed", "corruption guard rejected the swap — original kept, regenerate");
      } else {
        R("T1", "FAQ Q1 commercial intent", "failed", items[0] ? `still "${items[0].q.slice(0, 50)}" — no replacement generated (want "${q1Want}?")` : "no FAQ items parsed");
      }
      // T2 (re-extract after possible T1 swap)
      const items2 = extractFaqItems(faqHtml).items;
      const brandsLower = ctx.brands.map((b) => b.toLowerCase());
      const q2ok = ctx.isBrand
        ? items2[1] && /compare|vs\b|versus/i.test(items2[1].q) && (ctx.allBrandNames || [])
            .filter((b) => !ctx.brandName || b.toLowerCase() !== ctx.brandName.toLowerCase())
            .some((b) => (items2[1].q + " " + items2[1].a).toLowerCase().includes(b.toLowerCase()))
        : items2[1] && /compare|vs\b|versus/i.test(items2[1].q) && brandsLower.some((b) => items2[1].q.toLowerCase().includes(b));
      if (q2ok) {
        R("T2", "FAQ Q2 brand comparison", "pass", items2[1].q.slice(0, 60));
      } else if (items2[1] && ctx.gen.faqQ2?.q) {
        const sw2 = safeSwap(items2[1], ctx.gen.faqQ2.q, ctx.gen.faqQ2.a);
        if (sw2.ok) { faqHtml = faqHtml.replace(items2[1].html, () => sw2.html); R("T2", "FAQ Q2 brand comparison", "fixed", `replaced with "${ctx.gen.faqQ2.q.slice(0, 50)}"`); }
        else R("T2", "FAQ Q2 brand comparison", "failed", "corruption guard rejected the swap — original kept, regenerate");
      } else {
        R("T2", "FAQ Q2 brand comparison", "failed", items2[1] ? `still "${items2[1].q.slice(0, 50)}"` : "fewer than 2 FAQ items parsed");
      }
      if (faqHtml !== blk.html) html = replaceBlock(html, blk, faqHtml);
    }
  }

  // ── T3: intro paragraph ────────────────────────────────────────────────────
  {
    const firstBlk = blocksOf(html)[0];
    const scope = firstBlk ? firstBlk.html : html;
    const pMatch = scope.match(/<p[^>]*>[\s\S]*?<\/p>/i);
    const check = (p: string) => {
      const t = text(p);
      const firstTwo = t.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").toLowerCase();
      const brandOk = ctx.brands.some((b) => firstTwo.includes(b.toLowerCase()));
      const priceOk = /(from|starting at)\s*\$\s?\d/i.test(t) || /\$\s?\d/.test(t);
      return { brandOk, priceOk };
    };
    if (!pMatch) R("T3", "Intro: brands early + price anchor", "failed", "no intro paragraph found");
    else {
      const { brandOk, priceOk } = check(pMatch[0]);
      if (brandOk && priceOk) R("T3", "Intro: brands early + price anchor", "pass");
      else if (ctx.gen.intro && /<p/i.test(ctx.gen.intro) && check(ctx.gen.intro).brandOk) {
        html = html.replace(pMatch[0], () => ctx.gen.intro as string);
        R("T3", "Intro: brands early + price anchor", "fixed", `brands:${brandOk ? "had" : "added"} price:${priceOk ? "had" : "added"}`);
      } else if (!priceOk && brandOk && ctx.priceMin) {
        // Deterministic partial fix: append the price anchor sentence.
        const anchorTxt = ` Pricing starts at ${fmt(ctx.priceMin)}.</p>`;
        const withPrice = pMatch[0].replace(/<\/p>$/i, () => anchorTxt);
        html = html.replace(pMatch[0], () => withPrice);
        R("T3", "Intro: brands early + price anchor", "fixed", "price anchor appended");
      } else R("T3", "Intro: brands early + price anchor", "failed", `brands:${brandOk ? "ok" : "MISSING"} price:${priceOk ? "ok" : "MISSING"} — no valid rewrite generated`);
    }
  }

  // ── T4: six-slot bullets ───────────────────────────────────────────────────
  {
    const firstBlk = blocksOf(html)[0];
    const scope = firstBlk ? firstBlk.html : html;
    const ulMatch = scope.match(/<ul[^>]*>[\s\S]*?<\/ul>/i);
    if (!ulMatch) R("T4", "Overview bullets: six slots", "failed", "no overview <ul> found");
    else {
      const liCount = (ulMatch[0].match(/<li/gi) || []).length;
      const hasDashLabels = /<li[^>]*>[^<]*—/.test(ulMatch[0]) || /<\/strong>\s*—/.test(ulMatch[0]);
      const genLis = ctx.gen.bullets ? (ctx.gen.bullets.match(/<li/gi) || []).length : 0;
      if (liCount === 6 && !hasDashLabels) R("T4", "Overview bullets: six slots", "pass", "6 bullets, colon labels");
      else if (genLis === 6) {
        html = html.replace(ulMatch[0], () => ctx.gen.bullets as string);
        R("T4", "Overview bullets: six slots", "fixed", `${liCount} -> 6 bullets, slot structure applied`);
      } else {
        let fixedUl = ulMatch[0];
        let did = false;
        if (hasDashLabels) { fixedUl = fixedUl.replace(/(<\/strong>)\s*—\s*/gi, "$1: ").replace(/\s*—\s*/g, ": "); did = true; }
        if (did) { html = html.replace(ulMatch[0], () => fixedUl); R("T4", "Overview bullets: six slots", "fixed", `dash labels -> colons; still ${liCount}/6 bullets (no 6-slot rewrite generated)`); }
        else R("T4", "Overview bullets: six slots", "failed", `${liCount}/6 bullets — no valid rewrite generated`);
      }
    }
  }

  // ── T8: comparison table removal (loosened: any Compare-headed block) ─────
  {
    const blks = blocksOf(html);
    const bg = findBlock(blks, /buying guide/i);
    const cmp = findBlock(blks, /compare/i);
    if (ctx.isBrand) {
      // Brand rule: the compare table is the PRIMARY navigation — never remove.
      const hasPrices = cmp ? /\$\s?\d/.test(cmp.html) : false;
      R("T8", "Brand: compare table kept as primary navigation", cmp ? (hasPrices ? "pass" : "failed") : "failed",
        cmp ? (hasPrices ? "present with prices" : "table present but has NO prices — incomplete") : "no compare table on a brand page");
    } else if (bg && cmp) {
      html = removeNavLinksFor(html, cmp); // paired op: nav link dies WITH the section
      html = removeBlock(html, findBlock(blocksOf(html), /compare/i) || cmp);
      html = html.replace(/<a\b[^>]*href="#[^"]*compare[^"]*"[^>]*>[\s\S]*?<\/a>/gi, "");
      html = html.replace(/<a\b[^>]*>\s*Compare[^<]{0,30}<\/a>/gi, "");
      R("T8", "Comparison section + its nav link removed (paired)", "fixed", `removed "${cmp.heading.slice(0, 40)}" and matching topnav link(s)`);
    } else {
      // Even without a fresh removal, clean any nav link that points at a
      // section id that no longer exists (loose ends from earlier runs).
      const navHrefs = [...html.matchAll(/<a\b[^>]*href="#([^"]+)"[^>]*>[\s\S]*?<\/a>/gi)];
      let cleaned = 0;
      for (const m of navHrefs) {
        if (!new RegExp(`id="${m[1].replace(/[.*+?^$()|[\]{}]/g, "\\$&")}"`).test(html)) {
          html = html.replace(m[0], "");
          cleaned++;
        }
      }
      R("T8", "Comparison section + its nav link removed (paired)", cleaned ? "fixed" : "pass", cleaned ? `${cleaned} dead nav link(s) removed` : (cmp ? "no buying guide on page" : "no comparison section"));
    }
  }

  // ── Compare table thumbnails: first column = 96px product image + name ────
  {
    const cmp = findBlock(blocksOf(html), /compare/i);
    if (cmp && /<table\b/i.test(cmp.html)) {
      const hasImgCol = /<t[dh][^>]*>\s*<img/i.test(cmp.html);
      if (hasImgCol) R("T15", "Compare table has image thumbnails", "pass");
      else {
        let newCmp = cmp.html;
        let stamped = 0;
        newCmp = newCmp.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (row, inner: string) => {
          const rowText = text(inner).toLowerCase();
          if (/<th/i.test(inner)) return row.replace(/<th/i, () => "<th></th><th"); // header: empty image col
          const hit = ctx.products.find((pr) => {
            const t = pr.title.toLowerCase();
            return rowText.includes(t.slice(0, Math.min(18, t.length))) || t.split(/\s+/).slice(0, 3).every((w) => w.length < 3 || rowText.includes(w));
          });
          if (!hit || !hit.imageUrl) return row;
          stamped++;
          const cell = `<td style="vertical-align:top"><img src="${hit.imageUrl}" alt="${hit.title}" width="96" style="width:96px;border-radius:6px" loading="lazy" /><div style="font-weight:700;font-size:12px;margin-top:4px">${hit.title.split(/\s+/).slice(0, 4).join(" ")}</div></td>`;
          return row.replace(/<td/i, () => cell + "<td");
        });
        if (stamped > 0) {
          html = replaceBlock(html, cmp, newCmp);
          R("T15", "Compare table has image thumbnails", "fixed", `thumbnails added to ${stamped} row(s)`);
        } else R("T15", "Compare table has image thumbnails", "failed", "no rows matched to products (check product titles vs table rows)");
      }
    } else if (cmp) R("T15", "Compare table has image thumbnails", "pass", "no <table> markup in compare section");
  }

  // ── T9 + T10: buying guide heading verbs + bullet counts ──────────────────
  {
    const bg = findBlock(blocksOf(html), /buying guide/i);
    if (!bg) { R("T9", "Buying guide headings start with verbs", "failed", "no buying guide section"); R("T10", "Buying guide cards: 3 bullets each", "failed", "no buying guide section"); }
    else {
      const h3s = [...bg.html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => text(m[1]));
      const badVerbs = h3s.filter((h) => !VERBS.test(h));
      R("T9", "Buying guide headings start with verbs", badVerbs.length === 0 && h3s.length > 0 ? "pass" : "failed",
        badVerbs.length ? `non-verb heading(s): ${badVerbs.slice(0, 2).join("; ")}` : `${h3s.length} headings`);
      // T10: trim each card's <ul> to 3 lis deterministically
      let newBg = bg.html;
      let trimmed = 0;
      newBg = newBg.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (full, inner: string) => {
        const lis = [...inner.matchAll(/<li[\s\S]*?<\/li>/gi)].map((m) => m[0]);
        if (lis.length > 3) { trimmed++; return full.replace(inner, lis.slice(0, 3).join("\n")); }
        return full;
      });
      if (trimmed > 0) { html = replaceBlock(html, bg, newBg); R("T10", "Buying guide cards: 3 bullets each", "fixed", `trimmed ${trimmed} card(s) to 3 bullets`); }
      else R("T10", "Buying guide cards: 3 bullets each", "pass");
    }
  }

  // ── T11: CTA on EVERY featured product tile ───────────────────────────────
  // .ppw-type cards are <a> elements (anchors can't nest, so lazy-match to
  // </a> is structurally safe). The CTA span is inserted as the LAST child
  // before </a> — never inside the image div. Exact markup per the task doc.
  {
    const CTA_SPAN = `<span style="display:block;margin-top:.75rem;padding:.6rem 1rem;background:#1E40AF;color:#fff;border-radius:8px;text-align:center;font-weight:700;font-size:.9rem;">View Product Details &rarr;</span>`;
    const blks = blocksOf(html);
    const tilesBlk = blks.find((b) => /featured|types|picks/i.test(b.heading));
    if (!tilesBlk) R("T11", "Product tiles: View Product Details CTAs", "failed", "no featured/types section found");
    else {
      let newTiles = tilesBlk.html;
      let added = 0, already = 0, priceAdded = 0;
      // Pass 1: anchor cards (<a class="...ppw-type...">...</a>)
      newTiles = newTiles.replace(/<a\b[^>]*class="[^"]*ppw-type[^"]*"[^>]*>[\s\S]*?<\/a>/gi, (card) => {
        // Brand pages: "View [Model] →" CTAs count too (any View...→ span/button).
        if (/view product details/i.test(card) || (ctx.isBrand && /view [^<]{2,40}(→|&rarr;)/i.test(card))) { already++; return card; }
        let priceBit = "";
        if (!/\$\s?\d/.test(card)) {
          const href = card.match(/href="([^"]*\/products\/([^"?#]+))"/i);
          const hit = href ? ctx.products.find((p) => p.handle === href[2]) : undefined;
          if (hit?.price) { priceBit = `<span style="display:block;margin-top:.5rem;font-weight:600;">${fmt(parseFloat(hit.price))}</span>`; priceAdded++; }
        }
        added++;
        return card.replace(/<\/a>\s*$/i, () => `${priceBit}${CTA_SPAN}</a>`);
      });
      // Pass 2: div-based cards (fallback for other tile markups) — only when
      // no anchor cards matched, to avoid double-handling.
      if (added === 0 && already === 0) {
        const divCards = [...newTiles.matchAll(/<div\b[^>]*class="[^"]*(?:ppw-type|ppw-card|tile)[^"]*"[^>]*>/gi)];
        for (const m of divCards) {
          // find the balanced close for THIS div
          let depth = 0, i = m.index as number, end = -1;
          const re = /<div\b|<\/div>/gi;
          re.lastIndex = i;
          let t: RegExpExecArray | null;
          while ((t = re.exec(newTiles)) !== null) {
            depth += t[0] === "</div>" ? -1 : 1;
            if (depth === 0) { end = t.index + t[0].length; break; }
          }
          if (end === -1) continue;
          const card = newTiles.slice(m.index as number, end);
          if (/view product details/i.test(card)) { already++; continue; }
          const href = card.match(/href="([^"]*\/products\/[^"?#]+)"/i)?.[1];
          if (!href) continue;
          const withCta = card.replace(/<\/div>\s*$/i, () => `${CTA_SPAN}</div>`);
          newTiles = newTiles.slice(0, m.index as number) + withCta + newTiles.slice(end);
          added++;
        }
      }
      if (added > 0) {
        html = replaceBlock(html, tilesBlk, newTiles);
        R("T11", "Product tiles: View Product Details CTAs", "fixed", `CTA added to ${added} tile(s)${priceAdded ? `, price to ${priceAdded}` : ""}${already ? `; ${already} already had one` : ""}`);
      } else if (already > 0) R("T11", "Product tiles: View Product Details CTAs", "pass", `all ${already} tile(s) have CTAs`);
      else R("T11", "Product tiles: View Product Details CTAs", "failed", "no .ppw-type / card tiles matched");
    }
  }

  // ── T12: Learning heading begins with "Complete" ──────────────────────────
  {
    const m = html.match(/<h2[^>]*>\s*((?!Complete)[^<]*Learning (?:Center|Resources)[^<]*)<\/h2>/i);
    if (m) {
      html = html.replace(m[0], m[0].replace(m[1], `Complete ${m[1].trim()}`));
      R("T12", 'Learning heading begins with "Complete"', "fixed", `-> "Complete ${m[1].trim().slice(0, 40)}"`);
    } else R("T12", 'Learning heading begins with "Complete"', /Complete [^<]*Learning/i.test(html) ? "pass" : "failed", /Learning/i.test(html) ? "" : "no learning section on page");
  }

  // ── T7: care section exact H3 labels (verify only — AI builds content) ────
  {
    const care = findBlock(blocksOf(html), /care|warranty|maintenance/i);
    if (!care) R("T7", "Care: exact three H3 subsections", "failed", "no care section");
    else {
      const h3s = [...care.html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => text(m[1]).toLowerCase());
      const want = ["cleaning and daily care", "routine maintenance", "warranty coverage"];
      const missing = want.filter((w) => !h3s.some((h) => h.includes(w)));
      const hasProse = !/<ul/i.test(care.html);
      R("T7", "Care: exact three H3 subsections", missing.length === 0 && !hasProse ? "pass" : "failed",
        missing.length ? `missing: ${missing.join(", ")}` : hasProse ? "prose paragraph instead of bullet lists" : "");
    }
  }

  // ── T14: em dashes outside H2s ─────────────────────────────────────────────
  {
    const h2Saved: string[] = [];
    let tmp = html.replace(/<h2[^>]*>[\s\S]*?<\/h2>/gi, (m) => { h2Saved.push(m); return `___H2_${h2Saved.length - 1}___`; });
    const n = (tmp.replace(/<script[\s\S]*?<\/script>/gi, "").match(/—/g) || []).length;
    if (n > 0) tmp = tmp.replace(/\s*—\s*/g, ", ");
    html = tmp.replace(/___H2_(\d+)___/g, (_m, i) => h2Saved[Number(i)]);
    R("T14", "Em dashes only in H2 subheadings", n > 0 ? "fixed" : "pass", n ? `${n} removed` : "");
  }

  return { html, results };
}

// ── T5 + T6 + T13 are schema tasks, handled by buildSchemaForTasks ──────────

/** Build the single @graph: FAQPage + BreadcrumbList + ItemList synced to the
 *  first four featured product URLs on the page. Returns results for T5/T6/T13. */
export function buildSchemaForTasks(
  html: string,
  faqPairs: { q: string; a: string }[],
  ctx: Pick<EnforcerCtx, "collectionUrl" | "collectionTitle" | "catLabel" | "isBrand" | "brandName"> & { brandDescription?: string | null }
): { schemaTag: string; results: TaskResult[] } {
  const results: TaskResult[] = [];
  const graph: any[] = [];

  if (faqPairs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faqPairs.map((p) => ({
        "@type": "Question", name: p.q,
        acceptedAnswer: { "@type": "Answer", text: p.a.split(/\s+/).slice(0, 200).join(" ") },
      })),
    });
  }

  graph.push({
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://peakprimalwellness.com" },
      { "@type": "ListItem", position: 2, name: ctx.collectionTitle, item: ctx.collectionUrl },
    ],
  });
  results.push({ task: "T5", label: "BreadcrumbList in @graph", status: "fixed", detail: "Home + collection" });

  // ItemList from the featured/types section's first 4 product links
  const blks = blocksOf(html);
  const featured = blks.find((b) => /featured|types|picks/i.test(b.heading));
  const scope = featured ? featured.html : html;
  // Brand pages: 4-12 items (featured + compare table); category pages: exactly 4.
  const scopeAll = ctx.isBrand ? html : scope;
  const urls = [...new Set([...scopeAll.matchAll(/href="([^"]*\/products\/[^"?#]+)"/gi)].map((m) => m[1]))].slice(0, ctx.isBrand ? 12 : 4);
  // Shopify duplication suffixes are "-copy" or a single non-zero digit
  // ("-1", "-2"). Zero-padded endings like "-01" are model numbers (GDI-8123-01).
  const dup = urls.filter((u) => /(-copy|-[1-9])$/.test(u));
  if (urls.length > 0) {
    // Per-item name: pulled from the tile card that contains the product link
    // (strong/heading text), falling back to a prettified handle.
    const nameFor = (u: string): string => {
      const esc = u.replace(/[.*+?^$()|[\]{}]/g, "\\$&");
      const card = scope.match(new RegExp(`<a[^>]*href="${esc}"[^>]*>([\\s\\S]*?)<\\/a>`, "i"))?.[1] || "";
      const strong = card.match(/<(?:strong|h3|h4)[^>]*>([\s\S]*?)<\/(?:strong|h3|h4)>/i)?.[1];
      if (strong) return strong.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const handle = u.split("/products/")[1] || u;
      return handle.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    };
    graph.push({
      "@type": "ItemList",
      name: ctx.isBrand && ctx.brandName ? `${ctx.brandName} Products at Peak Primal Wellness` : `Featured ${ctx.catLabel} at Peak Primal Wellness`,
      itemListElement: urls.map((u, i) => ({
        "@type": "ListItem", position: i + 1,
        name: nameFor(u),
        url: u.startsWith("http") ? u : `https://peakprimalwellness.com${u}`,
      })),
    });
    results.push({ task: "T6", label: "ItemList synced to featured products", status: dup.length ? "failed" : "fixed", detail: dup.length ? `dup-suffix handle(s): ${dup.join(", ")}` : `${urls.length} product URL(s)` });
  } else {
    results.push({ task: "T6", label: "ItemList synced to featured products", status: "failed", detail: "no product links found on page" });
  }

  // Brand schema — brand pages only (docs/PPW_Brand_Collection_Page_Rules.md).
  if (ctx.isBrand && ctx.brandName) {
    graph.push({
      "@type": "Brand",
      name: ctx.brandName,
      url: ctx.collectionUrl,
      ...(ctx.brandDescription ? { description: ctx.brandDescription } : {}),
    });
    results.push({ task: "T-Brand", label: "Brand schema in @graph", status: "fixed", detail: ctx.brandDescription ? "with description" : "name + url (no description generated)" });
  }

  results.push({ task: "T13", label: "Single ld+json @graph block", status: "fixed", detail: `${graph.length} types in one block` });
  return { schemaTag: `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>`, results };
}
