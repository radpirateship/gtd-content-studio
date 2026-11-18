"use client";

/**
 * /bullet-audit — product-card bullet inventory and bulk cleanup.
 *
 * Workflow:
 *   1. Dry Run — scans every article, builds the full bullet-frequency table,
 *      lists which articles would change. Zero writes.
 *   2. Review the frequency table (and export CSV) to spot any other bullet
 *      that overpromises. Flagged rows are the ones queued for deletion.
 *   3. Apply — batched writes to Shopify, article by article.
 *
 * Removal list lives in lib/product-bullets.ts (REMOVE_BULLETS). Cards that
 * would drop below 2 bullets are skipped and surfaced under "Needs a manual
 * look" rather than being silently stubbed.
 */

import { useMemo, useState } from "react";

type BulletStat = {
  label: string;
  count: number;
  articles: number;
  firstSlot: number;
  products: number;
  flagged: boolean;
  review: string[];
};

type ProseHit = { phrase: string; context: string };

type Item = {
  blogHandle: string;
  articleId: number;
  title: string;
  handle: string;
  cardCount: number;
  cardsTouched: number;
  removed: number;
  replaced: number;
  proseFixed: number;
  removedLabels: string[];
  skippedCards: string[];
  proseHits: ProseHit[];
};

type ScanResult = {
  scanned: number;
  articlesWithCards: number;
  totalCards: number;
  uniqueProducts: number;
  uniqueBullets: number;
  affectedCount: number;
  totalRemovals: number;
  totalProseFixes: number;
  bulletStats: BulletStat[];
  items: Item[];
};

type Processed = {
  handle: string;
  title: string;
  removed: number;
  proseFixed: number;
  ok: boolean;
  error?: string;
};

export default function BulletAuditPage() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [log, setLog] = useState<Processed[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [doneHandles, setDoneHandles] = useState<Set<string>>(new Set());
  const [showAllBullets, setShowAllBullets] = useState(false);

  async function dryRun() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/maintenance/bullet-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dry" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Scan failed (${res.status})`);
      setResult(data);
      setSelected(new Set());
      setLog([]);
      setDoneHandles(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function apply(handles: string[]) {
    if (!handles.length) return;
    if (
      !window.confirm(
        `Update ${handles.length} article(s) on Shopify? This writes to the live store.`
      )
    )
      return;
    setApplying(true);
    setError(null);
    let remaining = handles;
    try {
      while (remaining.length > 0) {
        const res = await fetch("/api/maintenance/bullet-audit", {
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

  function exportCsv() {
    if (!result) return;
    const rows = [
      [
        "bullet",
        "total_uses",
        "articles",
        "unique_products",
        "times_in_first_slot",
        "queued_for_removal",
        "needs_review",
      ],
      ...result.bulletStats.map((b) => [
        b.label,
        b.count,
        b.articles,
        b.products,
        b.firstSlot,
        b.flagged ? "yes" : "",
        (b.review || []).join("; "),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ppw-product-card-bullets.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggle(handle: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  const writableItems = useMemo(
    () => (result?.items || []).filter((i) => i.removed + i.replaced + i.proseFixed > 0),
    [result]
  );
  const pendingItems = writableItems.filter((i) => !doneHandles.has(i.handle));
  const reviewItems = useMemo(
    () => (result?.items || []).filter((i) => i.skippedCards.length > 0 || i.proseHits.length > 0),
    [result]
  );
  const visibleBullets = useMemo(() => {
    const all = result?.bulletStats || [];
    return showAllBullets ? all : all.slice(0, 40);
  }, [result, showAllBullets]);

  const busy = scanning || applying;

  return (
    <div className="mx-auto max-w-6xl p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Product Card Bullet Audit</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Inventories every feature bullet inside <code>.ppw-product-card</code> blocks across all
          articles, then bulk-removes the unsupported claims. White-glove delivery and blanket free
          shipping are queued for deletion; cards drop to 3 bullets rather than getting a substitute
          claim. Dry run first, spot-check a few articles, then apply.
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
          onClick={exportCsv}
          disabled={!result}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Export bullet list (CSV)
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

      {result && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Articles scanned", result.scanned],
            ["With product cards", result.articlesWithCards],
            ["Product cards", result.totalCards],
            ["Unique products", result.uniqueProducts],
            ["Distinct bullets", result.uniqueBullets],
            ["Articles to change", result.affectedCount],
            ["Bullets to remove", result.totalRemovals],
            ["Prose lines to fix", result.totalProseFixes],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}

      {result && result.bulletStats.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Most common bullets</h2>
            <button
              onClick={() => setShowAllBullets((v) => !v)}
              className="text-sm text-blue-600 hover:underline"
            >
              {showAllBullets ? "Show top 40" : `Show all ${result.bulletStats.length}`}
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            Sorted by how many product cards use each bullet. A bullet appearing on hundreds of cards
            across dozens of unrelated products is filler, not a feature. Red rows are queued for
            deletion.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-2">Bullet</th>
                  <th className="p-2 text-right">Cards</th>
                  <th className="p-2 text-right">Articles</th>
                  <th className="p-2 text-right">Products</th>
                  <th className="p-2 text-right">In slot 1</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleBullets.map((b) => (
                  <tr key={b.label} className={`border-t ${b.flagged ? "bg-red-50" : ""}`}>
                    <td className="p-2">{b.label}</td>
                    <td className="p-2 text-right font-medium">{b.count}</td>
                    <td className="p-2 text-right">{b.articles}</td>
                    <td className="p-2 text-right">{b.products}</td>
                    <td className="p-2 text-right">{b.firstSlot || ""}</td>
                    <td className="p-2">
                      {b.flagged ? (
                        <span className="font-medium text-red-700">Removing</span>
                      ) : b.review && b.review.length > 0 ? (
                        <span className="text-purple-700">Verify: {b.review.join("; ")}</span>
                      ) : b.products > 20 ? (
                        <span className="text-amber-700">Generic filler</span>
                      ) : (
                        ""
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {writableItems.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Articles that will change ({writableItems.length})</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="p-2">Article</th>
                  <th className="p-2">Handle</th>
                  <th className="p-2 text-right">Cards</th>
                  <th className="p-2 text-right">Bullets removed</th>
                  <th className="p-2 text-right">Prose fixes</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {writableItems.map((item) => (
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
                    <td className="p-2 text-right">{item.cardCount}</td>
                    <td className="p-2 text-right">{item.removed}</td>
                    <td className="p-2 text-right">{item.proseFixed || ""}</td>
                    <td className="p-2">
                      {doneHandles.has(item.handle) ? (
                        <span className="font-medium text-green-700">Fixed</span>
                      ) : (
                        ""
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reviewItems.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Needs a manual look ({reviewItems.length})</h2>
          <p className="text-sm text-muted-foreground">
            Cards that would fall below 2 bullets are left alone rather than stubbed. Prose mentions
            of white glove or free shipping sit in body copy, so they are reported, never auto-edited.
          </p>
          <div className="space-y-2">
            {reviewItems.map((item) => (
              <div key={item.handle} className="rounded-md border p-3 text-sm">
                <a
                  href={`https://peakprimalwellness.com/blogs/${item.blogHandle}/${item.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-600 hover:underline"
                >
                  {item.title}
                </a>
                {item.skippedCards.length > 0 && (
                  <div className="mt-1 text-amber-800">
                    Cards left alone: {item.skippedCards.join(", ")}
                  </div>
                )}
                {item.proseHits.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-gray-700">
                    {item.proseHits.slice(0, 5).map((h, i) => (
                      <li key={i}>
                        <span className="font-medium">{h.phrase}</span>: &ldquo;...{h.context}...&rdquo;
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Apply log</h2>
          <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border bg-gray-50 p-3 font-mono text-xs">
            {log.map((p, i) => (
              <div key={i} className={p.ok ? "text-green-800" : "text-red-700"}>
                {p.ok
                  ? `OK  ${p.handle} — ${p.removed} bullet(s) removed, ${p.proseFixed} prose fix(es)`
                  : `ERR ${p.handle} — ${p.error}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
