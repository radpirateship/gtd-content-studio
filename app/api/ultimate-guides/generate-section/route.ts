import { type NextRequest, NextResponse } from 'next/server'
import { WRITING_RULES } from "@/lib/brandRules"
import { callAI } from '@/lib/ai'

export const maxDuration = 120

// ─── Section definitions ────────────────────────────────────────────────────
// Each section has an id, the HTML id used in the template, and a generator.

export type SectionId =
  | 'key-takeaways'
  | 'what-is'
  | 'how-it-works'
  | 'types'
  | 'health-benefits'
  | 'how-to-use'
  | 'safety'
  | 'featured-products'
  | 'faq'
  | 'meta'

// Shared context passed to every section generator
interface SectionContext {
  guideTitle: string
  topicShort: string       // e.g. "Cold Plunge"
  topicShortPlural: string // e.g. "Cold Plunges"
  topicFull: string        // e.g. "Cold Plunge Therapy"
  year: number
  products: Array<{
    title: string
    vendor: string
    price: string
    subcategory: string
    role: 'best-value' | 'best-upgrade'
    desc: string
    specs: string[]
  }>
  clusterLinks: Array<{ title: string; slug: string }>
  previousSections: Record<string, string> // sectionId → plain text summary
}

// ─── Shared system prompt ───────────────────────────────────────────────────

const SYSTEM_BASE = `You are an expert wellness content writer for Green Thumb Depot (greenthumbdepot.com).

Your writing style:
- Evidence-based but accessible -- cite mechanisms and research without being academic
- Direct and confident -- no hedging, no filler phrases
- Author: Ryan O'Connor
- Target total guide length: 6,000-8,000 words

CRITICAL WEB READABILITY RULES:
1. PARAGRAPH LENGTH: You MUST keep paragraphs to 2-4 sentences MAXIMUM. Do not write walls of text.
2. PUNCTUATION: You are strictly forbidden from overusing em-dashes (\u2014). Use standard commas and periods to create short, punchy, declarative sentences.
3. NO BOLDING IN PARAGRAPHS: Output plain text paragraphs ONLY. You are strictly forbidden from using <strong> or <b> tags in the body copy. (Bolding is ONLY allowed at the start of <li> bullet points).

Content rules:
- NEVER use rem CSS units -- always use em
- NEVER generate <style> or <script> tags
- Return ONLY the requested HTML fragment
- All headings inside sections are h3 or h4 -- NEVER h2
- Internal links use format: <a href="/blogs/guides/SLUG">Anchor text</a>
- CRITICAL: When provided with a list of cluster links, you MUST seamlessly weave 2-3 of them into the body paragraphs using natural, descriptive anchor text. Do not ignore the provided links.


${WRITING_RULES}`

// ─── Section prompt builders ────────────────────────────────────────────────

function buildKeyTakeawaysPrompt(ctx: SectionContext): string {
  return `Generate ONLY the 5 list items for the Key Takeaways section of the "${ctx.guideTitle}" guide.

Return EXACTLY 5 <li> elements and NOTHING else -- no <ul>, no <section>, no wrappers, no divs, no classes, no <div class="callout-info">.

Each <li> starts with a short bold label (2-4 words) followed by a colon, then 1-2 specific, actionable sentences:
<li><strong>{{2-4 word label}}:</strong> {{1-2 specific, actionable sentences with data or mechanisms}}</li>
<li><strong>{{2-4 word label}}:</strong> {{1-2 specific sentences}}</li>
<li><strong>{{2-4 word label}}:</strong> {{1-2 specific sentences}}</li>
<li><strong>{{2-4 word label}}:</strong> {{1-2 specific sentences}}</li>
<li><strong>{{2-4 word label}}:</strong> {{1-2 specific sentences}}</li>

Make each takeaway specific and data-driven. No generic filler.
Return ONLY the 5 <li> elements. The wrapper is hardcoded in our template.`
}
function buildWhatIsPrompt(ctx: SectionContext): string {
  return `Generate the "What Is ${ctx.topicFull}?" section body for the "${ctx.guideTitle}" guide.

Your output MUST begin with this EXACT stat box structure (filled in with a relevant key stat for ${ctx.topicShort}), followed by the paragraphs. Do NOT delete or skip the stat box:

<div class="gtd-stat-box" style="float: right; width: 280px; margin: 0 0 1.5em 2em;">
  <span class="gtd-stat-value">{{A key number/stat relevant to ${ctx.topicShort}}}</span>
  <span class="gtd-stat-label">{{Short description of the stat, 5-8 words}}</span>
</div>
<p>{{INTRO -- 3-4 sentences defining what ${ctx.topicShort} is, why it matters for recovery and wellness, and how it fits into a modern health-conscious lifestyle.}}</p>
<p>{{HISTORY -- 3-4 sentences on the history and cultural origins. Mention specific civilizations, time periods, or traditions.}}</p>
<p>{{SCIENCE -- 4-6 sentences on the core physiological mechanism. What happens in the body -- specific pathways, hormones, or responses. Reference research without being academic.}}</p>
<p>{{MODERN_ADOPTION -- 3-4 sentences on how athletes, biohackers, and wellness enthusiasts use ${ctx.topicShort} today.}}</p>
<p>{{CLOSING -- 2-3 sentences previewing types, benefits, protocols, and buying guidance.}}</p>

Aim for 600-800 words. Write with depth and authority.
Return only the HTML, no wrappers.`
}
function buildHowItWorksPrompt(ctx: SectionContext): string {
  return `Generate the "How ${ctx.topicShort} Works" section for the "${ctx.guideTitle}" guide.
Return this structure:
<p>{{INTRO -- 2-3 sentences on why understanding the mechanism matters for getting results.}}</p>
<h3>The Core Mechanism</h3>
<p>{{MECHANISM -- 5-7 sentences explaining the primary physiological mechanism. What happens step by step? Mention vasodilation/vasoconstriction, hormone cascades, nervous system shifts, cellular stress responses. Be specific with temperatures, timeframes, measurable changes.}}</p>
<h3>What Happens During a Session</h3>
<ol>
  <li><strong>{{PHASE_1}}</strong> -- {{3-4 sentences on the first few minutes, specific sensations and physiological responses}}</li>
  <li><strong>{{PHASE_2}}</strong> -- {{3-4 sentences on mid-session, when key adaptations kick in}}</li>
  <li><strong>{{PHASE_3}}</strong> -- {{3-4 sentences on final phase and post-session window, when peak benefits occur}}</li>
</ol>
<h3>The Science of Adaptation</h3>
<p>{{ADAPTATION -- 4-5 sentences on how regular use creates lasting changes -- hormesis, mitochondrial biogenesis, stress resilience. Dose-response findings.}}</p>
Aim for 700-900 words. Be specific with numbers and biological mechanisms.
Return only the HTML, no wrappers.`
}

function buildTypesPrompt(ctx: SectionContext): string {
  const subcats = [...new Set(ctx.products.map(p => p.subcategory).filter(Boolean))]
  const subcatHint = subcats.length > 0
    ? `The guide features these product subcategories: ${subcats.join(', ')}. Make sure at least these type names appear in the table.`
    : ''
  return `Generate the "Types of ${ctx.topicFull}" section for the "${ctx.guideTitle}" guide.
${subcatHint}
Return this structure:
<p>{{INTRO -- 3-4 sentences on how ${ctx.topicShortPlural} vary and why the type matters for goals, space, and budget.}}</p>
<div class="gtd-table-wrap">
  <table class="gtd-table">
    <thead><tr><th>Type</th><th>Best For</th><th>Key Spec</th><th>Price Range</th></tr></thead>
    <tbody>{{4-6 <tr> rows, one per type, with specific content in each <td>}}</tbody>
  </table>
</div>
<h3>Choosing the Right Type</h3>
<p>{{CHOOSING -- 4-6 sentences on decision factors: space, budget, health goals, frequency, number of users. Be opinionated with direct recommendations.}}</p>
<p>{{CLOSING -- 2-3 sentences on common mistakes when choosing and what to prioritize.}}</p>
Aim for 600-800 words. Be specific with specs, dimensions, and price ranges.
Return only the HTML, no wrappers.`
}

function buildHealthBenefitsPrompt(ctx: SectionContext, clusterLinks: Array<{title:string;slug:string}>): string {
  const benefitLinks = clusterLinks
    .filter(l => /benefit|health|recover|sleep|stress|immune|mental|weight|pain|inflam/i.test(l.title))
    .slice(0, 3)
  const linkHtml = benefitLinks.map(l =>
    `<a href="/blogs/guides/${l.slug}">${l.title}</a>`
  ).join(', ')
  return `Generate the Health Benefits section for the "${ctx.guideTitle}" guide.
Return this structure with 6 benefit cards PLUS expanded research detail:
<p>{{INTRO -- 3-4 sentences on the breadth of researched benefits. Reference growing peer-reviewed research.}}</p>
<div class="gtd-benefits-grid">
  {{6 benefit cards, each using this structure:}}
  <div class="gtd-benefit-card">
    <span class="gtd-benefit-icon">{{EMOJI}}</span>
    <h4>{{BENEFIT_TITLE -- 2-4 words}}</h4>
    <p>{{BENEFIT_DESC -- 2-3 sentences with specific mechanism, research context, and measurable outcome.}}</p>
  </div>
</div>
<h3>What the Research Shows</h3>
<p>{{RESEARCH -- 4-6 sentences synthesizing compelling research. Mention specific study contexts. Cover dose-response where known.}}</p>
${benefitLinks.length > 0 ? `<p>For deeper dives into specific benefits, explore: ${linkHtml}.</p>` : '<p>{{CLOSING -- 2-3 sentences connecting benefits to practical use and protocols covered next.}}</p>' }
Benefit areas (choose 6 most relevant for ${ctx.topicShort}): Recovery, Mental clarity/stress, Sleep, Immune function, Cardiovascular, Metabolism/weight, Pain/inflammation, Mood/dopamine, Skin, Longevity/hormesis.
Aim for 700-900 words. Be evidence-based and specific.
Return only the HTML, no wrappers.`
}

function buildHowToUsePrompt(ctx: SectionContext, clusterLinks: Array<{title:string;slug:string}>): string {
  const protocolLinks = clusterLinks
    .filter(l => /how|protocol|guide|beginner|start|routine|tips|schedule/i.test(l.title))
    .slice(0, 2)
  const linkPara = protocolLinks.length > 0
    ? `<p>For more detailed protocols, see: ${protocolLinks.map(l => `<a href="/blogs/guides/${l.slug}">${l.title}</a>`).join(' and ')}.</p>`
    : ''
  return `Generate the "How to Use ${ctx.topicShort}" section for the "${ctx.guideTitle}" guide.
Return this structure:
<p>{{INTRO -- 3-4 sentences on why protocol matters. Both under-use and over-use are common mistakes.}}</p>
<h3>Beginner Protocol (First 2 Weeks)</h3>
<p>{{BEGINNER_CONTEXT -- 2-3 sentences on what to expect as a beginner.}}</p>
<ol>
  <li><strong>{{STEP_1}}</strong> -- {{2-3 sentences with exact temperature/duration/setting}}</li>
  <li><strong>{{STEP_2}}</strong> -- {{2-3 sentences}}</li>
  <li><strong>{{STEP_3}}</strong> -- {{2-3 sentences}}</li>
  <li><strong>{{STEP_4}}</strong> -- {{2-3 sentences}}</li>
  <li><strong>{{STEP_5}}</strong> -- {{2-3 sentences}}</li>
</ol>
<h3>Intermediate Protocol (Weeks 3-8)</h3>
<p>{{INTERMEDIATE -- 4-5 sentences on progression -- specific increases in duration, temperature, frequency.}}</p>
<h3>Advanced Techniques</h3>
<p>{{ADVANCED -- 4-5 sentences on stacking, contrast therapy, timing around workouts, frequency.}}</p>
<h3>Common Mistakes to Avoid</h3>
<ul>
  <li>{{MISTAKE_1 -- specific mistake and why it hurts results, 1-2 sentences}}</li>
  <li>{{MISTAKE_2}}</li>
  <li>{{MISTAKE_3}}</li>
</ul>
${linkPara}
Aim for 800-1,000 words. Make every step specific.
Return only the HTML, no wrappers.`
}

function buildSafetyPrompt(ctx: SectionContext): string {
  return `Generate the Safety & Contraindications section for the "${ctx.guideTitle}" guide.
Return this structure:
<div class="gtd-callout-warn">
  <p><strong>Medical disclaimer:</strong> {{ONE sentence advising consultation with a doctor for pre-existing conditions, pregnancy, or cardiovascular medications.}}</p>
</div>
<p>{{INTRO -- 3-4 sentences establishing that ${ctx.topicShort} is safe for most healthy adults when used correctly, but understanding contraindications is essential.}}</p>
<h3>Who Should Consult a Doctor First</h3>
<ul>
  <li><strong>{{CONDITION_1}}</strong> -- {{1-2 sentences on why this condition interacts with ${ctx.topicShort} and the risk}}</li>
  <li><strong>{{CONDITION_2}}</strong> -- {{1-2 sentences}}</li>
  <li><strong>{{CONDITION_3}}</strong> -- {{1-2 sentences}}</li>
  <li><strong>{{CONDITION_4}}</strong> -- {{1-2 sentences}}</li>
  <li><strong>{{CONDITION_5}}</strong> -- {{1-2 sentences}}</li>
</ul>
<h3>Safety Best Practices</h3>
<ul>
  <li><strong>{{PRACTICE_1}}</strong> -- {{2-3 sentences with specific actionable guidance}}</li>
  <li><strong>{{PRACTICE_2}}</strong> -- {{2-3 sentences}}</li>
  <li><strong>{{PRACTICE_3}}</strong> -- {{2-3 sentences}}</li>
  <li><strong>{{PRACTICE_4}}</strong> -- {{2-3 sentences}}</li>
</ul>
<h3>Warning Signs to Stop Immediately</h3>
<p>{{WARNING_SIGNS -- 3-4 sentences listing specific symptoms that mean end your session and what to do.}}</p>
Aim for 600-800 words. Name specific conditions, not vague categories.
Return only the HTML, no wrappers.`
}

function buildFeaturedProductsPrompt(ctx: SectionContext): string {
  const productList = ctx.products.map(p =>
    `- ${p.title} by ${p.vendor} ($${p.price}) [${p.role === 'best-value' ? 'Best Value' : 'Best Upgrade'}]: ${p.desc}`
  ).join('\n')

  return `Generate the Featured Products introduction for the "${ctx.guideTitle}" guide.

The guide covers ${ctx.topicFull}. The reader has just finished learning about safety considerations.

Here are the selected products:
${productList}

Return this structure:
<p>{{INTRO -- 2-3 sentences bridging from the guide content to product recommendations. Reference what the reader learned about ${ctx.topicShort} (benefits, how to use, safety) and explain that you've selected these products based on quality, value, and the criteria discussed in the guide.}}</p>

<p>{{SELECTION CRITERIA -- 2-3 sentences explaining what you looked for when choosing these ${ctx.topicShortPlural}: build quality, key specs that matter based on the how-it-works section, safety features from the safety section, and value for money. Be specific to ${ctx.topicShort}, not generic.}}</p>

Do NOT include product cards, prices, or individual product descriptions -- those are inserted separately.
Do NOT add an <h2> heading -- that is handled by the template.
Keep the tone helpful and authoritative. Write in second person ("you").`
}

function buildFaqPrompt(ctx: SectionContext): string {
  const priceRange = ctx.products.length > 0
    ? `\$${Math.min(...ctx.products.map(p => parseFloat(p.price) || 0)).toLocaleString()}\u2013\$${Math.max(...ctx.products.map(p => parseFloat(p.price) || 0)).toLocaleString()}`
    : 'varies widely'
  return `Generate 8 FAQ items for the "${ctx.guideTitle}" guide.
Each FAQ must use this EXACT HTML structure:
<div class="gtd-faq-item">
  <button class="gtd-faq-q" aria-expanded="false">
    {{QUESTION}}
    <span class="gtd-faq-icon">+</span>
  </button>
  <div class="gtd-faq-a">
    <p>{{ANSWER -- 3-5 sentences, thorough and specific. Include numbers, temperatures, durations, research-backed context.}}</p>
  </div>
</div>
Cover these question types:
1. What temperature / settings to use (specific numbers for beginners and advanced)
2. How long per session (specific duration ranges)
3. How often per week (with progression guidance)
4. Cost / price range (mention ${priceRange} and what affects price)
5. Most-searched health benefit question (thorough evidence-based answer)
6. Safety / who shouldn't use it (specific conditions)
7. Maintenance, installation, or setup question (practical details)
8. Comparison question (vs. another modality -- balanced, specific)
Aim for 600-800 words across all 8 FAQs.
Return 8 gtd-faq-item blocks, nothing else.`
}

function buildMetaPrompt(ctx: SectionContext): string {
  return `Generate metadata for the "${ctx.guideTitle}" guide about ${ctx.topicFull}.
Return ONLY valid JSON (no fences, no explanation):
{
  "keyTakeawaysSchema": [
    "{{takeaway_1 as plain text for schema}}",
    "{{takeaway_2}}",
    "{{takeaway_3}}",
    "{{takeaway_4}}",
    "{{takeaway_5}}"
  ],
  "faqSchema": [
    {"q": "{{faq_question_1}}", "a": "{{faq_answer_1_concise}}"},
    {"q": "{{faq_question_2}}", "a": "{{faq_answer_2_concise}}"},
    {"q": "{{faq_question_3}}", "a": "{{faq_answer_3_concise}}"}
  ],
  "readTimeMins": {{estimated_read_time_as_integer}}
}`
}

// ─── Route handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      sectionId,
      guideTitle,
      topicShort,
      topicShortPlural,
      topicFull,
      products = [],
      clusterLinks = [],
      previousSections = {},
    } = body as { sectionId: SectionId } & SectionContext

    if (!sectionId || !guideTitle || !topicShort) {
      return NextResponse.json({ error: 'sectionId, guideTitle, and topicShort are required' }, { status: 400 })
    }

    let cleanTopicShort = (topicShort || '').replace(/the ultimate guide to/gi, '').replace(/ultimate guide to/gi, '').replace(/guide/gi, '').replace(/\(\d{4}\)/g, '').trim();
    let cleanTopicFull = (topicFull || cleanTopicShort).replace(/the ultimate guide to/gi, '').replace(/ultimate guide to/gi, '').replace(/guide/gi, '').replace(/\(\d{4}\)/g, '').trim();

    cleanTopicShort = cleanTopicShort.charAt(0).toUpperCase() + cleanTopicShort.slice(1);
    cleanTopicFull = cleanTopicFull.charAt(0).toUpperCase() + cleanTopicFull.slice(1);

    const ctx: SectionContext = {
      guideTitle,
      topicShort: cleanTopicShort,
      topicShortPlural: topicShortPlural || `${cleanTopicShort}s`,
      topicFull: cleanTopicFull,
      year: new Date().getFullYear(),
      products,
      clusterLinks,
      previousSections,
    }

    // Build the user prompt for this specific section
    let userPrompt: string
    switch (sectionId) {
      case 'key-takeaways':  userPrompt = buildKeyTakeawaysPrompt(ctx); break
      case 'what-is':        userPrompt = buildWhatIsPrompt(ctx); break
      case 'how-it-works':   userPrompt = buildHowItWorksPrompt(ctx); break
      case 'types':          userPrompt = buildTypesPrompt(ctx); break
      case 'health-benefits': userPrompt = buildHealthBenefitsPrompt(ctx, clusterLinks); break
      case 'how-to-use':     userPrompt = buildHowToUsePrompt(ctx, clusterLinks); break
      case 'safety':         userPrompt = buildSafetyPrompt(ctx); break
      case 'featured-products': userPrompt = buildFeaturedProductsPrompt(ctx); break
      case 'faq':            userPrompt = buildFaqPrompt(ctx); break
      case 'meta':           userPrompt = buildMetaPrompt(ctx); break
      default:
        return NextResponse.json({ error: `Unknown sectionId: ${sectionId}` }, { status: 400 })
    }

    // Add context from previously generated sections so AI stays consistent
    const contextSummary = Object.entries(previousSections)
      .filter(([, v]) => v)
      .map(([k, v]) => `[${k}]: ${v.slice(0, 200)}`)
      .join('\n')

    const fullUserPrompt = contextSummary
      ? `GUIDE CONTEXT (previously generated -- stay consistent):\n${contextSummary}\n\n---\n\n${userPrompt}`
      : userPrompt

    const raw = await callAI(SYSTEM_BASE, fullUserPrompt, { maxTokens: 4096 })

    // Strip any accidental markdown fences
    const html = raw
      .replace(/^\`\`\`html?\n?/i, '')
      .replace(/^\`\`\`\n?/, '')
      .replace(/\n?\`\`\`$/g, '')
      .trim()

    // For meta section, try to parse JSON
    if (sectionId === 'meta') {
      try {
        const metaData = JSON.parse(html)
        return NextResponse.json({ sectionId, metaData, success: true })
      } catch {
        // Return raw if parse fails -- UI will handle gracefully
        return NextResponse.json({ sectionId, html, success: true })
      }
    }

    return NextResponse.json({ sectionId, html, success: true })
  } catch (error) {
    console.error('[generate-section]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Generation failed' },
      { status: 500 }
    )
  }
}
