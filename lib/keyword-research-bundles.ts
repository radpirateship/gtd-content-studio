// lib/keyword-research-bundles.ts
// Research files shipped in the repo (scripts/keyword-research/*.json), each an
// array of { slug, research }. Add a new file here after an Ahrefs/GSC pull and
// the Keyword Audit tab's "Load bundled research" button imports it.
//
// Empty for GTD: no research has been pulled for greenthumbdepot.com yet.
export const RESEARCH_BUNDLES: Array<{ name: string; rows: Array<{ slug: string; research: unknown }> }> = [];
