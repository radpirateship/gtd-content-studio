// Script generation: gather live sources -> prompt -> parse -> validate ->
// one fix-up retry on hard failures (short types) -> save.
// Products, specs, sources and the asset checklist are assembled in code
// from Shopify data, not taken from the model, so they cannot be invented.
import { callAI, stripReasoning } from "@/lib/ai";
import { getSQL } from "@/lib/db";
import { stripEmDashes } from "@/lib/brandRules";
import { ensureVideoTables } from "./db";
import { gatherForGeneration, type GenerationSources } from "./sources";
import { buildFixPrompt, buildSystemPrompt, buildUserPrompt, PROMPT_VERSION } from "./prompt";
import { validateScript } from "./validate";
import { countWords, spokenLines, wordBudget, type GenerateInput, type ScriptOutput } from "./types";

function extractJson(raw: string): Record<string, unknown> {
  const text = stripReasoning(raw) || raw;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

const str = (v: unknown) => (typeof v === "string" ? stripEmDashes(v).trim() : v == null ? "" : stripEmDashes(String(v)).trim());
const arr = <T>(v: unknown, f: (x: Record<string, unknown>) => T): T[] => (Array.isArray(v) ? v.map((x) => f((x ?? {}) as Record<string, unknown>)) : []);
const VISUALS = ["JAMES", "SUPPLIER", "PHOTO_CALLOUT", "AI_CLIP"];
const visual = (v: unknown) => (VISUALS.includes(String(v)) ? String(v) : "PHOTO_CALLOUT") as ScriptOutput["beats"][number]["visualType"];

function normalise(raw: Record<string, unknown>, input: GenerateInput, src: GenerationSources): ScriptOutput {
  const cap = (raw.caption || {}) as Record<string, unknown>;
  const beats = arr(raw.beats, (b) => ({
    index: Number(b.index) || 0,
    startSec: Number(b.startSec) || 0,
    endSec: Number(b.endSec) || 0,
    beat: (str(b.beat) || "point") as ScriptOutput["beats"][number]["beat"],
    spoken: str(b.spoken),
    visualType: visual(b.visualType),
    visualDescription: str(b.visualDescription),
    aiClip: b.aiClip && typeof b.aiClip === "object"
      ? { sourcePhoto: str((b.aiClip as Record<string, unknown>).sourcePhoto), move: (str((b.aiClip as Record<string, unknown>).move) || "push_in") as "push_in" }
      : null,
    onScreenText: str(b.onScreenText),
    specRefs: Array.isArray(b.specRefs) ? b.specRefs.map(String) : [],
  })).map((b, i) => ({ ...b, index: i + 1 }));

  const chapters = input.type === "LONG_FORM"
    ? arr(raw.chapters, (c) => ({
        question: str(c.question),
        beats: arr(c.beats, (b) => ({
          spoken: str(b.spoken), onScreenText: str(b.onScreenText), visualType: visual(b.visualType),
          visualDescription: str(b.visualDescription), specRefs: Array.isArray(b.specRefs) ? b.specRefs.map(String) : [],
        })),
        summaryGraphic: str(c.summaryGraphic),
        downside: Boolean(c.downside),
        shortCut: (() => {
          const sc = (c.shortCut || {}) as Record<string, unknown>;
          const spoken = str(sc.spoken);
          return { spoken, onScreenText: str(sc.onScreenText), wordCount: countWords(spoken) };
        })(),
      }))
    : undefined;

  // Code-built fields.
  const all = src.comparison ? [...src.products, src.comparison] : src.products;
  const products = all.map((p) => ({ name: p.title, brand: p.vendor, price: Number(p.price) || 0, url: p.url }));
  const allBeats = [...beats, ...(chapters || []).flatMap((c) => c.beats.map((b, i) => ({ ...b, index: i + 1, startSec: 0, endSec: 0, beat: "point" as const, aiClip: null })))];
  const usedRefs = new Set([...allBeats.flatMap((b) => b.specRefs || []), ...arr(raw.numbersSpoken, (n) => str(n.specRef))]);
  const specs = src.specs.filter((s) => usedRefs.has(s.id));
  const assets = {
    photos: all.flatMap((p) => p.images.slice(0, 4).map((url, i) => ({ product: p.title, shot: i === 0 ? "hero" : `photo ${i + 1}: ${url}`, source: "PPW page" }))),
    supplierClips: allBeats.filter((b) => b.visualType === "SUPPLIER").map((b) => ({
      product: products[0]?.name || "", shot: b.visualDescription, modelMatched: true, licence: input.assets.licence === "confirmed" ? "confirmed" : "pending",
    })),
    aiClips: beats.filter((b) => b.visualType === "AI_CLIP").map((b) => ({
      sourcePhoto: b.aiClip?.sourcePhoto || all[0]?.images[0] || "", move: b.aiClip?.move || "push_in", durationSec: Math.max(1, b.endSec - b.startSec),
    })),
    logos: ["PPW", ...[...new Set(all.map((p) => p.vendor).filter(Boolean))]],
  };

  const out: ScriptOutput = {
    type: input.type,
    series: str(raw.series) || input.series,
    title: str(raw.title),
    headline: str(raw.headline).toUpperCase(),
    hookLine: str(raw.hookLine),
    hookType: str(raw.hookType) || input.hookType || "",
    first2Seconds: str(raw.first2Seconds),
    lengthSec: input.lengthSec,
    wordCount: 0,
    wordBudget: wordBudget(input.lengthSec),
    beats,
    chapters,
    verdict: str(raw.verdict),
    ctaSpoken: str(raw.ctaSpoken),
    endCard: str(raw.endCard) || undefined,
    caption: {
      firstLine: str(cap.firstLine),
      numbered: Array.isArray(cap.numbered) ? cap.numbered.map(str) : [],
      saveShareCta: str(cap.saveShareCta),
    },
    hashtags: (Array.isArray(raw.hashtags) ? raw.hashtags.map(str) : []).map((h) => (h.startsWith("#") ? h : `#${h}`)),
    numbersSpoken: arr(raw.numbersSpoken, (n) => ({ spoken: str(n.spoken), value: str(n.value), specRef: str(n.specRef) })),
    products,
    specs,
    citedStudy: input.citedStudy?.url ? input.citedStudy : null,
    assets,
    flags: Array.isArray(raw.flags) ? raw.flags.map(str).filter(Boolean) : [],
    validation: { passed: false, failures: [], warnings: [] },
  };
  out.wordCount = countWords(spokenLines(out).join(" "));
  return out;
}

export async function generateScript(input: GenerateInput) {
  await ensureVideoTables();
  const src = await gatherForGeneration(input);
  const isLong = input.type === "LONG_FORM";
  const system = buildSystemPrompt(input.type);
  const user = buildUserPrompt(input, src);
  const opts = isLong
    ? { maxTokens: 16000, timeoutMs: 270000, retryOnTimeout: false }
    : { maxTokens: 6000, timeoutMs: 110000, retryOnTimeout: false };

  let raw = await callAI(system, user, opts);
  let script = normalise(extractJson(raw), input, src);
  let result = validateScript(script, input, src.specs);
  let attempts = 1;

  // One fix-up pass for short scripts. Long form is too slow to run twice
  // inside one request, so its failures are shown for review instead.
  if (result.failures.length && !isLong) {
    raw = await callAI(system, `${user}\n\n${buildFixPrompt(JSON.stringify(extractJson(raw)), result.failures)}`, opts);
    script = normalise(extractJson(raw), input, src);
    result = validateScript(script, input, src.specs);
    attempts = 2;
  }

  script.validation = { passed: result.failures.length === 0, failures: result.failures, warnings: result.warnings };
  script.flags = [...new Set([...src.warnings, ...script.flags])];

  const sourceRecord = {
    promptVersion: PROMPT_VERSION,
    attempts,
    input,
    specPack: src.specs,
    articles: src.articles.map((a) => ({ articleId: a.articleId, title: a.title, url: a.url })),
  };

  const sql = getSQL();
  const rows = (await sql`
    INSERT INTO video_scripts (kind, target_key, target_title, status, format, length_sec, title, content, sources, warnings, notes)
    VALUES (${input.kind}, ${input.key}, ${src.collection?.title || src.products[0].title}, 'draft', ${input.type}, ${input.lengthSec},
            ${script.title || script.headline}, ${JSON.stringify(script)}::jsonb, ${JSON.stringify(sourceRecord)}::jsonb,
            ${JSON.stringify([...script.validation.failures, ...script.validation.warnings])}::jsonb, ${input.notes || null})
    RETURNING id
  `) as Array<{ id: number }>;

  return { id: rows[0].id, script };
}
