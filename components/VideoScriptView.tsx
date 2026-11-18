"use client";

// Renders one generated video script (spec v2 schema). Used in the Video
// Scripts tab and the read view.
import type { ScriptOutput } from "@/lib/video-scripts/types";

const VISUAL_STYLE: Record<string, string> = {
  JAMES: "bg-blue-100 text-blue-800",
  SUPPLIER: "bg-purple-100 text-purple-800",
  PHOTO_CALLOUT: "bg-amber-100 text-amber-800",
  AI_CLIP: "bg-teal-100 text-teal-800",
};

export function isSpecV2(c: unknown): c is ScriptOutput {
  return Boolean(c && typeof c === "object" && "type" in (c as object) && "headline" in (c as object));
}

export default function VideoScriptView({ script: o, large = false }: { script: ScriptOutput; large?: boolean }) {
  const txt = large ? "text-base" : "text-sm";
  return (
    <div className={`space-y-4 ${txt}`}>
      <div className="rounded-md bg-gray-900 p-3 text-white">
        <div className="text-xs uppercase text-gray-400">Headline (on screen, whole clip)</div>
        <div className="text-lg font-bold">{o.headline}</div>
        <div className="mt-2 text-xs uppercase text-gray-400">Hook ({o.hookType})</div>
        <div>{o.hookLine}</div>
        {o.first2Seconds && <div className="mt-1 text-xs text-gray-300">First 2s: {o.first2Seconds}</div>}
      </div>

      <div className="text-xs text-gray-500">
        {o.type} · {o.series} · {o.lengthSec}s · {o.wordCount} words (budget {o.wordBudget?.min} to {o.wordBudget?.max})
      </div>

      {o.type !== "LONG_FORM" && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-2 py-1">#</th><th className="px-2 py-1">Sec</th><th className="px-2 py-1">Spoken</th><th className="px-2 py-1">Visual</th><th className="px-2 py-1">On screen</th></tr>
            </thead>
            <tbody>
              {o.beats.map((b) => (
                <tr key={b.index} className="border-t align-top">
                  <td className="px-2 py-2 text-gray-500">{b.index}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-gray-500">{b.startSec}-{b.endSec}</td>
                  <td className="px-2 py-2">{b.spoken}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${VISUAL_STYLE[b.visualType] || ""}`}>{b.visualType}</span>
                    <div className="mt-1 text-xs text-gray-600">{b.visualDescription}</div>
                    {b.aiClip?.sourcePhoto && <div className="text-xs text-gray-400">AI {b.aiClip.move} on photo</div>}
                  </td>
                  <td className="px-2 py-2 font-medium">{b.onScreenText}{b.specRefs?.length ? <div className="text-xs font-normal text-gray-400">{b.specRefs.join(", ")}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {o.type === "LONG_FORM" && (o.chapters || []).map((c, i) => (
        <div key={i} className="rounded-md border p-3 space-y-2">
          <div className="font-semibold">Chapter {i + 1}: {c.question} {c.downside && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs text-red-700">the one to avoid</span>}</div>
          <ol className="list-decimal pl-5 space-y-1">
            {c.beats.map((b, j) => (
              <li key={j}>{b.spoken} <span className="text-xs text-gray-500">[{b.visualType}] {b.onScreenText}</span></li>
            ))}
          </ol>
          <div className="text-xs"><b>Summary graphic:</b> {c.summaryGraphic}</div>
          <div className="rounded bg-gray-50 p-2 text-xs"><b>Short cut ({c.shortCut.wordCount} words):</b> {c.shortCut.spoken} <i>On screen: {c.shortCut.onScreenText}</i></div>
        </div>
      ))}

      <div className="grid gap-2 md:grid-cols-2">
        <div><span className="text-xs uppercase text-gray-500">Verdict</span><div>{o.verdict}</div></div>
        <div><span className="text-xs uppercase text-gray-500">CTA</span><div>{o.ctaSpoken}</div>{o.endCard && <div className="text-xs text-gray-500">End card: {o.endCard}</div>}</div>
      </div>

      <div className="rounded-md bg-gray-50 p-3">
        <div className="text-xs uppercase text-gray-500">Caption</div>
        <div className="font-medium">{o.caption.firstLine}</div>
        <ol className="list-decimal pl-5">{o.caption.numbered.map((n, i) => <li key={i}>{n}</li>)}</ol>
        <div>{o.caption.saveShareCta}</div>
        <div className="text-blue-700">{o.hashtags.join(" ")}</div>
      </div>

      <details>
        <summary className="cursor-pointer text-xs uppercase text-gray-500">Products, sources and assets</summary>
        <div className="mt-2 space-y-2 text-xs">
          <div>{o.products.map((p) => <div key={p.url}><a href={p.url} target="_blank" className="hover:underline">{p.name}</a> · ${p.price.toLocaleString("en-US")}</div>)}</div>
          <table className="w-full">
            <tbody>
              {o.specs.map((s) => (
                <tr key={s.id} className="border-t align-top">
                  <td className="py-1 pr-2 text-gray-500">{s.id}</td>
                  <td className="py-1 pr-2">{s.label}: <b>{s.value}</b>{s.derived && <span className="text-amber-700"> (derived: {s.formula})</span>}</td>
                  <td className="py-1 text-gray-500">&ldquo;{s.sourceText}&rdquo;</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            Assets: {o.assets.photos.length} photos · {o.assets.supplierClips.length} supplier clips
            {o.assets.supplierClips.length ? ` (licence ${o.assets.supplierClips[0].licence})` : ""} · {o.assets.aiClips.length} AI clips · logos {o.assets.logos.join(", ")}
          </div>
        </div>
      </details>

      {(o.flags.length > 0 || o.validation.warnings.length > 0 || o.validation.failures.length > 0) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
          {o.validation.failures.map((f, i) => <div key={`f${i}`} className="text-red-700">Failed: {f}</div>)}
          {o.validation.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-900">Check: {w}</div>)}
          {o.flags.map((f, i) => <div key={`g${i}`} className="text-gray-700">Flag: {f}</div>)}
        </div>
      )}
    </div>
  );
}
