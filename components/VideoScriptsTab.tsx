"use client";

/**
 * Video Scripts tab (sidebar: Video > Video Scripts; also served standalone at
 * /video-scripts): short-form video scripts (Reels / Shorts) for our best
 * sellers. Products and collections are ranked by net revenue from the PPW
 * Dashboard; each one opens a panel showing the source material (product or
 * collection page, store facts, related blog posts) and the scripts written
 * for it, with a status that tracks it from draft to posted.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import VideoScriptView, { isSpecV2 } from "@/components/VideoScriptView";
import { scriptToText } from "@/lib/video-scripts/format";
import {
  ANGLE_TYPES, HOOK_TYPES, LONG_LENGTH_MIN, SCRIPT_TYPES, SERIES, SHORT_LENGTH, wordBudget,
  type CitedStudy, type ScriptType, type Spec,
} from "@/lib/video-scripts/types";

type RankRow = {
  kind: "product" | "collection";
  key: string;
  rank: number;
  title: string;
  handle: string | null;
  vendor: string | null;
  status: string | null;
  image_url: string | null;
  price: string | null;
  net: number;
  units: number;
  orders: number;
  product_count: number;
  flags: string[];
  collections: Array<{ handle: string; title: string }>;
  products: Array<{ id: string; title: string; handle: string; net: number }>;
  scriptStatus: string | null;
  scriptCounts: Record<string, number>;
};

type RankingMeta = {
  days: number;
  refreshedAt: string;
  dataRange: { first: string | null; last: string | null } | null;
  salesRows: number;
  matchedProducts: number;
  totalNet: number;
  unmatchedNet: number;
  unmatched: Array<{ title: string; net: number; units: number }>;
};

type Article = { articleId: string; title: string; url: string; wordCount: number; match: string; excerpt: string };
type Sources = {
  kind: "product" | "collection";
  key: string;
  title: string;
  url: string;
  pageText: string;
  products: Array<{ id: string; title: string; vendor: string; price: string | null; url: string; net: number | null; images: number }>;
  specs: Spec[];
  rank: { rank: number; net: number; days: number | null } | null;
  articles: Article[];
  warnings: string[];
};
type Script = {
  id: number; kind: string; target_key: string; target_title: string; status: string; format: string | null;
  length_sec: number | null; title: string | null; content: unknown; sources: Record<string, unknown>;
  warnings: string[]; notes: string | null; created_at: string; updated_at: string;
};

const STATUSES = ["draft", "approved", "recorded", "posted", "rejected"];
const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  approved: "bg-blue-100 text-blue-800",
  recorded: "bg-amber-100 text-amber-800",
  posted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
};
const WINDOWS = [
  { days: 90, label: "Last 90 days" },
  { days: 180, label: "Last 6 months" },
  { days: 365, label: "Last 12 months" },
  { days: 730, label: "Last 2 years" },
  { days: 3650, label: "All time" },
];

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "n/a");

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">not started</span>;
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] || ""}`}>{status}</span>;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export default function VideoScriptsTab() {
  const [tab, setTab] = useState<"product" | "collection" | "scripts">("product");
  const [products, setProducts] = useState<RankRow[]>([]);
  const [collections, setCollections] = useState<RankRow[]>([]);
  const [ranking, setRanking] = useState<RankingMeta | null>(null);
  const [articlesMeta, setArticlesMeta] = useState<{ refreshedAt: string; articles: number; withProductLinks: number } | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [days, setDays] = useState(365);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [notStartedOnly, setNotStartedOnly] = useState(false);
  const [showAllCollections, setShowAllCollections] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [open, setOpen] = useState<RankRow | null>(null);
  const [allScripts, setAllScripts] = useState<Script[]>([]);

  const load = useCallback(async () => {
    try {
      const d = await api<{
        products: RankRow[]; collections: RankRow[]; ranking: RankingMeta | null;
        articles: typeof articlesMeta; hiddenCollections: string[];
      }>("/api/video-scripts/rankings");
      setProducts(d.products);
      setCollections(d.collections);
      setRanking(d.ranking);
      setArticlesMeta(d.articles);
      setHidden(d.hiddenCollections || []);
      if (d.ranking?.days) setDays(d.ranking.days);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadAllScripts = useCallback(async () => {
    try {
      const d = await api<{ scripts: Script[] }>("/api/video-scripts/scripts");
      setAllScripts(d.scripts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === "scripts") loadAllScripts(); }, [tab, loadAllScripts]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const refreshRanking = () =>
    run("ranking", () => api("/api/video-scripts/rankings/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }),
    }));
  const refreshArticles = () => run("articles", () => api("/api/video-scripts/articles/refresh", { method: "POST" }));

  async function toggleHidden(handle: string) {
    const next = hidden.includes(handle) ? hidden.filter((h) => h !== handle) : [...hidden, handle];
    setHidden(next);
    await api("/api/video-scripts/prefs", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hiddenCollections: next }),
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    let out = tab === "product" ? products : collections;
    if (tab === "product" && activeOnly) out = out.filter((r) => r.status === "ACTIVE");
    if (tab === "collection" && !showAllCollections) {
      out = out.filter((r) => !hidden.includes(r.key) && !r.flags.includes("brand") && !r.flags.includes("system") && r.product_count >= 2);
    }
    if (notStartedOnly) out = out.filter((r) => !r.scriptStatus || r.scriptStatus === "rejected");
    if (s) out = out.filter((r) => r.title.toLowerCase().includes(s) || (r.vendor || "").toLowerCase().includes(s) || (r.handle || "").includes(s));
    return out;
  }, [tab, products, collections, activeOnly, showAllCollections, hidden, notStartedOnly, search]);

  return (
    <div className="mx-auto w-full max-w-7xl p-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Video Scripts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Reels and Shorts scripts for our best sellers. Products and collections are ranked by net revenue
          (sales minus discounts and refunds) from the PPW Dashboard. Open one to see its source material and write a script.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-md border px-3 py-2 text-sm">
          {WINDOWS.map((w) => <option key={w.days} value={w.days}>{w.label}</option>)}
        </select>
        <button onClick={refreshRanking} disabled={!!busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy === "ranking" ? "Ranking products (up to a minute)..." : "Refresh sales ranking"}
        </button>
        <button onClick={refreshArticles} disabled={!!busy}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
          {busy === "articles" ? "Indexing blog posts..." : "Rebuild blog post index"}
        </button>
      </div>

      {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div className="rounded-md border p-3">
          {ranking ? (
            <>
              <div><b>Ranking:</b> {WINDOWS.find((w) => w.days === ranking.days)?.label || `${ranking.days} days`}, refreshed {fmtDate(ranking.refreshedAt)}</div>
              <div className="text-muted-foreground">
                {ranking.matchedProducts} products matched, {usd(ranking.totalNet)} net revenue.
                Order history covers {fmtDate(ranking.dataRange?.first)} to {fmtDate(ranking.dataRange?.last)}.
              </div>
              {ranking.unmatched.length > 0 && (
                <button onClick={() => setShowUnmatched((v) => !v)} className="mt-1 text-amber-700 underline">
                  {usd(ranking.unmatchedNet)} of sales did not match a current product ({ranking.unmatched.length}{ranking.unmatched.length >= 60 ? "+" : ""} titles)
                </button>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">No ranking yet. Pick a window and click Refresh sales ranking.</div>
          )}
        </div>
        <div className="rounded-md border p-3">
          {articlesMeta ? (
            <>
              <div><b>Blog post index:</b> {articlesMeta.articles} posts, refreshed {fmtDate(articlesMeta.refreshedAt)}</div>
              <div className="text-muted-foreground">{articlesMeta.withProductLinks} posts link to at least one product.</div>
            </>
          ) : (
            <div className="text-muted-foreground">Blog posts not indexed yet. Click Rebuild blog post index so scripts can draw on them.</div>
          )}
        </div>
      </div>

      {showUnmatched && ranking && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="mb-2 text-amber-900">
            These order lines did not match any product in Shopify, usually because the product was renamed or deleted.
            They are left out of the ranking.
          </p>
          <ul className="grid gap-1 md:grid-cols-2">
            {ranking.unmatched.map((u) => <li key={u.title}>{usd(u.net)} &middot; {u.title}</li>)}
          </ul>
        </div>
      )}

      <div className="flex gap-1 border-b">
        {([["product", `Products (${products.length})`], ["collection", `Collections (${collections.length})`], ["scripts", "All scripts"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium ${tab === k ? "border-b-2 border-blue-600 text-blue-700" : "text-gray-600 hover:text-gray-900"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab !== "scripts" && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
              className="w-64 rounded-md border px-3 py-1.5 text-sm" />
            {tab === "product" && (
              <label className="flex items-center gap-2"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active products only</label>
            )}
            {tab === "collection" && (
              <label className="flex items-center gap-2"><input type="checkbox" checked={showAllCollections} onChange={(e) => setShowAllCollections(e.target.checked)} /> Show brand, system and hidden collections</label>
            )}
            <label className="flex items-center gap-2"><input type="checkbox" checked={notStartedOnly} onChange={(e) => setNotStartedOnly(e.target.checked)} /> Not started only</label>
            <span className="text-muted-foreground">{rows.length} shown</span>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 w-12">#</th>
                  <th className="px-3 py-2">{tab === "product" ? "Product" : "Collection"}</th>
                  <th className="px-3 py-2 text-right">Net revenue</th>
                  <th className="px-3 py-2 text-right">{tab === "product" ? "Units" : "Products sold"}</th>
                  <th className="px-3 py-2">Script</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500">{r.rank}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        {r.image_url && <img src={`${r.image_url}${r.image_url.includes("?") ? "&" : "?"}width=80`} alt="" className="h-9 w-9 rounded object-cover" />}
                        <div>
                          <div className="font-medium">{r.title}</div>
                          <div className="text-xs text-gray-500">
                            {tab === "product"
                              ? [r.vendor, r.price ? `$${Number(r.price).toLocaleString("en-US")}` : null, r.status !== "ACTIVE" ? r.status?.toLowerCase() : null].filter(Boolean).join(" · ")
                              : [r.handle, ...r.flags].join(" · ")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{usd(r.net)}</td>
                    <td className="px-3 py-2 text-right">{tab === "product" ? r.units : r.product_count}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.scriptStatus} /></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {tab === "collection" && (
                        <button onClick={() => toggleHidden(r.key)} className="mr-3 text-xs text-gray-500 hover:underline">
                          {hidden.includes(r.key) ? "Unhide" : "Hide"}
                        </button>
                      )}
                      <button onClick={() => setOpen(r)} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-white">Open</button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Nothing to show. Refresh the sales ranking or loosen the filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "scripts" && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-3 py-2">Script</th><th className="px-3 py-2">For</th><th className="px-3 py-2">Format</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Created</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {allScripts.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{s.title || `Script ${s.id}`}</td>
                  <td className="px-3 py-2">{s.target_title} <span className="text-xs text-gray-500">({s.kind})</span></td>
                  <td className="px-3 py-2">{s.format} {s.length_sec ? `· ${s.length_sec}s` : ""}</td>
                  <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                  <td className="px-3 py-2">{fmtDate(s.created_at)}</td>
                  <td className="px-3 py-2 text-right"><a href={`/video-scripts/read/${s.id}`} target="_blank" className="text-blue-700 hover:underline">Read view</a></td>
                </tr>
              ))}
              {!allScripts.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No scripts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && <TargetPanel row={open} catalog={products} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function TargetPanel({ row, catalog, onClose }: { row: RankRow; catalog: RankRow[]; onClose: () => void }) {
  const [sources, setSources] = useState<Sources | null>(null);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPage, setShowPage] = useState(false);
  const [showSpecs, setShowSpecs] = useState(false);

  // Form
  const [type, setType] = useState<ScriptType>(row.kind === "collection" ? "HOOK_ANGLE" : "PRODUCT_REVIEW");
  const [series, setSeries] = useState(SERIES[row.kind === "collection" ? "HOOK_ANGLE" : "PRODUCT_REVIEW"][0]);
  const [customSeries, setCustomSeries] = useState("");
  const [hookType, setHookType] = useState("");
  const [targetBuyer, setTargetBuyer] = useState("");
  const [lengthSec, setLengthSec] = useState(SHORT_LENGTH.defaultA);
  const [lengthMin, setLengthMin] = useState(LONG_LENGTH_MIN.default);
  const [photos, setPhotos] = useState(0);
  const [supplierVideo, setSupplierVideo] = useState(false);
  const [licence, setLicence] = useState<"confirmed" | "pending" | "none">("none");
  const [bestSeller, setBestSeller] = useState(false);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [addProduct, setAddProduct] = useState("");
  const [comparison, setComparison] = useState("");
  const [mfrUrl, setMfrUrl] = useState("");
  const [mfrText, setMfrText] = useState("");
  const [angleType, setAngleType] = useState(row.kind === "collection" ? "collection" : "ritual");
  const [angleStatement, setAngleStatement] = useState("");
  const [study, setStudy] = useState<CitedStudy>({ title: "", authors: "", journal: "", year: "", url: "", finding: "" });
  const [chapterCount, setChapterCount] = useState(5);
  const [chapterQuestions, setChapterQuestions] = useState("");
  const [selectedPosts, setSelectedPosts] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const loadScripts = useCallback(async () => {
    const d = await api<{ scripts: Script[] }>(`/api/video-scripts/scripts?kind=${row.kind}&key=${encodeURIComponent(row.key)}`);
    setScripts(d.scripts);
  }, [row]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [d] = await Promise.all([
          api<{ sources: Sources }>(`/api/video-scripts/sources?kind=${row.kind}&key=${encodeURIComponent(row.key)}`),
          loadScripts(),
        ]);
        setSources(d.sources);
        const defaults = row.kind === "product" ? [d.sources.products[0]?.id].filter(Boolean) : d.sources.products.slice(0, 2).map((p) => p.id);
        setProductIds(defaults as string[]);
        setPhotos(d.sources.products[0]?.images || 0);
        setSelectedPosts(d.sources.articles.slice(0, 3).map((a) => a.articleId));
        if (row.kind === "collection") setAngleStatement(`What to know before buying from ${d.sources.title}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [row, loadScripts]);

  function changeType(t: ScriptType) {
    setType(t);
    setSeries(SERIES[t][0]);
    setHookType("");
    if (t === "PRODUCT_REVIEW") setLengthSec(SHORT_LENGTH.defaultA);
    if (t === "HOOK_ANGLE") setLengthSec(SHORT_LENGTH.defaultB);
  }

  // Products the user can pick from: this target's products plus the ranking.
  const pickable = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of sources?.products || []) m.set(p.id, p.title);
    for (const p of catalog) m.set(p.key, p.title);
    return m;
  }, [sources, catalog]);
  const maxProducts = type === "PRODUCT_REVIEW" ? 1 : 3;

  function addPicked() {
    const id = [...pickable.entries()].find(([, t]) => t === addProduct)?.[0];
    if (id && !productIds.includes(id) && productIds.length < maxProducts) setProductIds([...productIds, id]);
    setAddProduct("");
  }

  async function generate() {
    setError(null);
    if (!targetBuyer.trim()) return setError("Add a target buyer, e.g. first-time backyard sauna buyer.");
    if (!productIds.length) return setError("Pick at least one product.");
    if (hookType === "health_stat" && (!study.url || !study.finding)) return setError("A health-stat hook needs a cited study with a URL and the exact finding.");
    setGenerating(true);
    try {
      const compId = [...pickable.entries()].find(([, t]) => t === comparison)?.[0] || null;
      await api("/api/video-scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type, kind: row.kind, key: row.key,
          productIds: productIds.slice(0, maxProducts),
          comparisonProductId: type === "PRODUCT_REVIEW" ? compId : null,
          series: series === "__custom" ? customSeries || "PPW Honest Verdict" : series,
          hookType: hookType || null,
          targetBuyer,
          lengthSec: type === "LONG_FORM" ? lengthMin * 60 : lengthSec,
          assets: { photos, supplierVideo, licence },
          isBestSellerVerified: bestSeller,
          manufacturerSpecs: mfrText.trim() ? { url: mfrUrl, text: mfrText } : null,
          angleType: type === "HOOK_ANGLE" ? angleType : null,
          angleStatement: type === "HOOK_ANGLE" ? angleStatement : null,
          citedStudy: type === "HOOK_ANGLE" && study.url && study.finding ? study : null,
          chapterCount: type === "LONG_FORM" ? chapterCount : null,
          chapterQuestions: type === "LONG_FORM" ? chapterQuestions.split("\n").map((s) => s.trim()).filter(Boolean) : null,
          articleIds: selectedPosts,
          notes: notes || null,
        }),
      });
      await loadScripts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function setStatus(id: number, status: string) {
    await api("/api/video-scripts/scripts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) })
      .then(loadScripts).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }
  async function remove(id: number) {
    if (!window.confirm("Delete this script?")) return;
    await api(`/api/video-scripts/scripts?id=${id}`, { method: "DELETE" })
      .then(loadScripts).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  const budget = wordBudget(type === "LONG_FORM" ? lengthMin * 60 : lengthSec);
  const input = "rounded-md border px-3 py-2 text-sm";
  const label = "block text-xs font-medium uppercase text-gray-500 mb-1";

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-4xl overflow-y-auto bg-white p-6 shadow-xl space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase text-gray-500">#{row.rank} {row.kind} · {usd(row.net)} net</div>
            <h2 className="text-xl font-bold">{row.title}</h2>
            {sources && <a href={sources.url} target="_blank" className="text-sm text-blue-700 hover:underline">{sources.url}</a>}
          </div>
          <button onClick={onClose} className="rounded-md border px-3 py-1 text-sm">Close</button>
        </div>

        {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {loading && <div className="text-sm text-gray-500">Loading products and listed specs from Shopify...</div>}

        {sources && (
          <>
            {sources.warnings.length > 0 && (
              <ul className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 list-disc pl-6">
                {sources.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}

            <section className="space-y-2">
              <button onClick={() => setShowSpecs((v) => !v)} className="text-sm font-semibold text-blue-700 hover:underline">
                {showSpecs ? "Hide" : "Show"} listed specs ({sources.specs.length}), the only numbers a script may use
              </button>
              {showSpecs && (
                <table className="w-full text-xs">
                  <tbody>
                    {sources.specs.map((s) => (
                      <tr key={s.id} className="border-t align-top">
                        <td className="py-1 pr-2 text-gray-500">{s.id}</td>
                        <td className="py-1 pr-2 text-gray-500">{s.product}</td>
                        <td className="py-1 pr-2">{s.label}: <b>{s.value}</b>{s.derived && <span className="text-amber-700"> (derived)</span>}</td>
                        <td className="py-1 text-gray-400">{s.sourceText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div>
                <button onClick={() => setShowPage((v) => !v)} className="text-sm text-blue-700 hover:underline">
                  {showPage ? "Hide" : "Show"} {sources.kind} page text
                </button>
                {showPage && <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs">{sources.pageText || "(empty)"}</pre>}
              </div>
            </section>

            <section className="space-y-4 rounded-md border p-4">
              <h3 className="font-semibold">New script</h3>
              <div className="grid gap-2 md:grid-cols-3">
                {SCRIPT_TYPES.map((t) => (
                  <button key={t.id} onClick={() => changeType(t.id)}
                    className={`rounded-md border p-2 text-left text-xs ${type === t.id ? "border-blue-600 bg-blue-50" : "hover:bg-gray-50"}`}>
                    <div className="text-sm font-semibold">{t.label}</div>
                    <div className="text-gray-600">{t.description}</div>
                  </button>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className={label}>Series</label>
                  <select value={series} onChange={(e) => setSeries(e.target.value)} className={`${input} w-full`}>
                    {SERIES[type].map((s) => <option key={s} value={s}>{s}</option>)}
                    <option value="__custom">Custom...</option>
                  </select>
                  {series === "__custom" && <input value={customSeries} onChange={(e) => setCustomSeries(e.target.value)} placeholder="Series name" className={`${input} mt-1 w-full`} />}
                </div>
                <div>
                  <label className={label}>Hook type</label>
                  <select value={hookType} onChange={(e) => setHookType(e.target.value)} className={`${input} w-full`}>
                    <option value="">Let the generator choose</option>
                    {HOOK_TYPES[type].map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>{type === "LONG_FORM" ? "Length (minutes)" : "Length (seconds)"}</label>
                  {type === "LONG_FORM" ? (
                    <input type="number" min={LONG_LENGTH_MIN.min} max={LONG_LENGTH_MIN.max} value={lengthMin} onChange={(e) => setLengthMin(Number(e.target.value))} className={`${input} w-full`} />
                  ) : (
                    <input type="number" min={SHORT_LENGTH.min} max={SHORT_LENGTH.max} value={lengthSec} onChange={(e) => setLengthSec(Number(e.target.value))} className={`${input} w-full`} />
                  )}
                  <div className="mt-1 text-xs text-gray-500">{budget.min} to {budget.max} spoken words</div>
                </div>
              </div>

              <div>
                <label className={label}>Target buyer (required)</label>
                <input value={targetBuyer} onChange={(e) => setTargetBuyer(e.target.value)} placeholder="e.g. first-time backyard sauna buyer" className={`${input} w-full`} />
              </div>

              <div>
                <label className={label}>{type === "PRODUCT_REVIEW" ? "Product" : `Products (up to 3)`}</label>
                <div className="flex flex-wrap gap-2">
                  {productIds.map((id) => (
                    <span key={id} className="rounded-full bg-gray-100 px-3 py-1 text-xs">
                      {pickable.get(id) || id}
                      <button onClick={() => setProductIds(productIds.filter((x) => x !== id))} className="ml-2 text-gray-500 hover:text-red-600">x</button>
                    </span>
                  ))}
                </div>
                {productIds.length < maxProducts && (
                  <div className="mt-2 flex gap-2">
                    <input list="vs-products" value={addProduct} onChange={(e) => setAddProduct(e.target.value)} placeholder="Add a product (type to search)" className={`${input} flex-1`} />
                    <button onClick={addPicked} className="rounded-md border px-3 text-sm">Add</button>
                  </div>
                )}
                <datalist id="vs-products">{[...pickable.values()].map((t) => <option key={t} value={t} />)}</datalist>
              </div>

              {type === "PRODUCT_REVIEW" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className={label}>Comparison product (optional, for head-to-head)</label>
                    <input list="vs-products" value={comparison} onChange={(e) => setComparison(e.target.value)} placeholder="Type to search" className={`${input} w-full`} />
                  </div>
                  <div>
                    <label className={label}>Manufacturer spec page (optional)</label>
                    <input value={mfrUrl} onChange={(e) => setMfrUrl(e.target.value)} placeholder="https://..." className={`${input} w-full`} />
                    <textarea value={mfrText} onChange={(e) => setMfrText(e.target.value)} rows={2} placeholder="Paste spec lines from that page, one per line" className={`${input} mt-1 w-full`} />
                  </div>
                </div>
              )}

              {type === "HOOK_ANGLE" && (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <label className={label}>Angle type</label>
                      <select value={angleType} onChange={(e) => setAngleType(e.target.value)} className={`${input} w-full`}>
                        {ANGLE_TYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className={label}>Angle statement</label>
                      <input value={angleStatement} onChange={(e) => setAngleStatement(e.target.value)} placeholder="What a backyard contrast setup actually takes" className={`${input} w-full`} />
                    </div>
                  </div>
                  <details className="rounded-md border p-2 text-sm">
                    <summary className="cursor-pointer text-gray-600">Cited study (only for a health-stat hook)</summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {(["title", "authors", "journal", "year", "url"] as const).map((k) => (
                        <input key={k} value={study[k]} onChange={(e) => setStudy({ ...study, [k]: e.target.value })} placeholder={k} className={input} />
                      ))}
                      <textarea value={study.finding} onChange={(e) => setStudy({ ...study, finding: e.target.value })} placeholder="Exact finding, as the study states it" rows={2} className={`${input} md:col-span-2`} />
                    </div>
                  </details>
                </div>
              )}

              {type === "LONG_FORM" && (
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className={label}>Chapters (4 to 8)</label>
                    <input type="number" min={4} max={8} value={chapterCount} onChange={(e) => setChapterCount(Number(e.target.value))} className={`${input} w-full`} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={label}>Chapter questions (optional, one per line)</label>
                    <textarea value={chapterQuestions} onChange={(e) => setChapterQuestions(e.target.value)} rows={3} placeholder={"What size is the room?\nIs the heater price the switch-on price?"} className={`${input} w-full`} />
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-4 text-sm">
                <div>
                  <label className={label}>Product photos</label>
                  <input type="number" min={0} value={photos} onChange={(e) => setPhotos(Number(e.target.value))} className={`${input} w-full`} />
                </div>
                <label className="flex items-center gap-2 pt-5"><input type="checkbox" checked={supplierVideo} onChange={(e) => setSupplierVideo(e.target.checked)} /> Supplier video available</label>
                <div>
                  <label className={label}>Supplier licence</label>
                  <select value={licence} onChange={(e) => setLicence(e.target.value as typeof licence)} className={`${input} w-full`}>
                    <option value="none">None</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option>
                  </select>
                </div>
                <label className="flex items-start gap-2 pt-5">
                  <input type="checkbox" className="mt-1" checked={bestSeller} onChange={(e) => setBestSeller(e.target.checked)} />
                  <span>Best-seller verified{sources.rank ? <span className="block text-xs text-gray-500">Rank #{sources.rank.rank} by net revenue{sources.rank.days ? `, last ${sources.rank.days} days` : ""}</span> : null}</span>
                </label>
              </div>

              {sources.articles.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-600">Blog posts for context ({selectedPosts.length} selected; never a source of numbers)</summary>
                  <ul className="mt-2 space-y-1">
                    {sources.articles.map((a) => (
                      <li key={a.articleId} className="flex gap-2">
                        <input type="checkbox" className="mt-1" checked={selectedPosts.includes(a.articleId)}
                          onChange={() => setSelectedPosts((s) => (s.includes(a.articleId) ? s.filter((x) => x !== a.articleId) : [...s, a.articleId]))} />
                        <a href={a.url} target="_blank" className="hover:underline">{a.title}</a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional direction for this script" className={`${input} w-full`} />
              <div className="flex items-center gap-3">
                <button onClick={generate} disabled={generating}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {generating ? "Writing and checking the script..." : "Generate script"}
                </button>
                <span className="text-xs text-gray-500">{type === "LONG_FORM" ? "Long form takes 2 to 4 minutes." : "Takes 30 to 90 seconds, longer if it has to fix a failed check."}</span>
              </div>
            </section>
          </>
        )}

        <section className="space-y-3">
          <h3 className="font-semibold">Scripts ({scripts.length})</h3>
          {scripts.map((s) => <ScriptCard key={s.id} script={s} onStatus={setStatus} onDelete={remove} />)}
        </section>
      </div>
    </div>
  );
}

function ScriptCard({ script: s, onStatus, onDelete }: { script: Script; onStatus: (id: number, st: string) => void; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const v2 = isSpecV2(s.content) ? s.content : null;
  const failures = v2?.validation.failures.length ?? 0;
  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{v2?.headline || s.title || `Script ${s.id}`}</div>
          <div className="text-xs text-gray-500">
            {s.format} · {s.length_sec}s · {fmtDate(s.created_at)}{s.notes ? ` · "${s.notes}"` : ""}
            {v2 && (failures
              ? <span className="ml-2 rounded bg-red-100 px-1.5 text-red-700">{failures} check{failures > 1 ? "s" : ""} failed</span>
              : <span className="ml-2 rounded bg-green-100 px-1.5 text-green-800">checks passed</span>)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={s.status} onChange={(e) => onStatus(s.id, e.target.value)} className={`rounded px-2 py-1 text-xs ${STATUS_STYLE[s.status] || ""}`}>
            {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          {v2 && (
            <button onClick={() => navigator.clipboard.writeText(scriptToText(v2)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
              className="text-xs text-blue-700 hover:underline">{copied ? "Copied" : "Copy"}</button>
          )}
          <a href={`/video-scripts/read/${s.id}`} target="_blank" className="text-xs text-blue-700 hover:underline">Read view</a>
          <button onClick={() => setExpanded((v) => !v)} className="text-xs text-blue-700 hover:underline">{expanded ? "Collapse" : "Expand"}</button>
          <button onClick={() => onDelete(s.id)} className="text-xs text-red-600 hover:underline">Delete</button>
        </div>
      </div>
      {expanded && (v2 ? <VideoScriptView script={v2} /> : <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(s.content, null, 2)}</pre>)}
    </div>
  );
}
