"use client";

/**
 * /post-grader — READ-ONLY core-element grader for all posts.
 * Grades structure and required elements without rewriting anything.
 * Failures map to targeted fixes; full revamp is the escalation path,
 * not the default.
 */

import { useMemo, useState } from "react";

type Row = {
  handle: string;
  blogHandle: string;
  title: string;
  tags: string;
  published: boolean;
  score: number;
  wordCount: number;
  failures: string[];
  failureDetails: Record<string, string>;
};

const CHECK_LABELS: Record<string, string> = {
  "em-dashes": "Em dashes",
  "brand-voice": "Off brand voice",
  anchors: "Legacy anchors",
  "collection-links": "No collection links",
  "bottom-cta": "No bottom CTA",
  "faq-present": "No FAQ",
  "faq-clean": "FAQ swallowed table",
  "faq-position": "FAQ in related",
  "faq-structure": "FAQ malformed",
  "tag-balance": "Unbalanced tags",
  "key-takeaways": "No key takeaways",
  "toc-nav": "No TOC nav",
  overview: "No overview",
  "featured-products": "No products block",
  "faq-schema": "No FAQ schema",
  images: "No images",
  "word-count": "Thin content",
  "structure-order": "Sections out of order",
  "no-duplicates": "Duplicated sections",
  "single-h1": "H1 count wrong",
  "unique-ids": "Duplicate IDs",
  "toc-resolves": "Dead TOC links",
  "no-artifacts": "Generation artifacts",
};

export default function PostGraderPage() {
  const [scanning, setScanning] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [failCounts, setFailCounts] = useState<Record<string, number>>({});
  const [publishedCount, setPublishedCount] = useState(0);
  const [backlogSynced, setBacklogSynced] = useState<number | null>(null);
  const [scanned, setScanned] = useState(0);
  const [checkFilter, setCheckFilter] = useState<string | null>(null);
  const [publishedOnly, setPublishedOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/maintenance/post-grader", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Scan failed (${res.status})`);
      setRows(data.rows || []);
      setFailCounts(data.failCounts || {});
      setPublishedCount(data.publishedCount || 0);
      setBacklogSynced(data.backlogSynced ?? null);
      setScanned(data.scanned || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  const filtered = useMemo(() => {
    let out = rows;
    if (publishedOnly) out = out.filter((r) => r.published);
    if (checkFilter) out = out.filter((r) => r.failures.includes(checkFilter));
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      out = out.filter((r) => r.title.toLowerCase().includes(s) || r.tags.toLowerCase().includes(s) || r.handle.includes(s));
    }
    return [...out].sort((a, b) => a.score - b.score);
  }, [rows, checkFilter, publishedOnly, search]);

  function exportCsv() {
    const esc = (s: string) => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = [
      ["handle", "title", "tags", "published", "score", "word_count", "failures", "details", "url"].join(","),
    ];
    for (const r of filtered) {
      lines.push([
        esc(r.handle),
        esc(r.title),
        esc(r.tags),
        r.published ? "yes" : "DRAFT",
        String(r.score),
        String(r.wordCount),
        esc(r.failures.map((f) => CHECK_LABELS[f] || f).join(" | ")),
        esc(Object.entries(r.failureDetails).map(([k, v]) => `${k}: ${v}`).join(" | ")),
        esc(`https://greenthumbdepot.com/blogs/${r.blogHandle}/${r.handle}`),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `post-grades${checkFilter ? "-" + checkFilter : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const scoreColor = (s: number) => (s >= 90 ? "text-green-700" : s >= 70 ? "text-amber-700" : "text-red-700");

  return (
    <div className="mx-auto max-w-6xl p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Post Grader</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Read-only grade of every post against the GTD core-element checklist. Nothing is
          rewritten. Use the failure chips to build fix queues; full revamp is only for posts
          that fail on substance.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={scan}
          disabled={scanning}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {scanning ? "Grading all articles..." : "Grade All Posts (read-only)"}
        </button>
        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Export CSV ({filtered.length})
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={publishedOnly} onChange={(e) => setPublishedOnly(e.target.checked)} />
          Published only
        </label>
      </div>

      {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {scanned > 0 && (
        <p className="text-sm">
          Graded <strong>{scanned}</strong> articles ({publishedCount} published, {scanned - publishedCount} drafts).
          {backlogSynced !== null && (
            <>
              {" "}Scores synced to revamp backlog: <strong>{backlogSynced}</strong> of {publishedCount} published
              {backlogSynced < publishedCount && (
                <span className="text-amber-700"> — run Import from Shopify in the revamp backlog, then re-grade to sync the rest.</span>
              )}.
            </>
          )}
          {" "}Click a failure count to filter.
        </p>
      )}

      {Object.keys(failCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCheckFilter(null)}
            className={`rounded-md border px-3 py-1.5 text-sm ${!checkFilter ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}
          >
            All posts
          </button>
          {Object.entries(failCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([id, count]) => (
              <button
                key={id}
                onClick={() => setCheckFilter(checkFilter === id ? null : id)}
                className={`rounded-md border px-3 py-1.5 text-sm ${checkFilter === id ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}
              >
                {CHECK_LABELS[id] || id}: {count}
              </button>
            ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by title, tag, or handle..."
            className="w-72 rounded-md border px-3 py-1.5 text-sm"
          />
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-2 text-right">Score</th>
                  <th className="p-2">Article</th>
                  <th className="p-2">Failing checks</th>
                  <th className="p-2 text-right">Words</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((r) => (
                  <tr key={r.handle} className="border-t align-top">
                    <td className={`p-2 text-right font-bold ${scoreColor(r.score)}`}>{r.score}</td>
                    <td className="p-2 max-w-sm">
                      <a
                        href={`https://greenthumbdepot.com/blogs/${r.blogHandle}/${r.handle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {r.title}
                      </a>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {r.failures.map((f) => (
                          <span
                            key={f}
                            title={r.failureDetails[f] || ""}
                            className={`rounded px-1.5 py-0.5 text-xs ${f === "no-finnmark" || f.startsWith("faq-") || f === "tag-balance" || f === "structure-order" || f === "no-duplicates" || f === "no-artifacts" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
                          >
                            {CHECK_LABELS[f] || f}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-2 text-right">{r.wordCount}</td>
                    <td className="p-2">{r.published ? "" : <span className="text-xs text-muted-foreground">draft</span>}</td>
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
    </div>
  );
}
