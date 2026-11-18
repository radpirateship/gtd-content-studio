"use client";

/**
 * BrandCollectionsCreate — create brand collections for vendors that have
 * products but no brand page yet, and register them in the content queue.
 * Lives under Collections > New Brand Pages; also served at /brand-collections-create.
 *
 * One vendor per line, spelled exactly as the product vendor field. An optional
 * ", <Hub>" after the name pins the queue category (Saunas, Recovery, Fitness,
 * Clinical or Wellness); otherwise it is guessed from the vendor's product
 * types. Dry run
 * checks Shopify for products and any existing collection and shows what
 * would happen. Apply creates each smart collection (title = vendor, rule
 * VENDOR EQUALS vendor, handle = slugified vendor), then upserts the queue row
 * as a brand page so it shows under "Needs content" for the copy generator.
 *
 * Backed by POST /api/collections/create-brand-collections (dry run unless confirm).
 */

import { useMemo, useState } from "react";

const DEFAULT_VENDORS = `WeckMethod
Kyota
KiHealth
Infinity
Sleepme, Wellness
FitBench
mTrigger
SitnStand
Strava
Mueller
Haelo`;

type Report = {
  vendor: string;
  slug: string;
  path: string;
  products: { total: number; live: number; types: Record<string, number> };
  existing: { id: number; type: string; handle: string; title: string; published: boolean; via: string } | null;
  queueRow: { exists: boolean; shopifyId: string | null; primaryKeyword: string | null; category: string | null };
  category: string;
  plan: string[];
  blockers: string[];
  result?: {
    created?: { id: number; handle: string; title: string; published: boolean } | string;
    handleDrifted?: boolean;
    queue?: string;
    storefront?: { status: number };
  };
};

type Resp = { dryRun: boolean; publish: boolean; summary: Record<string, number>; reports: Report[] };

type VendorInput = { vendor: string; category?: string };

function parseVendors(text: string): VendorInput[] {
  const out: VendorInput[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [name, cat] = line.split(",").map((s) => s.trim());
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(cat ? { vendor: name, category: cat } : { vendor: name });
  }
  return out;
}

export function BrandCollectionsCreate() {
  const [text, setText] = useState(DEFAULT_VENDORS);
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState<"dry" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<Resp | null>(null);

  const vendors = useMemo(() => parseVendors(text), [text]);

  async function run(confirm: boolean) {
    if (vendors.length === 0) return;
    if (confirm) {
      const n = resp?.summary?.wouldCreate ?? vendors.length;
      if (!window.confirm(`Create ${n} brand collection(s) on the live store${publish ? " (published)" : " (unpublished)"} and add them to the content queue?`)) return;
    }
    setBusy(confirm ? "apply" : "dry");
    setError(null);
    try {
      const res = await fetch("/api/collections/create-brand-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendors, confirm, publish }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setResp(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const canApply = !!resp && resp.dryRun && (resp.summary.wouldCreate > 0 || resp.summary.alreadyExist > 0);

  return (
    <div className="mx-auto max-w-6xl p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create Brand Collections</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One vendor per line, spelled exactly as the product vendor field in Shopify. Add <code>, Wellness</code> (or Saunas,
          Recovery, Fitness, Clinical) after a name to pin its queue category; otherwise it is guessed from the vendor&apos;s product
          types. Dry run checks products and existing
          collections. Apply creates a smart collection per vendor (title = vendor name, rule <code>VENDOR EQUALS</code> vendor,
          handle = slugified vendor) and registers it in the content queue as a brand page under &quot;Needs content&quot;. Vendors
          that already have a collection are never duplicated; their queue row is stamped with the live id instead.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <textarea
          className="min-h-[260px] w-full rounded-md border p-3 font-mono text-sm"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResp(null);
          }}
          spellCheck={false}
        />
        <div className="space-y-3">
          <div className="rounded-md border p-3 text-sm">
            <div className="text-2xl font-bold">{vendors.length}</div>
            <div className="text-xs text-muted-foreground">vendors in the list</div>
          </div>
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => {
                setPublish(e.target.checked);
                setResp(null);
              }}
            />
            Publish to the Online Store on create
          </label>
          <button
            onClick={() => run(false)}
            disabled={busy !== null || vendors.length === 0}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "dry" ? "Checking…" : "Dry run"}
          </button>
          <button
            onClick={() => run(true)}
            disabled={busy !== null || !canApply}
            className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy === "apply" ? "Creating…" : resp?.dryRun ? `Apply (${resp.summary.wouldCreate} to create)` : "Apply"}
          </button>
          <p className="text-xs text-muted-foreground">Apply is enabled only after a dry run of the current list.</p>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {resp && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {[
              ["vendors", resp.summary.vendors],
              [resp.dryRun ? "would create" : "created", resp.dryRun ? resp.summary.wouldCreate : resp.summary.created],
              ["already exist", resp.summary.alreadyExist],
              ["blocked", resp.summary.blocked],
              ["queue rows written", resp.dryRun ? "-" : resp.summary.queued],
              ["mode", resp.dryRun ? "dry run" : "applied"],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border p-3">
                <div className="text-2xl font-bold">{String(value)}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-2">Vendor</th>
                  <th className="p-2">Handle</th>
                  <th className="p-2 text-right">Products (live / total)</th>
                  <th className="p-2">Category</th>
                  <th className="p-2">Plan</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {resp.reports.map((r) => {
                  const created = r.result?.created;
                  const ok = created && typeof created === "object";
                  const types = Object.entries(r.products.types).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} (${n})`).join(", ");
                  return (
                    <tr key={r.vendor} className="border-t align-top">
                      <td className="p-2">
                        <div className="font-medium">{r.vendor}</div>
                        <div className="text-xs text-muted-foreground">{types}</div>
                      </td>
                      <td className="p-2 font-mono text-xs">
                        <a href={`https://greenthumbdepot.com${r.path}`} target="_blank" rel="noreferrer" className="underline">{r.path}</a>
                        {r.queueRow.exists && <div className="text-muted-foreground">queue row exists{r.queueRow.shopifyId ? ` (id ${r.queueRow.shopifyId})` : ""}</div>}
                      </td>
                      <td className="p-2 text-right">{r.products.live} / {r.products.total}</td>
                      <td className="p-2">{r.category}</td>
                      <td className="p-2 text-xs">
                        {r.plan.map((p, i) => <div key={i}>{p}</div>)}
                        {r.blockers.map((b, i) => <div key={`b${i}`} className="text-amber-800">{b}</div>)}
                      </td>
                      <td className="p-2 text-xs">
                        {!r.result && <span className="rounded bg-gray-100 px-2 py-0.5">{r.existing ? "exists" : r.blockers.length ? "blocked" : "ready"}</span>}
                        {r.result && (
                          <div className="space-y-1">
                            <span className={`rounded px-2 py-0.5 ${ok ? "bg-green-100 text-green-800" : String(created).startsWith("skipped, exists") ? "bg-blue-100 text-blue-800" : "bg-red-100 text-red-800"}`}>
                              {ok ? `created id ${(created as { id: number }).id}${(created as { published: boolean }).published ? ", published" : ", unpublished"}` : String(created)}
                            </span>
                            {r.result.handleDrifted && <div className="text-amber-800">handle drifted, check for a duplicate</div>}
                            {r.result.queue && <div>queue: {r.result.queue}</div>}
                            {r.result.storefront && <div>storefront: {r.result.storefront.status === 200 ? "200 live" : `HTTP ${r.result.storefront.status}`}</div>}
                          </div>
                        )}
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
