import { type NextRequest, NextResponse } from "next/server";
import { fetchAdminProducts } from "@/lib/shopify/products-admin";
import { blocksOf, findBlock, insertAfterBlock } from "@/lib/collection-improve-engine";
import { callAI } from "@/lib/ai";
import { WRITING_RULES, BANNED_PHRASES } from "@/lib/brandRules";
import { DOC_BANNED } from "@/lib/collectionGrade";

/**
 * POST /api/collections/fix-section
 * Targeted fixes for "Left over from Improve" items, run from the Revamp Tool.
 * Operates on the EDITOR's current html (draft or live) and returns the new
 * html — nothing publishes here.
 *
 * Actions:
 *   featured-products — build a 4-tier featured section from live catalog data
 *                       (entry / mid-range / spacious / premium, prices + CTAs)
 *   banned-phrases    — AI rewrites ONLY the blocks containing banned phrases
 */

export const maxDuration = 120;

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

export async function POST(request: NextRequest) {
  try {
    const { slug, action, bodyHtml, collectionTitle } = await request.json();
    if (!slug || !action || typeof bodyHtml !== "string") {
      return NextResponse.json({ error: "slug, action, and bodyHtml are required" }, { status: 400 });
    }

    if (action === "featured-products") {
      const products = await fetchAdminProducts({ collectionHandle: slug, limit: 50 });
      const priced = products
        .map((p) => ({ ...p, priceNum: parseFloat(p.price) }))
        .filter((p) => Number.isFinite(p.priceNum) && p.priceNum > 0)
        .sort((a, b) => a.priceNum - b.priceNum);
      if (priced.length < 2) {
        return NextResponse.json({ error: `Only ${priced.length} priced product(s) in this collection — not enough for a 4-tier section` }, { status: 400 });
      }
      const pick = (r: number) => priced[Math.min(priced.length - 1, Math.round(r * (priced.length - 1)))];
      const tiers = [
        { p: pick(0), badge: "Best Entry Value" },
        { p: pick(0.4), badge: "Best Mid-Range Pick" },
        { p: pick(0.72), badge: "Most Room & Comfort" },
        { p: pick(1), badge: "Highest Spec" },
      ];
      // de-dup when the collection is small
      const seen = new Set<string>();
      const cards = tiers
        .filter((t) => !seen.has(t.p.handle) && seen.add(t.p.handle))
        .map((t) => `<div style="border:1px solid #e2e2e2;border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:8px;background:#fff">
<span style="align-self:flex-start;background:#1d4ed8;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${t.badge}</span>
${t.p.imageUrl ? `<img src="${t.p.imageUrl}" alt="${t.p.title}" style="width:100%;border-radius:8px" loading="lazy" />` : ""}
<strong style="font-size:15px">${t.p.title}</strong>
<span style="font-size:14px;color:#333">${fmt(t.p.priceNum)}</span>
<a href="/products/${t.p.handle}" style="margin-top:auto;font-weight:600;color:#1d4ed8;text-decoration:none">View Product Details &rarr;</a>
</div>`)
        .join("\n");

      const catLabel = String(collectionTitle || slug).replace(/ for sale.*/i, "").replace(/-/g, " ");
      const blocks = blocksOf(bodyHtml);
      const wrapperClass = blocks[0]?.html.match(/<section\b[^>]*class="([^"]*)"/i)?.[1] || "";
      const section = `<section${wrapperClass ? ` class="${wrapperClass}"` : ""}><h2>Featured ${catLabel}</h2>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">
${cards}
</div></section>`;
      const anchor = findBlock(blocks, /frequently asked|faq/i) || blocks[0] || null;
      const html = anchor ? insertAfterBlock(bodyHtml, anchor, section) : bodyHtml + "\n" + section;
      return NextResponse.json({ html, changed: true, message: `Inserted 4-tier featured section (${cards.split("View Product Details").length - 1} products, live prices)` });
    }

    if (action === "banned-phrases") {
      const all = [...new Set([...BANNED_PHRASES, ...DOC_BANNED])].map((p) => p.toLowerCase());
      const blockRe = /<(p|li|h2|h3|h4)\b[^>]*>[\s\S]*?<\/\1>/gi;
      const offenders: string[] = [];
      for (const m of bodyHtml.matchAll(blockRe)) {
        const text = m[0].replace(/<[^>]+>/g, " ").toLowerCase();
        if (all.some((ph) => text.includes(ph)) && offenders.length < 30) offenders.push(m[0]);
      }
      if (offenders.length === 0) {
        return NextResponse.json({ html: bodyHtml, changed: false, message: "No banned phrases found in standard blocks" });
      }
      const raw = await callAI(
        `You are a precise copy editor for Green Thumb Depot.\n${WRITING_RULES}\nBANNED (remove/replace every occurrence): ${all.join("; ")}`,
        `Rewrite each numbered HTML fragment to remove all banned phrases with minimal change. Keep every HTML tag, attribute, class, and link exactly. Keep meaning identical. Return ONLY a JSON array of rewritten fragments in order.\n\n${offenders.map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
        { maxTokens: 6000 }
      );
      let rewritten: string[] | null = null;
      try {
        const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length === offenders.length) rewritten = parsed;
      } catch { /* fall through */ }
      if (!rewritten) return NextResponse.json({ error: "AI rewrite failed — try again" }, { status: 500 });
      let html = bodyHtml;
      let fixed = 0;
      offenders.forEach((oldBlock, i) => {
        const nb = String(rewritten![i]);
        const stillBanned = all.some((ph) => nb.replace(/<[^>]+>/g, " ").toLowerCase().includes(ph));
        if (nb && !stillBanned && nb !== oldBlock) { html = html.replace(oldBlock, nb); fixed++; }
      });
      return NextResponse.json({ html, changed: fixed > 0, message: `Cleaned banned phrases in ${fixed}/${offenders.length} block(s)` });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("[collections/fix-section] Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fix failed" }, { status: 500 });
  }
}
