"use client";

/**
 * /collections-retire — retire collection URLs behind a 301, from the app.
 *
 * Paste one "source, destination" pair per line (handles only), run a Dry run
 * to see exactly what would happen, then Apply. Apply unpublishes each source
 * from the Online Store (rules, products and copy are kept), creates the 301,
 * and checks the storefront answers 301 to the right place.
 *
 * Restore re-publishes a collection and deletes its redirect.
 *
 * Backed by POST /api/shopify/collections/retire (dry run unless confirm).
 */

import { useMemo, useState } from "react";

type Report = {
  handle: string;
  target: string;
  path: string;
  targetPath: string;
  plan: string[];
  blockers: string[];
  source?: { id: number; type: string; title: string; published: boolean } | null;
  destination?: { id: number; type: string; title: string; published: boolean } | null;
  result?: {
    unpublished?: boolean | string;
    redirect?: number | boolean | string;
    republished?: boolean | string;
    redirectDeleted?: boolean | string;
    storefront?: { status: number; location: string | null };
    verified?: boolean;
  };
};

type Resp = {
  dryRun: boolean;
  op: "retire" | "restore";
  summary: Record<string, number>;
  reports: Report[];
  error?: string;
};

const WAVE1 = `1-person-traditional-sauna, 1-person-saunas
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

function parse(text: string): { handle: string; target: string }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [a, b] = l.split(/\s*[,\t>]+\s*|\s+->\s+|\s{2,}/).map((s) => (s || "").trim().replace(/^\/?collections\//, "").replace(/\/$/, ""));
      return { handle: a || "", target: b || "" };
    });
}

export default function CollectionsRetirePage() {
  const [text, setText] = useState(WAVE1);
  const [op, setOp] = useState<"retire" | "restore">("retire");
  const [busy, setBusy] = useState<"dry" | "apply" | null>(null);
  const [resp, setResp] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => parse(text), [text]);
  const runnable = useMemo(
    () => (resp?.dryRun ? resp.reports.filter((r) => r.blockers.length === 0 && !r.plan.some((p) => p.startsWith("already retired"))) : []),
    [resp]
  );

  async function call(confirm: boolean) {
    setBusy(confirm ? "apply" : "dry");
    setError(null);
    try {
      const res = await fetch("/api/shopify/collections/retire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, op, confirm }),
      });
      const text = await res.text();
      let data: Resp | null = null;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server returned non-JSON (${res.status}): ${text.slice(0, 160)}`);
      }
      if (!res.ok || !data) throw new Error(data?.error || `Server error ${res.status}`);
      setResp(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function onApply() {
    if (!resp?.dryRun) return;
    const n = runnable.length;
    const verb = op === "restore" ? "re-publish and remove the redirect for" : "unpublish and 301";
    if (!window.confirm(`This will ${verb} ${n} collection(s) on the live store. Continue?`)) return;
    void call(true);
  }

  const applied = resp && !resp.dryRun;

  return (
    <div className="mx-auto max-w-6xl p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Retire Collections — 301 Redirects</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One pair per line: <code>source-handle, destination-handle</code>. Dry run first; nothing changes until you Apply.
          Apply unpublishes each source from the Online Store (rules, products and copy are kept), creates the 301, and
          verifies the storefront answers 301 to the destination. Frozen URLs (barrel-saunas, outdoor-saunas, hyperbaric-chambers)
          are refused. Restore reverses a retirement.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <textarea
          className="min-h-[320px] w-full rounded-md border p-3 font-mono text-sm"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResp(null);
          }}
          spellCheck={false}
        />
        <div className="space-y-3">
          <div className="rounded-md border p-3 text-sm space-y-2">
            <div className="font-medium">Mode</div>
            <label className="flex items-center gap-2">
              <input type="radio" checked={op === "retire"} onChange={() => { setOp("retire"); setResp(null); }} /> Retire (unpublish + 301)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={op === "restore"} onChange={() => { setOp("restore"); setResp(null); }} /> Restore (re-publish, delete 301)
            </label>
          </div>
          <div className="rounded-md border p-3 text-sm">
            <div className="text-2xl font-bold">{items.length}</div>
            <div className="text-xs text-muted-foreground">pairs in the list</div>
          </div>
          <button
            onClick={() => void call(false)}
            disabled={busy !== null || items.length === 0}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "dry" ? "Checking…" : "Dry run"}
          </button>
          <button
            onClick={onApply}
            disabled={busy !== null || !resp?.dryRun || runnable.length === 0}
            className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy === "apply" ? "Applying…" : `Apply ${resp?.dryRun ? runnable.length : ""}`.trim()}
          </button>
          <p className="text-xs text-muted-foreground">Apply is enabled only after a clean dry run of the current list.</p>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {resp && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(resp.summary).map(([label, value]) => (
              <div key={label} className="rounded-md border p-3">
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <div className="text-sm font-medium">{resp.dryRun ? "Dry run — nothing was changed" : "Applied"}</div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-2">Source</th>
                  <th className="p-2">Destination</th>
                  <th className="p-2">{applied ? "Result" : "Plan"}</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {resp.reports.map((r) => {
                  const blocked = r.blockers.length > 0;
                  const ok = applied ? r.result?.verified === true : !blocked;
                  return (
                    <tr key={r.handle} className="border-t align-top">
                      <td className="p-2 font-mono">
                        {r.handle}
                        {r.source && <div className="text-xs text-muted-foreground">{r.source.type} · {r.source.published ? "published" : "unpublished"}</div>}
                      </td>
                      <td className="p-2 font-mono">
                        {r.target}
                        {r.destination && <div className="text-xs text-muted-foreground">{r.destination.published ? "published" : "NOT published"}</div>}
                      </td>
                      <td className="p-2">
                        {blocked ? (
                          <ul className="list-disc pl-4 text-red-800">{r.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                        ) : applied && r.result ? (
                          <ul className="list-disc pl-4">
                            {"unpublished" in r.result && <li>unpublished: {String(r.result.unpublished)}</li>}
                            {"redirect" in r.result && <li>redirect: {String(r.result.redirect)}</li>}
                            {"republished" in r.result && <li>republished: {String(r.result.republished)}</li>}
                            {"redirectDeleted" in r.result && <li>redirect deleted: {String(r.result.redirectDeleted)}</li>}
                            {r.result.storefront && <li>storefront: {r.result.storefront.status} {r.result.storefront.location || ""}</li>}
                          </ul>
                        ) : (
                          <ul className="list-disc pl-4">{r.plan.map((p) => <li key={p}>{p}</li>)}</ul>
                        )}
                      </td>
                      <td className="p-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${ok ? "bg-green-100 text-green-800" : blocked ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                          {applied ? (ok ? "verified 301" : "check") : blocked ? "blocked" : "ready"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
