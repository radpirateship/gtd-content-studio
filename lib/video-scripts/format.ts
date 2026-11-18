// Human-readable script template (spec v2, section 4.1). Client-safe.
import { wordBudget, type ScriptOutput } from "./types";

const usd = (n: number) => (n ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "n/a");

export function scriptToText(o: ScriptOutput): string {
  const b = o.wordBudget || wordBudget(o.lengthSec);
  const L: string[] = [];
  L.push(`TYPE: ${o.type}`);
  L.push(`SERIES / TITLE: ${o.series} | ${o.title}`);
  L.push(`ON-SCREEN HEADLINE: ${o.headline}`);
  L.push(`HOOK LINE: ${o.hookLine}`);
  L.push(`FIRST 2 SECONDS: ${o.first2Seconds}`);
  L.push(`LENGTH: ${o.lengthSec}s | WORDS: ${o.wordCount} (budget ${b.min} to ${b.max} @ ${b.wordsPerSecond.min} to ${b.wordsPerSecond.max} wps)`);
  L.push("");
  if (o.type === "LONG_FORM" && o.chapters?.length) {
    o.chapters.forEach((c, i) => {
      L.push(`CHAPTER ${i + 1}${c.downside ? " (the one to avoid)" : ""}: ${c.question}`);
      c.beats.forEach((bt, j) => L.push(`  ${j + 1}. ${bt.spoken}\n     [${bt.visualType || ""}] ${bt.visualDescription || ""} | ON SCREEN: ${bt.onScreenText}`));
      L.push(`  SUMMARY GRAPHIC: ${c.summaryGraphic}`);
      L.push(`  SHORT CUT (${c.shortCut.wordCount} words): ${c.shortCut.spoken} | ON SCREEN: ${c.shortCut.onScreenText}`);
      L.push("");
    });
  } else {
    L.push("BEATS:");
    L.push("| # | Seconds | Spoken line | Visual type | Visual description | On-screen text |");
    for (const bt of o.beats) {
      const ai = bt.aiClip?.sourcePhoto ? ` (AI ${bt.aiClip.move} on ${bt.aiClip.sourcePhoto})` : "";
      L.push(`| ${bt.index} | ${bt.startSec}-${bt.endSec} | ${bt.spoken} | ${bt.visualType} | ${bt.visualDescription}${ai} | ${bt.onScreenText} |`);
    }
    L.push("");
  }
  L.push(`VERDICT: ${o.verdict}`);
  L.push(`CTA (spoken): ${o.ctaSpoken}`);
  if (o.endCard) L.push(`END CARD: ${o.endCard}`);
  L.push("");
  L.push("CAPTION:");
  L.push(`  ${o.caption.firstLine}`);
  o.caption.numbered.forEach((n, i) => L.push(`  ${i + 1}. ${n}`));
  L.push(`  ${o.caption.saveShareCta}`);
  L.push(`HASHTAGS: ${o.hashtags.join(" ")}`);
  L.push("");
  L.push("PRODUCTS:");
  o.products.forEach((p) => L.push(`  ${p.name} | ${usd(p.price)} | ${p.url}`));
  L.push("SOURCES:");
  o.specs.forEach((s) => L.push(`  ${s.id} ${s.label}: ${s.value}${s.derived ? ` (derived: ${s.formula})` : ""} | ${s.sourceUrl} | "${s.sourceText}"`));
  if (o.citedStudy) L.push(`  Study: ${o.citedStudy.title}, ${o.citedStudy.journal} ${o.citedStudy.year}, ${o.citedStudy.url}`);
  L.push("ASSET CHECKLIST:");
  L.push(`  photos: ${o.assets.photos.length} | supplier clips: ${o.assets.supplierClips.length}${o.assets.supplierClips.length ? ` (licence ${o.assets.supplierClips[0].licence})` : ""} | AI clips: ${o.assets.aiClips.map((a) => `${a.move} on ${a.sourcePhoto}`).join("; ") || "0"} | logos: ${o.assets.logos.join(", ")}`);
  const flags = [...o.flags, ...o.validation.failures.map((f) => `FAILED: ${f}`), ...o.validation.warnings];
  L.push(`FLAGS: ${flags.length ? "\n  - " + flags.join("\n  - ") : "none"}`);
  return L.join("\n");
}

export function captionText(o: ScriptOutput): string {
  return [o.caption.firstLine, "", ...o.caption.numbered.map((n, i) => `${i + 1}. ${n}`), "", o.caption.saveShareCta, "", o.hashtags.join(" ")].join("\n");
}
