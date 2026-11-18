import { type NextRequest, NextResponse } from "next/server";
import { buildFix } from "@/lib/fix-anchors";
import { injectCollectionLinks, deriveCategoryFromTags } from "@/lib/collection-links";
import { callAI } from "@/lib/ai";
import { WRITING_RULES, BANNED_PHRASES, validateBrandRules, stripEmDashes } from "@/lib/brandRules";

/**
 * POST /api/workshop/fix
 *
 * Targeted single-article fixes for grader failures. Never rewrites prose
 * beyond the minimum needed for the specific fix.
 *
 * Body: { bodyHtml, action, category?, title?, handle? }
 * Actions:
 *   anchors           — legacy H2 ids -> section-N + TOC hrefs (deterministic)
 *   collection-links  — top up to 2 in-content collection links (deterministic)
 *   em-dashes         — AI rewrites ONLY the blocks containing em dashes
 */

export const maxDuration = 120;

const EM = /—|&#8212;|&mdash;/;

function deterministicStrip(text: string): string {
  return text
    .replace(/\s*(—|&#8212;|&mdash;)\s*/g, ", ")
    .replace(/,\s*,/g, ",");
}

async function fixEmDashes(bodyHtml: string): Promise<{ html: string; fixedBlocks: number }> {
  // Collect the HTML blocks whose text contains em dashes.
  const blockRe = /<(p|li|h2|h3|h4)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const offenders: string[] = [];
  for (const m of bodyHtml.matchAll(blockRe)) {
    if (EM.test(m[0]) && offenders.length < 60) offenders.push(m[0]);
  }
  if (offenders.length === 0) {
    // Em dashes outside standard blocks (attributes, etc.) — deterministic only.
    return { html: deterministicStrip(bodyHtml), fixedBlocks: 0 };
  }

  let rewritten: string[] | null = null;
  try {
    const prompt = `Rewrite each numbered HTML fragment to remove ALL em dashes (—). Replace them with commas, periods, parentheses, or restructure the sentence minimally. Keep every HTML tag, attribute, and link exactly as-is. Keep meaning identical. Return ONLY a JSON array of the rewritten fragments in the same order, no explanation.

${offenders.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
    const raw = await callAI(
      `You are a precise copy editor for Peak Primal Wellness.\n${WRITING_RULES}`,
      prompt,
      { maxTokens: 8000 }
    );
    const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length === offenders.length) rewritten = parsed;
  } catch (err) {
    console.warn("[workshop/fix] em-dash AI pass failed, using deterministic fallback:", err);
  }

  let html = bodyHtml;
  let fixedBlocks = 0;
  offenders.forEach((oldBlock, i) => {
    let newBlock = rewritten ? String(rewritten[i]) : deterministicStrip(oldBlock);
    if (EM.test(newBlock)) newBlock = deterministicStrip(newBlock);
    if (newBlock && newBlock !== oldBlock) {
      html = html.replace(oldBlock, newBlock);
      fixedBlocks++;
    }
  });
  // Safety net: nothing containing an em dash leaves this function.
  if (EM.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, ""))) {
    html = html.replace(/<script\b[\s\S]*?<\/script>/gi, (s) => s) // keep scripts untouched
               .replace(/\s*(—|&#8212;|&mdash;)\s*(?![^<]*<\/script>)/g, ", ");
  }
  return { html, fixedBlocks };
}

export async function POST(request: NextRequest) {
  try {
    const { bodyHtml, action, category, title, handle, tags } = await request.json();
    if (!bodyHtml || !action) {
      return NextResponse.json({ error: "bodyHtml and action are required" }, { status: 400 });
    }

    if (action === "anchors") {
      const fix = buildFix(bodyHtml);
      if (!fix) return NextResponse.json({ html: bodyHtml, changed: false, message: "No legacy anchors found" });
      return NextResponse.json({ html: fix.fixed, changed: true, message: `${fix.replacements} anchor tokens updated` });
    }

    if (action === "collection-links") {
      const derived = category || deriveCategoryFromTags(tags || "") || "";
      const result = injectCollectionLinks(bodyHtml, {
        category: derived,
        keyword: title || "",
        title: title || "",
        seed: handle || title || "",
      });
      if (result.added.length === 0) {
        return NextResponse.json({ html: bodyHtml, changed: false, message: "Already has 2+ links, or no category match" });
      }
      return NextResponse.json({
        html: result.html,
        changed: true,
        message: `Added: ${result.added.map((a) => `/collections/${a.handle} (${a.method})`).join(", ")}`,
      });
    }

    if (action === "em-dashes") {
      const { html, fixedBlocks } = await fixEmDashes(bodyHtml);
      const changed = html !== bodyHtml;
      return NextResponse.json({
        html,
        changed,
        message: changed ? `Cleaned em dashes in ${fixedBlocks || "all"} blocks` : "No em dashes found",
      });
    }

    if (action === "voice-upgrade") {
      const result = await voiceUpgrade(bodyHtml);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("[workshop/fix] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fix failed" },
      { status: 500 }
    );
  }
}

// ── Voice upgrade ────────────────────────────────────────────────────────────
// Rewrites prose section-by-section to comply with PPW brand voice. Template
// blocks (FAQ, product cards, related articles, CTA) are never touched, and
// any rewritten section that loses a link falls back to the original.

const SKIP_SEGMENT = /ppw-faq|ppw-acc|featured-products|Continue Your Wellness|ppw-cta|ppw-card|application\/ld\+json/i;

function voicePenaltyScore(html: string): number {
  const v = validateBrandRules(html);
  const penalty = v.emDashCount * 2 + v.bannedPhrasesFound.length * 8 + v.namingViolations.length * 8;
  return Math.max(0, 100 - Math.min(100, penalty));
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).sort();
}

async function voiceUpgrade(bodyHtml: string): Promise<{ html: string; changed: boolean; message: string }> {
  const before = voicePenaltyScore(bodyHtml);

  // Split into segments at H2 boundaries (preamble + one segment per section).
  const indices: number[] = [0];
  for (const m of bodyHtml.matchAll(/<h2\b/gi)) if (m.index) indices.push(m.index);
  indices.push(bodyHtml.length);
  const segments: string[] = [];
  for (let i = 0; i < indices.length - 1; i++) segments.push(bodyHtml.slice(indices[i], indices[i + 1]));

  const candidates = segments
    .map((seg, i) => ({ seg, i }))
    .filter(({ seg }) => !SKIP_SEGMENT.test(seg) && seg.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length > 40)
    .slice(0, 12);

  if (candidates.length === 0) {
    const stripped = stripEmDashes(bodyHtml);
    return { html: stripped, changed: stripped !== bodyHtml, message: "No prose sections to upgrade" };
  }

  const system = `You are a senior copy editor at Peak Primal Wellness, a premium wellness equipment brand.
${WRITING_RULES}

BANNED PHRASES (remove/replace every occurrence): ${BANNED_PHRASES.join("; ")}`;

  const rewrites = await Promise.all(
    candidates.map(async ({ seg, i }) => {
      try {
        const out = await callAI(
          system,
          `Rewrite this article section to fully comply with the brand voice rules. Improve flow and remove AI-sounding phrasing, but keep every fact, claim, and specific detail. PRESERVE ALL HTML exactly: every tag, attribute, class, id, link, and image must remain. Only sentence text may change. Return ONLY the rewritten HTML, no explanation, no markdown fences.\n\n${seg}`,
          { maxTokens: 4000 }
        );
        let clean = out.trim().replace(/^```(html)?/i, "").replace(/```$/, "").trim();
        clean = stripEmDashes(clean);
        // Safety: don't accept a rewrite that dropped links or headings.
        const sameLinks = JSON.stringify(hrefsOf(seg)) === JSON.stringify(hrefsOf(clean));
        const sameH2 = (seg.match(/<h2\b/gi) || []).length === (clean.match(/<h2\b/gi) || []).length;
        return sameLinks && sameH2 && clean.length > seg.length * 0.5 ? { i, html: clean } : null;
      } catch {
        return null;
      }
    })
  );

  let applied = 0;
  for (const r of rewrites) {
    if (r) {
      segments[r.i] = r.html;
      applied++;
    }
  }
  let html = segments.join("");
  html = stripEmDashes(html);
  const after = voicePenaltyScore(html);

  return {
    html,
    changed: html !== bodyHtml,
    message: `Upgraded ${applied}/${candidates.length} sections. Voice score ${before} -> ${after}. Review the preview before publishing.`,
  };
}
