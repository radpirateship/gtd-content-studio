import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { countEditorialLinks } from "@/lib/article-v2";
import { callAI } from "@/lib/ai";
import { MASTER_COLLECTIONS } from "@/lib/collections";

// The link-insertion AI call can take up to 90s and retries up to 3×. Give the
// function room so Vercel doesn't kill it mid-retry and turn a recoverable slow
// call into a hard failure.
export const maxDuration = 300;

// Link icon SVG - same as used in the generate route
const LINK_ICON = `<svg stroke-linejoin="round" stroke-linecap="round" stroke-width="2" stroke="currentColor" fill="none" viewBox="0 0 24 24" height="16" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>`;

/**
 * POST /api/articles/add-links
 *
 * Takes a finished article's HTML and injects internal links in one AI pass.
 * Link quota: EXACTLY 2 same-hub collection links + up to 8 topical authority article links.
 * Collection links are editorial body-only — no salesy language, never in footer sections.
 */
export async function POST(request: NextRequest) {
  try {
    const { articleId, htmlContent, internalLinks, collectionsLinks, category } = await request.json();

    if (!htmlContent) {
      return NextResponse.json({ error: "htmlContent is required" }, { status: 400 });
    }

    // v2 articles are styled by the gtd-blog.css theme asset, which defines
    // .gtdb-a and knows nothing about .gtd-links.
    const linkClass = /class=["'][^"']*gtdb-/.test(htmlContent) ? "gtdb-a" : "gtd-links";

    if (!internalLinks || internalLinks.length === 0) {
      return NextResponse.json({ error: "internalLinks array is required" }, { status: 400 });
    }

    // ── Build same-hub collection candidates ─────────────────────────────────
    const articleHub = MASTER_COLLECTIONS.find(c => c.slug === category)?.hub;

    let collectionCandidates: { title: string; url: string }[] = [];
    if (collectionsLinks?.length && articleHub) {
      // Filter provided links to same hub only
      collectionCandidates = (collectionsLinks as { title: string; url: string }[]).filter(cl => {
        const handle = cl.url?.split('/collections/')?.[1]?.split('?')[0];
        const col = MASTER_COLLECTIONS.find(c => c.shopifyHandle === handle || c.slug === handle);
        return col?.hub === articleHub && col?.slug !== category;
      });
    } else if (articleHub) {
      // Build from MASTER_COLLECTIONS when not provided by caller
      collectionCandidates = MASTER_COLLECTIONS
        .filter(c => c.hub === articleHub && c.slug !== category)
        .map(c => ({ title: c.label, url: `/collections/${c.shopifyHandle}` }));
    }

    // Extract only the body content sections (between Key Takeaways and FAQ/footer)
    // We don't want Claude touching the GTD shell, nav, product grid, or footer
    const bodyStartMarker = '<section class="gtd-section gtd-muted">';
    const faqMarker = '<section id="faq"';
    const footerMarker = '<section class="gtd-section gtd-center">';
    const relatedMarker = 'Continue Your Wellness Journey';

    const bodyStart = htmlContent.indexOf(bodyStartMarker);
    const faqStart = htmlContent.indexOf(faqMarker);
    const footerStart = htmlContent.indexOf(footerMarker);
    const relatedStart = htmlContent.indexOf(relatedMarker);

    if (bodyStart === -1) {
      return NextResponse.json({
        error: "Could not find body content start in HTML"
      }, { status: 400 });
    }

    // Use FAQ as the end boundary if present; otherwise fall back to
    // related articles section, then footer CTA, then end of content.
    // This ensures links can still be injected even if FAQ is missing.
    let bodyEndPos = faqStart;
    if (bodyEndPos === -1 && relatedStart !== -1) {
      // Find the <section> tag that contains the related articles marker
      bodyEndPos = htmlContent.lastIndexOf('<section', relatedStart);
    }
    if (bodyEndPos === -1 && footerStart !== -1) {
      bodyEndPos = footerStart;
    }
    if (bodyEndPos === -1) {
      // Last resort: use the closing </article> tag
      bodyEndPos = htmlContent.indexOf('</article>');
    }
    if (bodyEndPos === -1) {
      return NextResponse.json({
        error: "Could not find body content end boundary in HTML"
      }, { status: 400 });
    }

    // Extract: everything from Key Takeaways through end of main content
    const bodyContent = htmlContent.substring(bodyStart, bodyEndPos).trim();
    const beforeBody = htmlContent.substring(0, bodyStart);
    const afterBody = htmlContent.substring(bodyEndPos);

    // Format article links (topical authority cluster)
    const articleLinksForAI = internalLinks.slice(0, 10).map(
      (l: { title: string; url: string }, i: number) => `A${i + 1}. "${l.title}" → ${l.url}`
    ).join('\n');

    // Format collection links (same-hub, already filtered)
    const collectionLinksForAI = collectionCandidates.slice(0, 8).map(
      (l: { title: string; url: string }, i: number) => `C${i + 1}. "${l.title}" → ${l.url}`
    ).join('\n');

    const hasCollections = collectionCandidates.length > 0;

    // Call Claude to inject links into existing paragraphs
    const systemPrompt = `You are an internal linking specialist for Green Thumb Depot. Your ONLY job is to add internal links to existing HTML content. You must NOT change the content, structure, headings, or meaning of any text.

LINK QUOTA — hit both targets exactly:
${hasCollections ? `- EXACTLY 2 links from the COLLECTION LIST (same-hub collection pages)` : ''}
- Up to 8 links from the ARTICLE LIST (topical authority cluster)
- Total: ${hasCollections ? '10' : 'up to 8'} links

COLLECTION LINK RULES (applies to C-prefixed URLs):
1. Use anchor text that reads as natural editorial context — e.g. "barrel sauna models", "infrared sauna", "outdoor setup" — NEVER "shop", "buy", "browse", "check out", or "purchase".
2. Place ONLY inside <p> tags in content body sections. NEVER in Key Takeaways, headings, product grids, or any footer section.
3. The anchor text must exist verbatim in the HTML you receive.

ARTICLE LINK RULES (applies to A-prefixed URLs):
4. Find natural anchor text in existing sentences and wrap them in: <a href="URL" class="${linkClass}">anchor text</a>
5. Use 2-4 word anchor text that naturally fits the sentence. NEVER "click here" or "read more".
6. Spread across different sections — not all in one paragraph.
7. NEVER add links inside headings (h2, h3) or the Key Takeaways box.

UNIVERSAL RULES:
8. NEVER change the wording of any sentence. Only wrap existing words in <a> tags.
9. NEVER add new sentences, paragraphs, or content.
10. NEVER remove or modify existing HTML structure, classes, or attributes.
11. Use the EXACT URLs provided — do not modify or invent URLs.
12. Never put 2 links in the same sentence.

OUTPUT: Return the modified HTML with links injected. Nothing else — no explanations, no markdown fences, HTML only.`;

    const userPrompt = `Here is the article body HTML. Inject links following the quota above.
${hasCollections ? `
COLLECTION LIST (pick exactly 2, editorial body placement only):
${collectionLinksForAI}
` : ''}
ARTICLE LIST (pick up to 8):
${articleLinksForAI}

HTML CONTENT TO MODIFY:
${bodyContent}`;

    let linkedBody = await callAI(systemPrompt, userPrompt, { maxTokens: 8000 });

    // Clean up any markdown code fences Claude might have added
    linkedBody = linkedBody.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();

    // Clean up any stray markdown syntax
    linkedBody = linkedBody
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<em>$1</em>');

    // Count how many links the body actually carries. Shared helper so this
    // number, the audit's number and the UI's number cannot drift apart.
    const linkCount = countEditorialLinks(linkedBody);

    // Reassemble the full article
    const enrichedHTML = beforeBody + linkedBody + '\n' + afterBody;

    // Update database if articleId provided
    if (articleId) {
      try {
        const sql = getSQL();
        await sql`
          UPDATE articles 
          SET html_content = ${enrichedHTML},
              has_internal_links = true,
              link_count = ${linkCount},
              updated_at = NOW()
          WHERE id = ${articleId}
        `;
      } catch (dbError) {
        console.error("Failed to update article in DB:", dbError);
      }
    }

    return NextResponse.json({ 
      htmlContent: enrichedHTML,
      linkCount,
      success: true 
    });
  } catch (error) {
    console.error("Add links error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add links" },
      { status: 500 }
    );
  }
}
