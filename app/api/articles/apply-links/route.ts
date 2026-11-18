import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { countEditorialLinks, linkKey, splitAdjacentLinks, capCollectionLinks } from "@/lib/article-v2";
import { listPublishedArticlePaths } from "@/lib/shopify/blog-admin";

// Link icon SVG
const LINK_ICON = `<svg stroke-linejoin="round" stroke-linecap="round" stroke-width="2" stroke="currentColor" fill="none" viewBox="0 0 24 24" height="16" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>`;

/**
 * POST /api/articles/apply-links
 * 
 * Takes APPROVED link suggestions and injects them into the article HTML.
 * Only approved links with anchor text are applied.
 */
export async function POST(request: NextRequest) {
  try {
    const { articleId, htmlContent, approvedLinks } = await request.json();

    if (!htmlContent) {
      return NextResponse.json({ error: "htmlContent is required" }, { status: 400 });
    }

    if (!approvedLinks || approvedLinks.length === 0) {
      return NextResponse.json({ error: "No approved links to apply" }, { status: 400 });
    }

    let enrichedHTML = htmlContent;
    let linksApplied = 0;

    // Validate against Shopify before applying anything.
    //
    // /api/generate filters its own link inventory, but this route takes
    // suggestions from scan-links, which reads the same unvalidated tables. A
    // dead URL therefore came back through this door and landed in a published
    // draft. Same authority, same treatment: skip the filter entirely if the
    // call fails rather than applying nothing.
    let publishedPaths: Set<string> | null = null;
    try {
      const live = await listPublishedArticlePaths();
      if (live.size) publishedPaths = live;
      else console.warn("[apply-links] Shopify returned no published paths, skipping URL validation");
    } catch (e) {
      console.warn("[apply-links] could not validate URLs against Shopify:", e instanceof Error ? e.message : e);
    }
    const skippedDead: string[] = [];
    const skippedDuplicate: string[] = [];

    // v2 articles are styled by the gtd-blog.css theme asset, which defines
    // .gtdb-a and knows nothing about .gtd-links. A v2 article given v1 link
    // classes gets whatever the host theme's .rte a rule says instead.
    const isV2 = /class=["'][^"']*gtdb-/.test(htmlContent);
    const linkClass = isV2 ? "gtdb-a" : "gtd-links";

    // Sort links by anchor text length (longest first) to avoid partial matches
    const sortedLinks = [...approvedLinks].sort(
      (a: { anchorText: string; editedAnchor?: string }, b: { anchorText: string; editedAnchor?: string }) => 
        (b.editedAnchor || b.anchorText).length - (a.editedAnchor || a.anchorText).length
    );

    for (const link of sortedLinks) {
      const anchor = link.editedAnchor || link.anchorText;
      const url = link.editedUrl || link.targetUrl;

      if (!anchor || !url) continue;

      // Only blog URLs are checked; collections and pages are not in this set.
      const key = linkKey(url);
      if (publishedPaths && key.startsWith("/blogs/") && !publishedPaths.has(key)) {
        skippedDead.push(url);
        continue;
      }

      // Never link the same destination twice.
      //
      // dedupeV2Links runs inside /api/generate, so it only sees the links the
      // model wrote. This step runs afterwards and had no idea what was already
      // there, so it linked the chiller sizing guide a second time in a
      // paragraph that already linked it. Cross-step duplicates need the check
      // here, where both sets of links are visible.
      const already = Array.from(
        enrichedHTML.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi) as Iterable<RegExpMatchArray>,
      ).some((m) => linkKey(m[1]) === key);
      if (already) {
        skippedDuplicate.push(url);
        continue;
      }

      // Trim surrounding quotes/punctuation the AI may have included.
      const cleanAnchor = anchor.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (!cleanAnchor) continue;

      // Build a tolerant matcher: between each word allow flexible whitespace
      // (matches across newlines / double spaces that the AI's single-spaced
      // anchor text wouldn't otherwise hit). Alphanumeric boundaries (not \b)
      // avoid cutting inside a word while still matching phrases next to
      // punctuation. We deliberately do NOT span inline tags, which would risk
      // producing overlapping/ malformed tags; a fully-formatted phrase still
      // matches because its text node is intact.
      const tokens = cleanAnchor.split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const anchorRe = new RegExp(`(?<![A-Za-z0-9])(${tokens.join('\\s+')})(?![A-Za-z0-9])`, 'i');

      // WHERE a link may go.
      //
      // v1 used a blocklist: anywhere except an existing <a> and except a
      // heading. On a v2 article that is far too permissive — the assembled
      // furniture is all <p> and <div>, so a link landed inside the deck
      // ("Discover how <a>cold water immersion triggers</a> your body's...")
      // pointing at a dead URL. The deck is a header element, not prose.
      //
      // v2 uses a whitelist instead: body prose only. Everything else — deck,
      // answer box, takeaways, jump nav, product cards, FAQ, author bio,
      // related tiles, shop CTA — is generated furniture and is off limits.
      const V2_SLOT = /<p class="gtdb-(?:p|lead|step-body)"[^>]*>[\s\S]*?<\/p>|<li class="gtdb-li"[^>]*>[\s\S]*?<\/li>/gi;
      const isProse = (seg: string) =>
        isV2
          ? /^<(?:p class="gtdb-(?:p|lead|step-body)"|li class="gtdb-li")/i.test(seg)
          : !/^<a\b/i.test(seg) && !/^<h[1-6]\b/i.test(seg);

      const segments = isV2
        ? enrichedHTML.split(new RegExp(`(${V2_SLOT.source})`, "gi"))
        : enrichedHTML.split(/(<a\b[^>]*>[\s\S]*?<\/a>|<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/gi);

      let replaced = false;
      for (let i = 0; i < segments.length && !replaced; i++) {
        if (!isProse(segments[i])) continue;
        // Never nest: hold existing anchors aside, edit only the text around them.
        const inner = segments[i].split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi);
        for (let j = 0; j < inner.length && !replaced; j++) {
          if (/^<a\b/i.test(inner[j])) continue;
          if (anchorRe.test(inner[j])) {
            inner[j] = inner[j].replace(anchorRe, `<a href="${url}" class="${linkClass}">$1</a>`);
            replaced = true;
          }
        }
        if (replaced) segments[i] = inner.join("");
      }

      if (replaced) {
        enrichedHTML = segments.join('');
        linksApplied++;
        console.log(`[apply-links] Inserted link: "${cleanAnchor}" -> ${url}`);
      } else {
        console.log(`[apply-links] Could not find anchor text "${cleanAnchor}" in HTML`);
      }
    }

    if (skippedDuplicate.length) {
      console.warn(
        `[apply-links] skipped ${skippedDuplicate.length} link(s) already present in the article: ${skippedDuplicate.join(", ")}`,
      );
    }
    if (skippedDead.length) {
      console.error(
        `[apply-links] skipped ${skippedDead.length} approved link(s) that are not published in Shopify: ${skippedDead.join(", ")}`,
      );
    }

    // Inserting next to a link the generator already wrote produces two anchors
    // separated only by a space, which renders as one continuous link.
    const adjacent = splitAdjacentLinks(enrichedHTML);
    enrichedHTML = adjacent.html;
    if (adjacent.unwrapped.length) {
      console.warn(`[v0] apply-links: unwrapped ${adjacent.unwrapped.length} adjacent link(s): ${adjacent.unwrapped.join(", ")}`);
    }
    // The generator already carries two collection links; this step adding a
    // third is how an article ended up with three. Body prose only: the shop
    // CTA button is a gtdb-btn, not an editorial anchor, and is left alone.
    if (isV2) {
      const shielded = enrichedHTML.replace(/<section class="gtdb-shop">[\s\S]*?<\/section>/i, (m: string) => m.replace(/href="\/collections\//g, 'href="/__keep__/collections/'));
      const capped = capCollectionLinks(shielded, 2);
      enrichedHTML = capped.html.replace(/\/__keep__\/collections\//g, "/collections/");
      if (capped.unwrapped.length) {
        console.warn(`[v0] apply-links: unwrapped ${capped.unwrapped.length} collection link(s) over the limit of 2: ${capped.unwrapped.join(", ")}`);
      }
    }

    // linksApplied is how many this run inserted. The article's link count is
    // how many it carries in total, which on a v2 article includes the ones the
    // generator wrote from the inventory before this step ran. Reporting the
    // former as the latter is why the review panel showed 2 on an 8-link article.
    const totalLinks = countEditorialLinks(enrichedHTML);

    // Update database if articleId provided
    if (articleId && linksApplied > 0) {
      try {
        const sql = getSQL();
        await sql`
          UPDATE articles 
          SET html_content = ${enrichedHTML},
              has_internal_links = true,
              link_count = ${totalLinks},
              updated_at = NOW()
          WHERE id = ${articleId}
        `;
      } catch (dbError) {
        console.error("Failed to update article in DB:", dbError);
      }
    }

    return NextResponse.json({
      htmlContent: enrichedHTML,
      linkCount: totalLinks,
      linksAppliedThisRun: linksApplied,
      skippedDeadLinks: skippedDead,
      skippedDuplicateLinks: skippedDuplicate,
      totalRequested: approvedLinks.length,
      success: true,
    });
  } catch (error) {
    console.error("Apply links error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to apply links" },
      { status: 500 }
    );
  }
}
