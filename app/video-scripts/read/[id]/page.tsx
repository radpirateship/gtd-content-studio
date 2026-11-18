"use client";

/**
 * /video-scripts/read/[id]: one script, ready to record.
 * Cue cards: one beat per screen, the on-screen point in large type and the
 * line underneath as a reference, since James talks from points rather than
 * reading word for word.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import VideoScriptView, { isSpecV2 } from "@/components/VideoScriptView";
import { captionText, scriptToText } from "@/lib/video-scripts/format";
import type { ScriptOutput } from "@/lib/video-scripts/types";

type Row = { id: number; target_title: string; status: string; content: unknown };

export default function ReadScriptPage() {
  const params = useParams<{ id: string }>();
  const [row, setRow] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState(false);
  const [card, setCard] = useState(0);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch(`/api/video-scripts/scripts?id=${params.id}`)
      .then((r) => r.json())
      .then((d) => (d.ok ? setRow(d.script) : setError(d.error || "Not found")))
      .catch((e) => setError(String(e)));
  }, [params.id]);

  if (error) return <div className="p-8 text-red-700">{error}</div>;
  if (!row) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!isSpecV2(row.content)) {
    return <pre className="p-8 whitespace-pre-wrap text-sm">This script was written in an older format.{"\n\n"}{JSON.stringify(row.content, null, 2)}</pre>;
  }
  const o: ScriptOutput = row.content;

  const copy = (label: string, text: string) =>
    navigator.clipboard.writeText(text).then(() => { setCopied(label); setTimeout(() => setCopied(""), 1500); });

  const deck: Array<{ head: string; line: string; tag: string }> =
    o.type === "LONG_FORM" && o.chapters?.length
      ? [
          { head: o.headline, line: o.hookLine, tag: "Open" },
          ...o.chapters.flatMap((c, i) => [
            { head: c.question, line: "", tag: `Chapter ${i + 1}` },
            ...c.beats.map((b) => ({ head: b.onScreenText, line: b.spoken, tag: `Chapter ${i + 1}` })),
          ]),
          { head: o.endCard || o.verdict, line: `${o.verdict} ${o.ctaSpoken}`, tag: "Close" },
        ]
      : o.beats.map((b) => ({ head: b.onScreenText, line: b.spoken, tag: `${b.beat} · ${b.startSec}-${b.endSec}s · ${b.visualType}` }));

  if (cards) {
    const d = deck[Math.min(card, deck.length - 1)];
    return (
      <div className="flex min-h-screen flex-col bg-black p-6 text-white">
        <div className="flex items-center justify-between text-sm text-gray-400">
          <button onClick={() => setCards(false)} className="rounded border border-gray-600 px-3 py-1">Exit cue cards</button>
          <span>{card + 1} / {deck.length} · {d.tag}</span>
        </div>
        <div className="mx-auto flex max-w-3xl flex-1 flex-col justify-center space-y-8">
          <p className="text-5xl font-bold leading-tight">{d.head}</p>
          {d.line && <p className="text-2xl leading-snug text-gray-300">{d.line}</p>}
        </div>
        <div className="flex justify-between">
          <button disabled={card === 0} onClick={() => setCard((n) => n - 1)} className="rounded border border-gray-600 px-6 py-3 text-lg disabled:opacity-30">Back</button>
          <button disabled={card >= deck.length - 1} onClick={() => setCard((n) => n + 1)} className="rounded bg-white px-6 py-3 text-lg text-black disabled:opacity-30">Next</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <div className="text-xs uppercase text-gray-500">{row.target_title} · {row.status}</div>
        <h1 className="text-2xl font-bold">{o.title || o.headline}</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setCard(0); setCards(true); }} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">Cue cards</button>
        <button onClick={() => copy("script", scriptToText(o))} className="rounded-md border px-4 py-2 text-sm">{copied === "script" ? "Copied" : "Copy full script"}</button>
        <button onClick={() => copy("caption", captionText(o))} className="rounded-md border px-4 py-2 text-sm">{copied === "caption" ? "Copied" : "Copy caption"}</button>
      </div>
      <VideoScriptView script={o} large />
    </div>
  );
}
