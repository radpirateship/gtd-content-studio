// Video Scripts: shared types and config. Client-safe (no server imports),
// so the UI and the server use the same shapes. Follows "PPW Content Studio:
// Script Generation Spec (v2)", Oct 9 2026.

export type ScriptType = "PRODUCT_REVIEW" | "HOOK_ANGLE" | "LONG_FORM";
export type VisualType = "JAMES" | "SUPPLIER" | "PHOTO_CALLOUT" | "AI_CLIP";
export type BeatKind = "hook" | "name" | "point" | "frame" | "part" | "verdict";

// Pace from James's example videos. Adjust after the first PPW videos.
export const WORDS_PER_SECOND = { min: 3.0, max: 3.5 };

export const SHORT_LENGTH = { min: 20, max: 45, defaultA: 35, defaultB: 38 };
export const LONG_LENGTH_MIN = { min: 8, max: 20, default: 10 };

export function wordBudget(lengthSec: number) {
  return {
    min: Math.round(lengthSec * WORDS_PER_SECOND.min),
    max: Math.round(lengthSec * WORDS_PER_SECOND.max),
    wordsPerSecond: WORDS_PER_SECOND,
  };
}

export const SCRIPT_TYPES: Array<{ id: ScriptType; label: string; description: string }> = [
  { id: "PRODUCT_REVIEW", label: "A. Product review", description: "Strict, straightforward review of one product. Answers a buyer question with listed specs and ends on a blunt verdict. 20 to 45s." },
  { id: "HOOK_ANGLE", label: "B. Hook & angle", description: "A broader idea (ritual, recovery setup, collection) with 1 to 3 real products as the how. 20 to 45s." },
  { id: "LONG_FORM", label: "C. Long-form explainer", description: "8 to 20 minute YouTube explainer on one buyer decision. Each chapter can be cut into its own Short." },
];

export const SERIES: Record<ScriptType, string[]> = {
  PRODUCT_REVIEW: ["Sauna Heater Truths", "PPW Price Check", "PPW Honest Verdict"],
  HOOK_ANGLE: ["The PPW Ritual", "PPW Setup Check"],
  LONG_FORM: ["Explained", "Things That Decide the Buy"],
};

export const HOOK_TYPES: Record<ScriptType, Array<{ id: string; label: string }>> = {
  PRODUCT_REVIEW: [
    { id: "number_led", label: "Number-led" },
    { id: "insider", label: "Insider (softened)" },
    { id: "price_question", label: "Price question" },
    { id: "head_to_head", label: "Head-to-head price" },
    { id: "contrarian", label: "Contrarian" },
    { id: "question_led", label: "Question-led" },
  ],
  HOOK_ANGLE: [
    { id: "setup_reality", label: "Setup reality" },
    { id: "ritual", label: "Ritual, numbered" },
    { id: "surprise", label: "Surprise / comparison" },
    { id: "collection", label: "Collection" },
    { id: "health_stat", label: "Health stat (needs a cited study)" },
    { id: "question_led", label: "Question-led" },
  ],
  LONG_FORM: [
    { id: "number_led", label: "Number-led" },
    { id: "question_led", label: "Question-led" },
  ],
};

export const ANGLE_TYPES = [
  { id: "ritual", label: "Ritual" },
  { id: "recovery_setup", label: "Recovery setup" },
  { id: "collection", label: "Collection" },
  { id: "myth_vs_listing", label: "Myth vs listing" },
  { id: "comparison_surprise", label: "Comparison surprise" },
];

export type Spec = {
  id: string; // s1, s2 ... (d1, d2 ... for derived)
  product: string; // product title it belongs to
  label: string;
  value: string;
  unit: string;
  derived: boolean;
  formula: string | null;
  sourceUrl: string;
  sourceText: string;
};

export type CitedStudy = { title: string; authors: string; journal: string; year: string; url: string; finding: string };

export type AssetsAvailable = {
  photos: number;
  supplierVideo: boolean;
  licence: "confirmed" | "pending" | "none";
};

export type GenerateInput = {
  type: ScriptType;
  kind: "product" | "collection"; // what the panel was opened on
  key: string; // product id or collection handle
  productIds: string[]; // 1 to 3 products the script features (A uses the first)
  comparisonProductId?: string | null; // A, vs-format
  series: string;
  hookType: string | null; // null = let the generator choose
  targetBuyer: string;
  lengthSec: number; // A/B 20 to 45; C 480 to 1200
  assets: AssetsAvailable;
  isBestSellerVerified: boolean;
  manufacturerSpecs?: { url: string; text: string } | null;
  angleType?: string | null; // B
  angleStatement?: string | null; // B
  citedStudy?: CitedStudy | null; // B, only for health_stat hooks
  chapterCount?: number | null; // C
  chapterQuestions?: string[] | null; // C, optional
  articleIds?: string[] | null; // blog posts used as context only (never a fact source)
  notes?: string | null;
};

export type Beat = {
  index: number;
  startSec: number;
  endSec: number;
  beat: BeatKind;
  spoken: string;
  visualType: VisualType;
  visualDescription: string;
  aiClip?: { sourcePhoto: string; move: "push_in" | "pan" | "parallax" } | null;
  onScreenText: string;
  specRefs: string[];
};

export type SpokenNumber = { spoken: string; value: string; specRef: string };

export type Chapter = {
  question: string;
  beats: Array<{ spoken: string; onScreenText: string; visualType?: VisualType; visualDescription?: string; specRefs?: string[] }>;
  summaryGraphic: string;
  downside: boolean;
  shortCut: { spoken: string; onScreenText: string; wordCount: number };
};

export type ScriptOutput = {
  type: ScriptType;
  series: string;
  title: string;
  headline: string;
  hookLine: string;
  hookType: string;
  first2Seconds: string;
  lengthSec: number;
  wordCount: number;
  wordBudget: { min: number; max: number; wordsPerSecond: { min: number; max: number } };
  beats: Beat[];
  chapters?: Chapter[];
  verdict: string;
  ctaSpoken: string;
  endCard?: string;
  caption: { firstLine: string; numbered: string[]; saveShareCta: string };
  hashtags: string[];
  numbersSpoken: SpokenNumber[];
  products: Array<{ name: string; brand: string; price: number; url: string }>;
  specs: Spec[];
  citedStudy: CitedStudy | null;
  assets: {
    photos: Array<{ product: string; shot: string; source: string }>;
    supplierClips: Array<{ product: string; shot: string; modelMatched: boolean; licence: string }>;
    aiClips: Array<{ sourcePhoto: string; move: string; durationSec: number }>;
    logos: string[];
  };
  flags: string[];
  validation: { passed: boolean; failures: string[]; warnings: string[] };
};

export const countWords = (s: string) => (s || "").trim().split(/\s+/).filter(Boolean).length;

/** All spoken words in a script, in order. */
export function spokenLines(o: ScriptOutput): string[] {
  if (o.type === "LONG_FORM" && o.chapters?.length) {
    return [o.hookLine, ...o.chapters.flatMap((c) => c.beats.map((b) => b.spoken)), o.ctaSpoken].filter(Boolean);
  }
  return (o.beats || []).map((b) => b.spoken).filter(Boolean);
}
