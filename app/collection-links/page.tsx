"use client";

/**
 * /collection-links — audit + bulk-fix in-content collection links.
 *
 * Dry run scans every post and previews exactly which links would be added
 * (wrapping an existing keyword mention where possible, otherwise one short
 * sentence). Apply pushes those links to Shopify in rate-limited batches.
 * No AI, no rewriting — prose is untouched, safe for ranking articles.
 */

import { useMemo, useState } from "react";

type Row = {
  handle: string;
  blogHandle: string;
  title: string;
  tags: string;
  published: boolean;
  category: string | null;
  inContentCount: number;
  inContentLinks: { href: string; text: string }[];
  hasBottomCta: boolean;
  finnmarkLinks: string[];
  proposed: { handle: string; anchor: string; method: string }[];
};

type Summary = {
  zeroInContent: number;
  oneInContent: number;
  compliant: number;
  missingBottomCta: number;
  withFinnmark: number;
  noCategory: number;
  fixable: number;
};

type Processed = { handle: string; title: string; added: string[]; ok: boolean; error?: string };

type Filter = "fixable" | "zero" | "one" | "compliant" | "noCategory" | "finnmark" | "all";

export default function CollectionLinksPage() {
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [scanned, setScanned] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Filter>("fixable");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [doneHandles, setDoneHandles] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<Processed[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/maintenance/collection-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dry" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Scan failed (${res.status})`);
      setScanned(data.scanned);
      setSummary(data.summary);
      setRows(data.rows || []);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function apply(handles: string[]) {
    const todo = handles.filter((h) => !doneHandles.has(h));
    if (!todo.length) return;
    if (!window.confirm(`Add collection links to ${todo.length} article(s) on Shopify? Prose is not rewritten, only links are added.`)) return;
    setApplying(true);
    setError(null);
    let remaining = todo;
    try {
      while (remaining.length > 0) {
        const res = await fetch("/api/maintenance/collection-links", {
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

  const filtered = useMemo(() => {
    let out = rows.filter((r) => r.published);
    if (filter === "fixable") out = out.filter((r) => r.proposed.length > 0);
    else if (filter === "zero") out = out.filter((r) => r.inContentCount === 0);
    else if (filter === "one") out = out.filter((r) => r.inContentCount === 1);
    else if (filter === "compliant") out = out.filter((r) => r.inContentCount >= 2);
    else if (filter === "noCategory") out = out.filter((r) => r.inContentCount < 2 && !r.category);
    else if (filter === "finnmark") out = out.filter((r) => r.finnmarkLinks.length > 0);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      out = out.filter((r) => r.title.toLowerCase().includes(s) || r.tags.toLowerCase().includes(s));
    }
    return [...out].sort((a, b) => a.inContentCount - b.inContentCount);
  }, [rows, filter, search]);

  const fixableSelected = [...selected].filter((h) => !doneHandles.has(h));
  const allFixable = rows.filter((r) => r.published && r.proposed.length > 0 && !doneHandles.has(r.handle));
  const busy = scanning || applying;

  function toggle(h: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next;
    });
  }

  function exportCsv() {
    const esc = (s: string) => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = [["handle", "title", "tags", "in_content", "proposed_links", "bottom_cta", "url"].join(",")];
    for (const r of filtered) {
      lines.push([
        esc(r.handle), esc(r.title), esc(r.tags), String(r.inContentCount),
        esc(r.proposed.map((p) => `${p.handle} (${p.method})`).join(" | ")),
        r.hasBottomCta ? "yes" : "NO",
        esc(`https://peakprimalwellness.com/blogs/${r.blogHandle}/${r.handle}`),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `collection-links-${filter}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const filterBtn = (f: Filter, label: string) => (
    <button
      key={f}
      onClick={() => setFilter(f)}
      className={`rounded-md border px-3 py-1.5 text-sm ${filter === f ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Collection Links — Audit &amp; Bulk Fix</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dry run previews exactly which links get added per post (wrap an existing mention when
          possible, otherwise one short sentence). Apply adds them on Shopify — no AI, no rewriting.
          Drafts are excluded automatically.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={scan}
          disabled={busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {scanning ? "Scanning all articles..." : "1. Dry Run (no changes)"}
        </button>
        <button
          onClick={() => apply(fixableSelected)}
          disabled={busy || fixableSelected.length === 0}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {applying ? "Applying..." : `2. Apply Selected (${fixableSelected.length})`}
        </button>
        <button
          onClick={() => apply(allFixable.map((r) => r.handle))}
          disabled={busy || allFixable.length === 0}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          3. Apply All Fixable ({allFixable.length})
        </button>
        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Export CSV ({filtered.length})
        </button>
      </div>

      {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          {[
            ["Scanned", scanned],
            ["0 links", summary.zeroInContent],
            ["1 link", summary.oneInContent],
            ["Compliant", summary.compliant],
            ["Fixable now", summary.fixable],
            ["No category", summary.noCategory],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-md border p-3">
              <div className="text-2xl font-bold">{String(value)}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      )}

      {summary && summary.withFinnmark > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {summary.withFinnmark} post(s) link to Finnmark — out of stock but returning; leave these as they are.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {filterBtn("fixable", "Fixable")}
            {filterBtn("zero", "0 links")}
            {filterBtn("one", "1 link")}
            {filterBtn("compliant", "Compliant")}
            {filterBtn("noCategory", "No category match")}
            {filterBtn("finnmark", "Finnmark")}
            {filterBtn("all", "All published")}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by tag or title..."
              className="ml-auto w-64 rounded-md border px-3 py-1.5 text-sm"
            />
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="p-2">Article</th>
                  <th className="p-2 text-right">Links</th>
                  <th className="p-2">Proposed additions</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((r) => (
                  <tr key={r.handle} className="border-t align-top">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selected.has(r.handle)}
                        onChange={() => toggle(r.handle)}
                        disabled={r.proposed.length === 0 || doneHandles.has(r.handle)}
                      />
                    </td>
                    <td className="p-2 max-w-sm">
                      <a
                        href={`https://peakprimalwellness.com/blogs/${r.blogHandle}/${r.handle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {r.title}
                      </a>
                      <div className="text-xs text-muted-foreground">{r.category || "no category match"}</div>
                    </td>
                    <td className={`p-2 text-right font-medium ${r.inContentCount === 0 ? "text-red-700" : r.inContentCount === 1 ? "text-amber-700" : "text-green-700"}`}>
                      {r.inContentCount}
                    </td>
                    <td className="p-2 text-xs font-mono">
                      {r.proposed.map((p) => `/collections/${p.handle} (${p.method})`).join(", ")}
                    </td>
                    <td className="p-2">
                      {doneHandles.has(r.handle) ? (
                        <span className="font-medium text-green-700">Fixed</span>
                      ) : r.finnmarkLinks.length > 0 ? (
                        <span className="font-medium text-red-700">Finnmark</span>
                      ) : (
                        ""
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 300 && (
              <p className="p-2 text-xs text-muted-foreground">Showing first 300 of {filtered.length}. Use CSV export for all.</p>
            )}
          </div>
        </>
      )}

      {log.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Apply log</h2>
          <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border bg-gray-50 p-3 font-mono text-xs">
            {log.map((p, i) => (
              <div key={i} className={p.ok ? "text-green-800" : "text-red-700"}>
                {p.ok ? `OK  ${p.handle} — ${p.added.join(", ") || "no change needed"}` : `ERR ${p.handle} — ${p.error}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
