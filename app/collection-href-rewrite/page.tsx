"use client";

/**
 * /collection-href-rewrite — repoint in-article links that target retired
 * collection URLs to their live destination, so they stop passing through
 * the 301. Only href values change; anchor text and prose are untouched.
 *
 * Dry run scans every article and lists what would change. Apply loops in
 * rate-limited batches via /api/maintenance/rewrite-collection-hrefs.
 */

import { useMemo, useState } from "react";

const DEFAULT_PAIRS = `1-person-traditional-sauna, 1-person-saunas
1-person-traditional-saunas, 1-person-saunas
2-person-traditional-sauna, 2-person-saunas
3-person-traditional-sauna, 3-person-saunas
4-person-traditional-sauna, 4-person-saunas
5-person-traditional-sauna, 5-person-saunas
6-person-traditional-sauna, 6-person-saunas
8-person-traditional-sauna, 8-person-saunas
2-person-hybrid-sauna, hybrid-saunas
3-person-hybrid-sauna, hybrid-saunas
4-person-hybrid-sauna, hybrid-saunas
outdoor-traditional-saunas, traditional-saunas
indoor-traditional-saunas, traditional-saunas
indoor-infrared-saunas, infrared-saunas
outdoor-infrared-saunas, infrared-saunas
dry-saunas, traditional-saunas
sauna-wood, sauna-kits
sauna-doors-glass, sauna-doors
ultra-low-emf-saunas, low-emf-saunas
near-zero-emf-saunas, low-emf-saunas
sauna-heater-accessories, sauna-heater-parts`;

type Item = {
  blogHandle: string;
  articleId: number;
  title: string;
  handle: string;
  published: boolean;
  replacements: number;
  byHandle: Record<string, number>;
};

type Processed = { handle: string; title: string; replacements: number; ok: boolean; error?: string; dbSynced: boolean };

function parseMap(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [a, b] = line.split(/\s*[,\t>]+\s*|\s+->\s+/).map((s) => (s || "").trim());
    if (a && b) map[a] = b;
  }
  return map;
}

export default function CollectionHrefRewritePage() {
  const [text, setText] = useState(DEFAULT_PAIRS);
  const [busy, setBusy] = useState<"dry" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<number | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [log, setLog] = useState<Processed[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  const map = useMemo(() => parseMap(text), [text]);

  async function dryRun() {
    setBusy("dry");
    setError(null);
    setLog([]);
    try {
      const res = await fetch("/api/maintenance/rewrite-collection-hrefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dry", map }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Scan failed (${res.status})`);
      setScanned(data.scanned);
      setItems(data.items || []);
      setTotals(data.totalsByHandle || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyAll() {
    if (items.length === 0) return;
    const total = items.reduce((s, i) => s + i.replacements, 0);
    if (!window.confirm(`Rewrite ${total} link(s) across ${items.length} article(s) on the live blog? Anchor text and prose are not changed.`)) return;
    setBusy("apply");
    setError(null);
    setLog([]);
    let handles = items.map((i) => i.handle);
    let done = 0;
    try {
      while (handles.length > 0) {
        setProgress(`Applying… ${done} of ${items.length} articles`);
        const res = await fetch("/api/maintenance/rewrite-collection-hrefs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "apply", map, handles, batchSize: 10 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Apply failed (${res.status})`);
        const processed: Processed[] = data.processed || [];
        setLog((prev) => [...prev, ...processed]);
        done += processed.length;
        handles = data.remaining || [];
        if (processed.length === 0) break;
      }
      setProgress(`Done: ${done} article(s) processed`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setBusy(null);
    }
  }

  const totalLinks = items.reduce((s, i) => s + i.replacements, 0);

  return (
    <div className="mx-auto max-w-6xl p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Collection Link Rewrite — Retired URLs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One pair per line: <code>old-handle, new-handle</code>. Dry run scans every blog article and lists the links that point at
          a retired collection. Apply changes the <code>href</code> only, so anchor text and prose stay exactly as they are, and
          keeps the Content Studio copy in sync. Nothing is written until you Apply.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <textarea
          className="min-h-[300px] w-full rounded-md border p-3 font-mono text-sm"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setItems([]);
            setScanned(null);
          }}
          spellCheck={false}
        />
        <div className="space-y-3">
          <div className="rounded-md border p-3 text-sm">
            <div className="text-2xl font-bold">{Object.keys(map).length}</div>
            <div className="text-xs text-muted-foreground">pairs in the list</div>
          </div>
          <button
            onClick={dryRun}
            disabled={busy !== null || Object.keys(map).length === 0}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "dry" ? "Scanning…" : "Dry run"}
          </button>
          <button
            onClick={applyAll}
            disabled={busy !== null || items.length === 0}
            className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy === "apply" ? "Applying…" : items.length ? `Apply to ${items.length} article(s)` : "Apply"}
          </button>
          <p className="text-xs text-muted-foreground">Apply is enabled only after a dry run of the current list.</p>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {progress && <div className="rounded-md border p-3 text-sm">{progress}</div>}

      {scanned !== null && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["articles scanned", scanned],
              ["articles affected", items.length],
              ["links to rewrite", totalLinks],
              ["retired handles hit", Object.keys(totals).length],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border p-3">
                <div className="text-2xl font-bold">{String(value)}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>

          {Object.keys(totals).length > 0 && (
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium mb-1">Links per retired handle</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(totals)
                  .sort((a, b) => b[1] - a[1])
                  .map(([h, n]) => (
                    <span key={h} className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs">
                      {h} → {map[h]} <b>{n}</b>
                    </span>
                  ))}
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-2">Article</th>
                  <th className="p-2 text-right">Links</th>
                  <th className="p-2">Retired handles in this article</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const res = log.find((l) => l.handle === it.handle);
                  return (
                    <tr key={it.handle} className="border-t align-top">
                      <td className="p-2">
                        <div className="font-medium">{it.title}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          /blogs/{it.blogHandle}/{it.handle}
                          {!it.published && " · draft"}
                        </div>
                      </td>
                      <td className="p-2 text-right">{it.replacements}</td>
                      <td className="p-2 font-mono text-xs">
                        {Object.entries(it.byHandle).map(([h, n]) => `${h} (${n})`).join(", ")}
                      </td>
                      <td className="p-2">
                        {res ? (
                          <span className={`rounded px-2 py-0.5 text-xs ${res.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                            {res.ok ? `updated${res.dbSynced ? "" : " (Shopify only)"}` : `failed: ${res.error}`}
                          </span>
                        ) : (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">pending</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td className="p-3 text-muted-foreground" colSpan={4}>No article links any of these retired collections.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
