// lib/keyword-research-bundles.ts
// Research files shipped in the repo (scripts/keyword-research/*.json), each an
// array of { slug, research }. Add a new file here after an Ahrefs/GSC pull and
// the Keyword Audit tab's "Load bundled research" button imports it.
import saunasRecovery from "@/scripts/keyword-research/2026-10-saunas-recovery.json";
import other from "@/scripts/keyword-research/2026-10-clinical-cardio-gym-wellness-sports.json";

export const RESEARCH_BUNDLES: Array<{ name: string; rows: Array<{ slug: string; research: unknown }> }> = [
  { name: "2026-10 saunas + recovery (pulled 5 Oct 2026)", rows: saunasRecovery as Array<{ slug: string; research: unknown }> },
  { name: "2026-10 clinical, cardio, gym, wellness, sports (GSC + competitors; Ahrefs ideas partial, use Fetch Ahrefs ideas for gaps)", rows: other as Array<{ slug: string; research: unknown }> },
];
