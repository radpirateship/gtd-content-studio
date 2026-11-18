// Scan links route — uses lib/ai.ts callAI helper
import { type NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import { MASTER_COLLECTIONS } from "@/lib/collections";

export const maxDuration = 120;

// Tolerant parser: handles ```json fences, prose around the array, and
// truncated output (salvages whatever complete {...} objects exist).
function extractJsonArray(text: string): Record<string, unknown>[] | null {
  const t = text.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
  // 1) direct parse
  try { const p = JSON.parse(t); if (Array.isArray(p)) return p; } catch { /* fall through */ }
  // 2) substring from first [ to last ]
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s !== -1 && e > s) {
    try { const p = JSON.parse(t.slice(s, e + 1)); if (Array.isArray(p)) return p; } catch { /* fall through */ }
  }
  // 3) salvage individual complete objects (survives mid-array truncation)
  const objs = t.match(/\{[^{}]*\}/g) || [];
  const out: Record<string, unknown>[] = [];
  for (const o of objs) { try { out.push(JSON.parse(o)); } catch { /* skip */ } }
  return out.length ? out : null;
}

export async function POST(request: NextRequest) {
  try {
    const { htmlContent, internalLinks, collectionsLinks, articleTitle, articleKeyword, category } = await request.json();

    if (!htmlContent) {
      return NextResponse.json({ error: "htmlContent is required" }, { status: 400 });
    }

    if ((!internalLinks || internalLinks.length === 0) && (!collectionsLinks || collectionsLinks.length === 0)) {
      return NextResponse.json({ error: "At least one of internalLinks or collectionsLinks is required" }, { status: 400 });
    }

    // ── Filter collection candidates to the same hub as this article ──────────
    // This prevents a sauna article from linking to compression boots collections.
    const articleHub = MASTER_COLLECTIONS.find(c => c.slug === category)?.hub;
    const rawCollections: { title: string; url: string }[] = collectionsLinks || [];

    const sameHubCollections = articleHub
      ? rawCollections.filter(cl => {
          // Match by URL path (/collections/[handle]) against same-hub collection handles
          const handle = cl.url?.split('/collections/')?.[1]?.split('?')[0];
          const col = MASTER_COLLECTIONS.find(c => c.shopifyHandle === handle || c.slug === handle);
          return col?.hub === articleHub && col?.slug !== category;
        })
      : rawCollections;

    // If collectionsLinks weren't passed but we have a category, build them from MASTER_COLLECTIONS
    const collectionCandidates = sameHubCollections.length > 0
      ? sameHubCollections
      : articleHub
        ? MASTER_COLLECTIONS
            .filter(c => c.hub === articleHub && c.slug !== category)
            .map(c => ({ title: c.label, url: `/collections/${c.shopifyHandle}` }))
        : [];

    const plainText = htmlContent
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Format article links (topical authority cluster)
    const articleLinksRef = (internalLinks || []).slice(0, 15).map(
      (l: { title: string; url: string }, i: number) => `A${i + 1}. "${l.title}" → ${l.url}`
    ).join('\n');

    // Format collection links (same-hub collection pages)
    const collectionLinksRef = collectionCandidates.slice(0, 10).map(
      (l: { title: string; url: string }, i: number) => `C${i + 1}. "${l.title}" → ${l.url}`
    ).join('\n');

    const systemPrompt = `You are a Senior SEO Strategist for Green Thumb Depot. Identify internal linking opportunities in an article.

THE #1 RULE — ANCHOR TEXT MUST BE COPIED VERBATIM FROM THE ARTICLE:
Every "anchor_text" you return MUST be a word-for-word phrase that already appears in the ARTICLE TEXT below — same words, same order, same spelling. Before choosing an anchor, find a real 2-5 word phrase in the article text and copy it EXACTLY. NEVER invent a descriptive phrase, NEVER use the target article's title as the anchor, NEVER paraphrase. If you cannot find a natural verbatim phrase in the article for a given target, SKIP that target — do not force it.

LINK QUOTA (these are CEILINGS, not mandates — quality over quantity):
- Up to 2 links from the COLLECTION LIST (same-hub collection pages)
- Up to 8 links from the ARTICLE LIST (topical authority cluster articles)
- Aim for 6-10 total, but ONLY where a real verbatim anchor exists. Returning 6 valid links is far better than 10 with invented anchors that don't appear in the text.

COLLECTION LINK RULES:
- Anchor must be a verbatim phrase from the article that reads as natural editorial context, not a purchase prompt
- NEVER use "shop", "buy", "browse", "check out", "purchase" as anchor text
- Place in body paragraph content only — never near product grids or CTAs

ARTICLE LINK RULES:
- 2-5 word anchor copied verbatim from the article body
- Spread across different sections, never 2 in the same sentence
- Never use a heading as anchor text

OUTPUT: Return ONLY a valid JSON array. Each object: { "anchor_text", "target_url", "target_title", "link_type", "rationale" }
link_type must be exactly "collection" or "article". Each anchor_text MUST be copy-paste findable in the ARTICLE TEXT.`;

    const userPrompt = `ARTICLE: "${articleTitle}" (keyword: "${articleKeyword}")

Choose anchors ONLY from phrases that literally appear in the ARTICLE TEXT below. Match each to the most relevant target. Skip any target with no natural verbatim anchor.

COLLECTION LIST (link up to 2):
${collectionLinksRef || '(none available)'}

ARTICLE LIST (link up to 8):
${articleLinksRef || '(none available)'}

ARTICLE TEXT (anchors must be copied from here):
${plainText.slice(0, 24000)}`;

    // Call the model, retrying once if it fails or returns unparseable output.
    // Never hard-500 on a transient failure — that silently drops links for the
    // article. Salvage what we can; return empty gracefully only as a last resort.
    let suggestions: Record<string, unknown>[] | null = null;
    for (let attempt = 1; attempt <= 2 && !suggestions; attempt++) {
      try {
        console.log(`[v0] Scan-links: calling callAI (attempt ${attempt})...`);
        const rawText = await callAI(systemPrompt, userPrompt, { maxTokens: 4000 });
        suggestions = extractJsonArray(rawText);
        if (!suggestions) console.warn(`[scan-links] attempt ${attempt}: unparseable output (first 300): ${rawText.slice(0, 300)}`);
      } catch (e) {
        console.warn(`[scan-links] attempt ${attempt} call failed:`, e instanceof Error ? e.message : e);
      }
    }
    if (!suggestions) {
      // Graceful: let the caller proceed (and retry) instead of erroring the whole article.
      return NextResponse.json({ suggestions: [], count: 0, proposed: 0, success: false, error: "scan failed after retry" });
    }

    const normalizedSuggestions = (Array.isArray(suggestions) ? suggestions : []).map(
      (s: any, i: number) => ({
        id: `link-${Date.now()}-${i}`,
        anchorText: s.anchor_text || '',
        targetUrl: s.target_url || '',
        targetTitle: s.target_title || '',
        linkType: s.link_type === 'collection' ? 'collection' : 'article',
        rationale: s.rationale || '',
        status: 'pending' as const,
      })
    ).filter((s: any) => s.anchorText && s.targetUrl);

    // Safety net: drop any anchor the model invented that isn't actually present
    // in the article text (whitespace-insensitive). This guarantees apply-links
    // can find what we return, so the link count reflects real insertions.
    const haystack = plainText.toLowerCase().replace(/\s+/g, ' ');
    const verbatimSuggestions = normalizedSuggestions.filter((s: { anchorText: string }) => {
      const needle = s.anchorText.trim().toLowerCase().replace(/\s+/g, ' ');
      return needle.length > 0 && haystack.includes(needle);
    });

    return NextResponse.json({
      suggestions: verbatimSuggestions,
      count: verbatimSuggestions.length,
      proposed: normalizedSuggestions.length,
      success: true,
    });
  } catch (error) {
    console.error("Scan links error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to scan for link opportunities" },
      { status: 500 }
    );
  }
}
