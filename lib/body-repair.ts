/**
 * Block-level repair of generated prose, shared by the blog generator and the
 * ultimate guide generator (it used to be two diverging copies).
 *
 * Each prose block (ppwb-p, ppwb-lead, ppwb-li, ppwb-step-body) that names an
 * uncarried brand, makes an unsupported claim, or carries an AI writing tell
 * (lib/brandRules AI_TELLS) is rewritten once by the model, in parallel. A
 * rewrite is accepted only if every href survives unchanged, the substantive
 * problems are gone, and the style problems did not grow. Otherwise the
 * original stays and the note says so. Substantive problems are repaired
 * first when the cap bites.
 */
import { callAI } from "@/lib/ai";
import { validateBrandRules, stripEmDashes, scrubUncarriedBrands } from "@/lib/brandRules";

const BODY_BLOCK = /<(p|li)\b([^>]*\bclass=["'][^"']*\bppwb-(?:p|lead|li|step-body)\b[^"']*["'][^>]*)>([\s\S]*?)<\/\1>/gi;
const hrefsOf = (html: string) =>
  Array.from(html.matchAll(/\bhref=["']([^"']+)["']/gi)).map((m) => m[1]).sort().join("|");

export async function repairBodyBlocks(
  html: string,
  opts: { knownVendors: string[]; cap?: number; docLabel?: string },
): Promise<{ html: string; notes: string[] }> {
  const { knownVendors, cap = 14, docLabel = "article" } = opts;
  const problemsOf = (inner: string) => {
    const r = validateBrandRules(inner, false, { knownVendors });
    return {
      substantive: [
        ...r.uncarriedBrands.map((x) => `brand: ${x}`),
        ...r.unsupportedClaims.map((x) => `claim: ${x}`),
      ],
      style: r.aiTells,
    };
  };
  const offending = Array.from(html.matchAll(BODY_BLOCK))
    .map((m) => ({ m, p: problemsOf(m[3]) }))
    .filter(({ p }) => p.substantive.length || p.style.length)
    .sort((a, b) => b.p.substantive.length - a.p.substantive.length);
  const notes: string[] = [];
  if (!offending.length) return { html, notes };
  console.warn(`[brand-check] ${offending.length} ${docLabel} block(s) need repair (brand, claim or AI writing tell), rewriting each once`);

  const results = await Promise.all(
    offending.slice(0, cap).map(async ({ m, p }) => {
      const [whole, tag, attrs, inner] = m;
      const problems = [...p.substantive, ...p.style.map((x) => `style: ${x}`)];
      const label = p.substantive.length ? "COULD NOT REPAIR, review by hand" : "style left as written";
      // Cheap path first: a clean appositive removal needs no model call.
      if (p.substantive.length) {
        const scrubbed = scrubUncarriedBrands(inner, knownVendors);
        const after = problemsOf(scrubbed.text);
        if (scrubbed.removed.length && !after.substantive.length && !after.style.length && hrefsOf(scrubbed.text) === hrefsOf(inner)) {
          return { whole, next: `<${tag}${attrs}>${scrubbed.text}</${tag}>`, note: `removed "${scrubbed.removed.join('", "')}"` };
        }
      }
      try {
        const fixed = await callAI(
          `You are rewriting one block of a Peak Primal Wellness ${docLabel}. PPW is an equipment retailer; ` +
            `the ${docLabel} exists to help a buyer choose and to sell the products it features.\n\n` +
            `The block below has the problems listed. Rewrite it so it has none of them, keeping the same ` +
            `facts, the same recommendation and roughly the same length.\n` +
            `- Name NO brand that is not in the approved list.\n` +
            `- Make no health-efficacy claim in marketing language; describe the mechanism plainly, with cautious ` +
            `wording (may, is associated with) for health effects.\n` +
            `- Staged reversal ("isn't about X, it's about Y", "not a compromise, it is"): state the point directly.\n` +
            `- Vague attribution ("research shows", "studies have found", "experts say"): state the specific ` +
            `finding plainly at the same certainty, or drop the sentence if it has no specific content. Keep any ` +
            `citation link that is already there.\n` +
            `- "Most buyers/people" or invented customer experience: state the fact without the crowd or the anecdote.\n` +
            `- A sentence that comments on itself ("which is the point", "matters more than it sounds", ", highlighting"): ` +
            `cut the commentary, keep any real information.\n` +
            `- Decorative words (pivotal, showcase, testament, serves as, earns its place): use a plain verb or the specific fact.\n` +
            `Keep every HTML tag and every <a> link exactly as it is, same href, same class, same anchor text. ` +
            `No em dashes. Return ONLY the rewritten inner HTML of the block, no wrapper tag, no quotes, no preamble.`,
          `PROBLEMS: ${problems.join(" | ")}\n\nAPPROVED BRANDS: ${knownVendors.filter(Boolean).join(", ") || "(none)"}\n\nBLOCK TO FIX:\n${inner}`,
          { maxTokens: 700 },
        );
        const candidate = stripEmDashes(fixed.trim().replace(/^```(?:html)?/i, "").replace(/```$/i, "").trim());
        const after = candidate ? problemsOf(candidate) : null;
        const accept = !!candidate && !!after && after.substantive.length === 0
          && after.style.length < Math.max(1, p.style.length + (p.substantive.length ? 1 : 0))
          && hrefsOf(candidate) === hrefsOf(inner);
        if (accept) return { whole, next: `<${tag}${attrs}>${candidate}</${tag}>`, note: `rewrote a block: ${problems.join(" | ")}` };
        if (p.substantive.length) console.error("[brand-check] block rewrite rejected, original kept:", problems.join(" | "));
        return { whole, next: null as string | null, note: `${label}: ${problems.join(" | ")}` };
      } catch (e) {
        console.warn("[brand-check] block rewrite call failed", e);
        return { whole, next: null as string | null, note: `${label}: ${problems.join(" | ")}` };
      }
    }),
  );
  let out = html;
  for (const r of results) {
    if (r.next) out = out.replace(r.whole, r.next);
    notes.push(r.note);
  }
  if (offending.length > cap) notes.push(`${offending.length - cap} further block(s) left untouched, review by hand`);
  return { html: out, notes };
}
