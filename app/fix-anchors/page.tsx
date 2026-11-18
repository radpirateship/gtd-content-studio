"use client";

/**
 * /fix-anchors — one-time maintenance UI for the H2 anchor ID bulk fix.
 *
 * Workflow (per ClickUp 868k2jkz2):
 *   1. Dry Run — scans every article, lists proposed changes, zero writes.
 *   2. Apply to the 3 test articles first, verify TOC links in the browser.
 *   3. Apply All for the rest.
 */

import { useState } from "react";

type Item = {
  blogHandle: string;
  articleId: number;
  title: string;
  handle: string;
  replacements: number;
  brokenLinks: number;
  mapping: Record<string, string>;
};

type Processed = {
  handle: string;
  title: string;
  replacements: number;
  ok: boolean;
  error?: string;
};

const TEST_HANDLES = [
  "best-neck-massagers",
  "free-sauna-layout-designs",
  "stair-climber-workout-plan-from-beginner-to-advanced",
];

export default function FixAnchorsPage() {
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<number | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [log, setLog] = useState<Processed[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [doneHandles, setDoneHandles] = useState<Set<string>>(new Set());

  async function dryRun() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/maintenance/fix-anchors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dry" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Scan failed (${res.status})`);
      setScanned(data.scanned);
      setItems(data.items || []);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function apply(handles: string[]) {
    if (!handles.length) return;
    if (!window.confirm(`Update ${handles.length} article(s) on Shopify? This writes to the live store.`)) return;
    setApplying(true);
    setError(null);
    let remaining = handles;
    try {
      while (remaining.length > 0) {
        const res = await fetch("/api/maintenance/fix-anchors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "apply", handles: remaining, batchSize: 10 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Apply failed (${res.status})`);
        const processed: Processed[] = data.processed || [];
        setLog((prev) => [...prev, ...processed]);
        setDoneHandles((prev) => {
          const next = new Set(prev);
          for (const p of processed) if (p.ok) next.add(p.handle);
          return next;
        });
        remaining = data.remaining || [];
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  function toggle(handle: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  function selectTestThree() {
    setSelected(new Set(items.filter((i) => TEST_HANDLES.includes(i.handle)).map((i) => i.handle)));
  }

  const pendingItems = items.filter((i) => !doneHandles.has(i.handle));
  const busy = scanning || applying;

  return (
    <div className="mx-auto max-w-5xl p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">H2 Anchor ID Bulk Fix</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Replaces legacy descriptive H2 anchors (id=&quot;1-product-name&quot; and id=&quot;heading-slug&quot;) with sequential
          section-N IDs and updates TOC links in the same pass. Dry run first, then apply
          to the 3 test articles, verify in the browser, then apply all.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={dryRun}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {scanning ? "Scanning all articles..." : "1. Dry Run (no changes)"}
        </button>
        <button
          onClick={selectTestThree}
          disabled={busy || items.length === 0}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Select the 3 test articles
        </button>
        <button
          onClick={() => apply([...selected].filter((h) => !doneHandles.has(h)))}
          disabled={busy || selected.size === 0}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {applying ? "Applying..." : `2. Apply Selected (${selected.size})`}
        </button>
        <button
          onClick={() => apply(pendingItems.map((i) => i.handle))}
          disabled={busy || pendingItems.length === 0}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          3. Apply All Remaining ({pendingItems.length})
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {scanned !== null && (
        <p className="text-sm">
          Scanned <strong>{scanned}</strong> articles — <strong>{items.length}</strong> need fixing
          ({items.reduce((s, i) => s + i.replacements, 0)} total ID/link replacements).
        </p>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-2 w-8"></th>
                <th className="p-2">Article</th>
                <th className="p-2">Handle</th>
                <th className="p-2 text-right">Replacements</th>
                <th className="p-2 text-right">Broken TOC links</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.handle} className="border-t">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(item.handle)}
                      onChange={() => toggle(item.handle)}
                      disabled={doneHandles.has(item.handle)}
                    />
                  </td>
                  <td className="p-2">{item.title}</td>
                  <td className="p-2">
                    <a
                      href={`https://peakprimalwellness.com/blogs/${item.blogHandle}/${item.handle}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {item.handle}
                    </a>
                  </td>
                  <td className="p-2 text-right">{item.replacements}</td>
                  <td className="p-2 text-right">{item.brokenLinks || ""}</td>
                  <td className="p-2">
                    {doneHandles.has(item.handle) ? (
                      <span className="text-green-700 font-medium">Fixed</span>
                    ) : TEST_HANDLES.includes(item.handle) ? (
                      <span className="text-amber-700">Test article</span>
                    ) : (
                      ""
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {log.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Apply log</h2>
          <div className="rounded-md border bg-gray-50 p-3 font-mono text-xs space-y-0.5 max-h-64 overflow-y-auto">
            {log.map((p, i) => (
              <div key={i} className={p.ok ? "text-green-800" : "text-red-700"}>
                {p.ok
                  ? `OK  ${p.handle} — ${p.replacements} replaced`
                  : `ERR ${p.handle} — ${p.error}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
