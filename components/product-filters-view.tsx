"use client";

/**
 * Product Filters workspace — bulk metafield derivation + preview + gated
 * apply. Rendered as a top-level app mode (Articles / Collections / Product
 * Filters) and also available standalone at /product-filters.
 *
 * Workflow (mirrors /bullet-audit's dry-run-first pattern):
 *   1. Definitions — check/create the metafield definitions (with Search &
 *      Discovery storefront visibility) BEFORE any values exist.
 *   2. Scan (dry run) — pulls live products, derives facet values, diffs
 *      against current metafields. Zero writes.
 *   3. Review — flagged rows start EXCLUDED and need a human decision;
 *      every cell is editable. Blank = never written, never deleted.
 *   4. Apply — type APPLY to enable. Server re-diffs at write time and only
 *      writes real deltas, so re-running is always safe.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FILTER_CATEGORIES, type FacetDef } from "@/lib/metafields/config";

type Confidence = "high" | "medium" | "low" | "none";

type ScanRow = {
  productId: string;
  legacyId: string;
  handle: string;
  title: string;
  vendor: string;
  tags: string[];
  facets: Record<string, { value: string[] | string | null; confidence: Confidence }>;
  flags: string[];
  deltas: Array<{
    facetKey: string;
    metafieldKey: string;
    current: string | null;
    proposed: string | null;
    change: "set" | "update" | "unchanged" | "skip";
  }>;
  changeCount: number;
};

type DefinitionStatus = {
  key: string;
  name: string;
  exists: boolean;
  typeOk: boolean;
  actualType?: string;
  storefrontVisible: boolean;
};

type ScanResult = {
  category: string;
  summary: { products: number; flagged: number; totalChanges: number; definitionsReady: boolean };
  definitions: DefinitionStatus[];
  rows: ScanRow[];
};

type ApplyResult = {
  written: number;
  attempted?: number;
  productsTouched?: number;
  unchanged: number;
  skippedUnknown: number;
  errors?: string[];
  warning?: string;
  message?: string;
};

const CONF_STYLE: Record<Confidence, string> = {
  high: "text-emerald-700",
  medium: "text-amber-600",
  low: "text-red-600 font-medium",
  none: "text-neutral-400",
};

function facetDisplay(v: string[] | string | null): string {
  if (v == null) return "";
  return Array.isArray(v) ? v.join(",") : v;
}

export function ProductFiltersView() {
  const [categoryKey, setCategoryKey] = useState(FILTER_CATEGORIES[0]?.key ?? "saunas");
  const category = FILTER_CATEGORIES.find((c) => c.key === categoryKey)!;

  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [defs, setDefs] = useState<DefinitionStatus[] | null>(null);
  const [defsBusy, setDefsBusy] = useState(false);
  const [defsArmed, setDefsArmed] = useState(false);

  // Per-row: included in apply? Per-cell edits (display strings).
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [view, setView] = useState<"all" | "flagged" | "changes">("all");
  const [search, setSearch] = useState("");

  const [confirmText, setConfirmText] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  // AI-assisted suggestions for flagged rows (server never writes from these;
  // they land in the editable cells and still need check-in + APPLY).
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [aiNotes, setAiNotes] = useState<
    Record<string, Record<string, { value: string | null; reasoning: string }>>
  >({});

  const definitionsReady = (defs ?? scan?.definitions ?? []).length > 0 &&
    (defs ?? scan!.definitions).every((d) => d.exists && d.typeOk && d.storefrontVisible);

  async function checkDefinitions() {
    setDefsBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/metafields/definitions?category=${categoryKey}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || json.error || "Definition check failed");
      setDefs(json.definitions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDefsBusy(false);
    }
  }

  async function createDefinitions() {
    setDefsBusy(true);
    setDefsArmed(false);
    setError(null);
    try {
      const res = await fetch("/api/metafields/definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: categoryKey }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || json.error || "Definition create failed");
      setDefs(json.definitions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDefsBusy(false);
    }
  }

  async function runScan() {
    setScanning(true);
    setError(null);
    setApplyResult(null);
    try {
      const res = await fetch(`/api/metafields/scan?category=${categoryKey}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || json.error || "Scan failed");
      const result = json as ScanResult;
      setScan(result);
      setDefs(result.definitions);
      // Flagged rows start excluded: they need a human decision first.
      const inc: Record<string, boolean> = {};
      for (const r of result.rows) inc[r.productId] = r.flags.length === 0;
      setIncluded(inc);
      setEdits({});
      setConfirmText("");
      setAiNotes({});
      setSuggestNote(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function runSuggest() {
    if (!scan) return;
    // Suggest for the facets derivation couldn't settle (low/none confidence)
    // on the target rows. Manual edits and confident values are untouched.
    const items = suggestTargets
      .map((r) => ({
        productId: r.productId,
        facetKeys: category.facets
          .filter((f) => {
            const conf = r.facets[f.key]?.confidence ?? "none";
            return conf === "low" || conf === "none";
          })
          .map((f) => f.key),
      }))
      .filter((i) => i.facetKeys.length > 0);
    if (!items.length) return;

    setSuggesting(true);
    setError(null);
    setSuggestNote(`Asking AI about ${items.length} flagged product(s)…`);
    try {
      const res = await fetch("/api/metafields/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: categoryKey, items }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || json.error || "Suggest failed");

      let filled = 0;
      let noEvidence = 0;
      const notes: typeof aiNotes = {};
      const nextEdits = { ...edits };
      for (const r of json.results as Array<{
        productId: string;
        suggestions: Record<string, { value: string | string[] | null; reasoning: string }> | null;
      }>) {
        if (!r.suggestions) continue;
        const row = scan.rows.find((x) => x.productId === r.productId);
        if (!row) continue;
        for (const [fk, s] of Object.entries(r.suggestions)) {
          const display = s.value == null ? null : Array.isArray(s.value) ? s.value.join(",") : s.value;
          notes[r.productId] = {
            ...(notes[r.productId] || {}),
            [fk]: { value: display, reasoning: s.reasoning },
          };
          if (display == null) {
            noEvidence++;
            continue;
          }
          // Only fill cells that are currently blank — never overwrite a
          // manual edit or a derived value.
          const existingEdit = nextEdits[r.productId]?.[fk];
          const derived = facetDisplay(row.facets[fk]?.value ?? null);
          const current = existingEdit !== undefined ? existingEdit : derived;
          if (current.trim() === "") {
            nextEdits[r.productId] = { ...(nextEdits[r.productId] || {}), [fk]: display };
            filled++;
          }
        }
      }
      setEdits(nextEdits);
      setAiNotes((prev) => ({ ...prev, ...notes }));
      setSuggestNote(
        `AI filled ${filled} blank cell(s); ${noEvidence} came back "no evidence" (left blank). ` +
          `Review the purple notes, then check rows in before applying.` +
          (json.errors?.length ? ` ${json.errors.length} batch(es) failed — run again to retry the rest.` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSuggestNote(null);
    } finally {
      setSuggesting(false);
    }
  }

  function cellValue(row: ScanRow, f: FacetDef): string {
    const edit = edits[row.productId]?.[f.key];
    if (edit !== undefined) return edit;
    return facetDisplay(row.facets[f.key]?.value ?? null);
  }

  function setCell(productId: string, facetKey: string, v: string) {
    setEdits((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), [facetKey]: v },
    }));
  }

  const visibleRows = useMemo(() => {
    if (!scan) return [];
    let rows = scan.rows;
    if (view === "flagged") rows = rows.filter((r) => r.flags.length > 0);
    if (view === "changes") rows = rows.filter((r) => r.changeCount > 0);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.vendor.toLowerCase().includes(q) ||
          r.handle.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [scan, view, search]);

  // AI-suggest targets: the flagged rows you've CHECKED, or every flagged row
  // if none are checked. Lets "select all on the Flagged view → run AI" scope
  // the run, and skipping low-priority vendors is just leaving them unchecked.
  const suggestTargets = useMemo(() => {
    if (!scan) return [];
    const flagged = scan.rows.filter((r) => r.flags.length > 0);
    const checked = flagged.filter((r) => included[r.productId]);
    return checked.length ? checked : flagged;
  }, [scan, included]);

  const includedCount = useMemo(
    () => (scan ? scan.rows.filter((r) => included[r.productId]).length : 0),
    [scan, included]
  );

  function buildApplyRows() {
    if (!scan) return [];
    const rows: Array<{ productId: string; values: Record<string, string | string[]> }> = [];
    for (const r of scan.rows) {
      if (!included[r.productId]) continue;
      const values: Record<string, string | string[]> = {};
      for (const f of category.facets) {
        const display = cellValue(r, f).trim();
        if (!display) continue; // blank = skip, never delete
        values[f.key] =
          f.type === "list"
            ? display.split(",").map((s) => s.trim()).filter(Boolean)
            : display;
      }
      if (Object.keys(values).length) rows.push({ productId: r.productId, values });
    }
    return rows;
  }

  async function runApply() {
    if (confirmText !== "APPLY" || !scan) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/metafields/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: categoryKey, confirm: "APPLY", rows: buildApplyRows() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || json.error || "Apply failed");
      setApplyResult(json as ApplyResult);
      setConfirmText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  function exportCsv() {
    if (!scan) return;
    const head = [
      "handle", "title", "vendor",
      ...category.facets.flatMap((f) => [f.metafieldKey, `${f.metafieldKey}_confidence`]),
      "included", "flags",
    ];
    const lines = [head.join(",")];
    for (const r of scan.rows) {
      const cells = [
        r.handle,
        `"${r.title.replace(/"/g, '""')}"`,
        r.vendor,
        ...category.facets.flatMap((f) => [
          `"${cellValue(r, f)}"`,
          r.facets[f.key]?.confidence ?? "none",
        ]),
        included[r.productId] ? "yes" : "no",
        `"${r.flags.join(" | ").replace(/"/g, '""')}"`,
      ];
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${categoryKey}-filter-preview.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const activeDefs = defs ?? scan?.definitions ?? null;

  return (
    <div className="mx-auto max-w-[1400px] p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Product Filter Metafields</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Derive capacity, placement, heat type, heater type and wood type from product content,
          preview every change SKU by SKU, then apply only reviewed deltas. This tool never touches
          tags, collections, URLs, redirects or publish state, and blank cells are never written.
        </p>
      </div>

      {/* Category + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="h-9 rounded-md border px-3 text-sm"
          value={categoryKey}
          onChange={(e) => {
            setCategoryKey(e.target.value);
            setScan(null);
            setDefs(null);
            setApplyResult(null);
          }}
        >
          {FILTER_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <Button variant="outline" onClick={checkDefinitions} disabled={defsBusy}>
          {defsBusy ? "Checking…" : "Check definitions"}
        </Button>
        <Button onClick={runScan} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan (dry run — zero writes)"}
        </Button>
        {scan && (
          <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Definitions panel */}
      {activeDefs && (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Metafield definitions (namespace: custom)</h2>
            {!definitionsReady && (
              !defsArmed ? (
                <Button variant="outline" size="sm" onClick={() => setDefsArmed(true)} disabled={defsBusy}>
                  Create missing definitions…
                </Button>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="text-sm text-amber-700">
                    Creates {activeDefs.filter((d) => !d.exists).length} definition(s) in Shopify.
                  </span>
                  <Button size="sm" onClick={createDefinitions} disabled={defsBusy}>Confirm create</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDefsArmed(false)}>Cancel</Button>
                </span>
              )
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
            {activeDefs.map((d) => {
              const ok = d.exists && d.typeOk && d.storefrontVisible;
              return (
                <div key={d.key} className={`rounded border px-2 py-1 ${ok ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
                  <span className="font-mono">{d.key}</span>{" "}
                  {ok
                    ? "✓ ready"
                    : !d.exists
                      ? "missing"
                      : !d.typeOk
                        ? `wrong type: ${d.actualType}`
                        : "not storefront-visible"}
                </div>
              );
            })}
          </div>
          {definitionsReady && (
            <p className="text-xs text-neutral-500">
              All definitions ready. Reminder: after values are applied, filters still need to be
              activated once in the Search &amp; Discovery app (Shopify has no API for that step).
            </p>
          )}
        </div>
      )}

      {/* Scan summary + review table */}
      {scan && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span><strong>{scan.summary.products}</strong> products</span>
            <span><strong>{scan.summary.totalChanges}</strong> metafield deltas</span>
            <span className="text-amber-700"><strong>{scan.summary.flagged}</strong> flagged (start excluded)</span>
            <span><strong>{includedCount}</strong> rows included in apply</span>
            {scan.summary.flagged > 0 && (
              <Button size="sm" variant="secondary" onClick={runSuggest} disabled={suggesting}>
                {suggesting
                  ? "AI reading products…"
                  : `AI-suggest for ${suggestTargets.length} flagged${suggestTargets.length < scan.summary.flagged ? " (checked)" : ""}`}
              </Button>
            )}
            <Input
              className="h-8 w-44 text-xs"
              placeholder="Search title / vendor…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="ml-auto flex gap-1">
              {(["all", "flagged", "changes"] as const).map((v) => (
                <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)}>
                  {v === "all" ? "All" : v === "flagged" ? "Flagged" : "With changes"}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setIncluded((prev) => {
                    const next = { ...prev };
                    for (const r of visibleRows) next[r.productId] = true;
                    return next;
                  })
                }
              >
                Include visible
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setIncluded((prev) => {
                    const next = { ...prev };
                    for (const r of visibleRows) next[r.productId] = false;
                    return next;
                  })
                }
              >
                Exclude visible
              </Button>
            </span>
          </div>

          {suggestNote && (
            <div className="rounded-md border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900">
              {suggestNote}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left">
                <tr>
                  <th className="p-2 w-8">
                    <Checkbox
                      checked={visibleRows.length > 0 && visibleRows.every((r) => included[r.productId])}
                      onCheckedChange={(v) =>
                        setIncluded((prev) => {
                          const next = { ...prev };
                          for (const r of visibleRows) next[r.productId] = v === true;
                          return next;
                        })
                      }
                    />
                  </th>
                  <th className="p-2 min-w-[260px]">Product</th>
                  {category.facets.map((f) => (
                    <th key={f.key} className="p-2 min-w-[130px]" title={f.description}>{f.name}</th>
                  ))}
                  <th className="p-2 min-w-[240px]">Flags</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.productId} className={`border-t align-top ${r.flags.length ? "bg-amber-50/60" : ""}`}>
                    <td className="p-2">
                      <Checkbox
                        checked={!!included[r.productId]}
                        onCheckedChange={(v) =>
                          setIncluded((prev) => ({ ...prev, [r.productId]: v === true }))
                        }
                      />
                    </td>
                    <td className="p-2">
                      <div className="font-medium leading-tight">{r.title}</div>
                      <div className="text-xs text-neutral-500">{r.vendor} · {r.handle} · {r.changeCount} delta(s)</div>
                    </td>
                    {category.facets.map((f) => {
                      const conf = r.facets[f.key]?.confidence ?? "none";
                      const delta = r.deltas.find((d) => d.facetKey === f.key);
                      return (
                        <td key={f.key} className="p-2">
                          <Input
                            className="h-8 text-xs"
                            value={cellValue(r, f)}
                            placeholder="(blank = skip)"
                            onChange={(e) => setCell(r.productId, f.key, e.target.value)}
                          />
                          <div className={`text-[11px] mt-0.5 ${CONF_STYLE[conf]}`}>
                            {conf}
                            {delta?.change === "update" && delta.current != null && (
                              <span className="text-neutral-400"> · now: {delta.current}</span>
                            )}
                            {delta?.change === "unchanged" && <span className="text-neutral-400"> · already set</span>}
                          </div>
                          {aiNotes[r.productId]?.[f.key] && (
                            <div
                              className="text-[11px] mt-0.5 text-violet-700 max-w-[220px] truncate"
                              title={aiNotes[r.productId][f.key].reasoning}
                            >
                              AI{aiNotes[r.productId][f.key].value == null ? " (no evidence)" : ""}:{" "}
                              {aiNotes[r.productId][f.key].reasoning}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-2 text-xs text-amber-800">{r.flags.join(" | ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Apply gate */}
          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="font-medium">Apply to Shopify</h2>
            <p className="text-sm text-neutral-500">
              Writes metafield values for the <strong>{includedCount}</strong> included rows.
              The server re-reads Shopify first and writes only real deltas, so this is safe to
              re-run. Flagged rows stay out until you check them in. Blank cells are skipped,
              never deleted.
            </p>
            {!definitionsReady && (
              <p className="text-sm text-red-700">
                Definitions are not ready — apply is blocked until they exist with storefront visibility.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Input
                className="h-9 w-40"
                placeholder='Type "APPLY"'
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
              <Button
                disabled={confirmText !== "APPLY" || applying || !definitionsReady || includedCount === 0}
                onClick={runApply}
              >
                {applying ? "Applying…" : `Apply ${includedCount} row(s)`}
              </Button>
            </div>
            {applyResult && (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 space-y-1">
                <div>
                  Wrote <strong>{applyResult.written}</strong> metafield value(s)
                  {applyResult.productsTouched != null && <> across <strong>{applyResult.productsTouched}</strong> product(s)</>}.
                  {" "}{applyResult.unchanged} already matched. {applyResult.message}
                </div>
                {!!applyResult.errors?.length && (
                  <div className="text-red-700">
                    {applyResult.errors.length} error(s): {applyResult.errors.slice(0, 5).join(" | ")}
                    {" "}— re-run apply after fixing; only remaining deltas are rewritten.
                  </div>
                )}
                <div className="text-xs text-emerald-800">
                  Next step: open Shopify admin → Search &amp; Discovery → Filters and add the new
                  metafields as filters (one-time manual step per facet).
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
