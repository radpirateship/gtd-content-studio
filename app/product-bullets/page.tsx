"use client";

/**
 * /product-bullets — regenerate product card bullets per product, review, apply.
 *
 * Workflow:
 *   1. Inventory  — sweeps Shopify into the pb_* index tables (resumable, driven
 *                   by the loop below), then reads the summary. No AI, no writes
 *                   to the store.
 *   2. Draft All  — 2 short specs per product from its own Shopify data. Batched
 *                   and resumable; the service bullet is added at apply time.
 *   3. Review     — edit any bullet inline, then Approve. NOTHING reaches the
 *                   live store until a product is approved.
 *   4. Apply      — rewrite every card backed by an approved product. Progress
 *                   is tracked server-side, so a refresh mid-run resumes.
 *
 * Claim removal and the service-bullet rename across ALL cards live in
 * /bullet-audit. Run that once at the end.
 */

import { useEffect, useMemo, useState } from "react";

type InvItem = {
  handle: string;
  title: string;
  cards: number;
  templateCards: number;
  bespokeCards: number;
  articles: number;
  inCatalog: boolean;
  hasDescription: boolean;
  hasBullets: boolean;
};

type Inventory = {
  needsScan: boolean;
  needsCatalog: boolean;
  catalogSize: number;
  articlesScanned: number;
  totalCards: number;
  templateCards: number;
  protectedCards: number;
  uniqueProducts: number;
  inCatalog: number;
  missingFromCatalog: string[];
  thinDescription: number;
  alreadyDrafted: number;
  fullyBespoke: number;
  toDraft: number;
  items: InvItem[];
};

type StoredBullet = {
  handle: string;
  title: string | null;
  bullets: string[];
  source: string;
  status: string;
  card_count: number | null;
  notes: string | null;
};

type Broken = {
  handle: string;
  looksLikeHandle: boolean;
  fault: string;
  cards: number;
  suggestions: { handle: string; title: string; product_type: string; vendor: string; score: number }[];
  articles: { articleId: number; blogHandle: string; handle: string; title: string }[];
  samples: { cardTitle: string; rawHref: string; bullets: string[] }[];
};

type Applied = {
  articleId?: number;
  handle: string;
  title: string;
  rewritten: number;
  removed: number;
  protectedCards?: number;
  ok: boolean;
  error?: string;
};

const API = "/api/maintenance/product-bullets";

async function post(payload: Record<string, unknown>) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function ProductBulletsPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [stored, setStored] = useState<StoredBullet[]>([]);
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [applyLog, setApplyLog] = useState<Applied[]>([]);
  const [progress, setProgress] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "draft" | "approved" | "needs_input">("all");
  const [restored, setRestored] = useState(false);
  const [broken, setBroken] = useState<Broken[]>([]);
  const [swapTo, setSwapTo] = useState<Record<string, string>>({});
  const [swapLog, setSwapLog] = useState<string[]>([]);

  /**
   * Rehydrate from the server on mount.
   *
   * Drafts live in product_bullets and approvals are saved server-side the
   * moment they are clicked, so a tab reload, a crash, or Chrome discarding the
   * page loses nothing but the on-screen copy. Reading it back automatically
   * means the review list is simply there, rather than the page looking empty
   * and implying the work was lost. Pure DB reads: no Shopify sweep, no AI.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const i: Inventory = await post({ mode: "inventory" });
        if (cancelled) return;
        if (!i.needsScan) setInv(i);
        const data = await post({ mode: "list" });
        if (cancelled) return;
        const items: StoredBullet[] = (data.items || []).map((r: StoredBullet) => ({
          ...r,
          bullets: Array.isArray(r.bullets) ? r.bullets : [],
        }));
        setStored(items);
        setEdits(Object.fromEntries(items.map((it) => [it.handle, [...it.bullets]])));
        if (items.length > 0) setRestored(true);
      } catch {
        // First visit before the tables exist, or a transient blip. The buttons
        // still work, so fail quiet rather than showing an alarming error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Index the store into Postgres, then read the summary back.
   *
   * The Shopify sweeps used to run inside every request and blew past the 60s
   * function limit, which surfaced as a JSON parse error because Vercel
   * returned an HTML timeout page. They are now resumable: each call works to a
   * wall-clock budget and hands back a cursor, and this loop drives it to
   * completion.
   */
  async function indexStore(force = false) {
    setBusy("inventory");
    setError(null);
    try {
      const probe: Inventory = await post({ mode: "inventory" });
      if (force || probe.needsScan) {
        let cursor: unknown = null;
        let pass = 0;
        do {
          const r = await post({ mode: "scan", cursor });
          cursor = r.done ? null : r.cursor;
          setProgress(
            `Indexing articles: ${r.indexedArticles} with product cards, ${r.indexedCards} cards` +
              (r.done ? "" : " ...")
          );
          if (++pass > 60) break;
        } while (cursor);
      }
      if (force || probe.needsCatalog) {
        let cursor: string | null = null;
        let pass = 0;
        do {
          const r = await post({ mode: "catalog", cursor });
          cursor = r.done ? null : r.cursor;
          setProgress(`Indexing catalog: ${r.catalogSize} products` + (r.done ? "" : " ..."));
          if (++pass > 60) break;
        } while (cursor);
      }
      setInv(await post({ mode: "inventory" }));
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  async function refreshList() {
    const data = await post({ mode: "list" });
    const items: StoredBullet[] = (data.items || []).map((r: StoredBullet) => ({
      ...r,
      bullets: Array.isArray(r.bullets) ? r.bullets : [],
    }));
    setStored(items);
    setEdits(Object.fromEntries(items.map((i) => [i.handle, [...i.bullets]])));
  }

  /**
   * Draft in batches until the server reports nothing left.
   *
   * Tolerant by design: a single failed batch (AI timeout, a 529, a transient
   * network blip) retries a few times and then moves on rather than ending the
   * run. Every successful draft is already committed to product_bullets, so
   * stopping and restarting never loses work.
   */
  async function draftAll(): Promise<boolean> {
    setBusy("draft");
    setError(null);
    let done = 0;
    let strikes = 0;
    try {
      for (let pass = 0; pass < 400; pass++) {
        let data: { drafted?: unknown[]; remaining?: number } | null = null;
        try {
          data = await post({ mode: "draft", batchSize: 8 });
          strikes = 0;
        } catch (e) {
          if (++strikes >= 4) {
            setError(
              `Drafting stopped after 4 consecutive failures: ${e instanceof Error ? e.message : String(e)}. Everything drafted so far is saved. Click Draft All again to resume.`
            );
            break;
          }
          setProgress(`Batch failed, retrying (${strikes}/4)...`);
          await new Promise((r) => setTimeout(r, 4000 * strikes));
          continue;
        }
        const batch = (data?.drafted || []).length;
        done += batch;
        const remaining = data?.remaining ?? 0;
        setProgress(`Drafted ${done}, ${remaining} products remaining`);
        if (batch === 0 || remaining === 0) break;
      }
      await refreshList();
      return true;
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  /**
   * Unattended run: index the store, then draft every product that needs it.
   *
   * Deliberately stops before Approve and Apply. Drafting is the long, expensive
   * part and writes NOTHING to the live store, so it is safe to leave running.
   * Approving and applying change published articles and should happen with
   * someone looking at them.
   */
  async function runUnattended() {
    if (
      !window.confirm(
        "Index the store and draft bullets for every product that needs them?\n\nThis writes nothing to the live site. It stops before Approve and Apply so you can review in the morning.\n\nKeep this tab open and stop the machine from sleeping."
      )
    )
      return;
    await indexStore(false);
    await draftAll();
    setProgress("Drafting finished. Review, approve, then apply when you are ready.");
  }

  async function approve(handle: string) {
    const bullets = (edits[handle] || []).map((b) => b.trim()).filter(Boolean);
    if (bullets.length < 1) {
      setError(`${handle}: needs at least 1 product spec before it can be approved`);
      return;
    }
    setError(null);
    try {
      await post({ mode: "save", handle, bullets });
      setStored((prev) =>
        prev.map((s) => (s.handle === handle ? { ...s, bullets, status: "approved", source: "manual" } : s))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Approve every clean draft in one server-side statement.
   *
   * needs_input rows are left alone by design: those are the products whose
   * Shopify description did not yield two verifiable specs, so they want a
   * human rather than a blanket approval.
   */
  async function approveAllDrafts() {
    const drafts = stored.filter((s) => s.status === "draft").length;
    const thin = stored.filter((s) => s.status === "needs_input").length;
    if (!drafts) return;
    if (
      !window.confirm(
        `Approve ${drafts} drafted product(s) as written?\n\n` +
          `${thin} product(s) at "needs input" will be left alone.\n\n` +
          `Nothing is published by this step. You still have to click Apply.`
      )
    )
      return;
    setBusy("approve");
    setError(null);
    try {
      const r = await post({ mode: "approve-all" });
      setProgress(
        `Approved ${r.approvedNow}. ${r.totalApproved} products approved covering ${r.cardsCovered} cards. ${r.leftNeedsInput} left at needs input.`
      );
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyAll() {
    const approved = stored.filter((s) => s.status === "approved").length;
    if (!approved) {
      setError("Nothing approved yet. Approve at least one product before applying.");
      return;
    }
    if (
      !window.confirm(
        `Rewrite article cards using ${approved} approved product(s)? This writes to the live store.`
      )
    )
      return;
    setBusy("apply");
    setError(null);
    setApplyLog([]);
    try {
      // The server marks each article applied in pb_article_index, so a refresh
      // mid-run resumes cleanly and later approvals re-queue only what they
      // affect. Loop until it reports nothing left.
      let guard = 0;
      for (;;) {
        const data = await post({ mode: "apply", batchSize: 10 });
        const processed: Applied[] = data.processed || [];
        setApplyLog((prev) => [...prev, ...processed]);
        setProgress(`${data.remaining} articles remaining`);
        if (data.done || processed.length === 0 || ++guard > 300) break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  /**
   * Diagnose card links whose handle is not in the catalog. Read-only.
   *
   * Always reports an outcome. A silent no-op is indistinguishable from a
   * broken button, and "nothing is broken" reads the same as "nothing is
   * indexed" unless the server tells us which.
   */
  async function loadBroken() {
    setBusy("broken");
    setError(null);
    setProgress("");
    try {
      const r = await post({ mode: "broken" });
      setBroken(r.items || []);
      if (r.needsIndex) {
        setError(
          `Nothing to check: ${r.indexedProducts} products indexed, ${r.catalogSize} in the catalog snapshot. Click Inventory first to rebuild the index, then try again.`
        );
      } else if (!(r.items || []).length) {
        setProgress(
          `No broken product links. Checked ${r.indexedProducts} products on cards against ${r.catalogSize} catalog products.`
        );
      } else {
        setProgress(
          `${r.count} broken link(s) across ${r.indexedProducts} indexed products.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Repoint every card for a dead handle at a live product.
   *
   * Always previews first. The dry pass reports how many cards would change
   * without writing, which is the only way to catch a wrong target handle
   * before it lands on published articles.
   */
  async function swap(from: string) {
    const to = (swapTo[from] || "").trim();
    if (!to) {
      setError(`Pick a replacement product for "${from}" first.`);
      return;
    }
    setBusy("swap");
    setError(null);
    try {
      const preview = await post({ mode: "swap", from, to, dry: true });
      const ok = window.confirm(
        `Preview\n\n` +
          `Replace: ${from}\n` +
          `With: ${preview.replacement.title} (${preview.to})\n` +
          `Price: ${preview.replacement.price ? "$" + preview.replacement.price : "none, the price line will be removed"}\n` +
          `Image: ${preview.replacement.hasImage ? "yes" : "no, the old image stays"}\n` +
          `Bullets: ${preview.replacement.usedCuratedBullets ? "curated" : "none stored, existing bullets stay"}\n\n` +
          `${preview.cardsSwapped} card(s) across ${preview.articles} article(s) would change.\n\nWrite this to the live store?`
      );
      if (!ok) {
        setSwapLog((p) => [...p, `PREVIEW ONLY ${from} -> ${preview.to}: ${preview.cardsSwapped} card(s), not written`]);
        return;
      }
      const r = await post({ mode: "swap", from, to, dry: false });
      setSwapLog((p) => [
        ...p,
        `OK ${from} -> ${r.to}: ${r.cardsSwapped} card(s) across ${r.processed.length} article(s)`,
        ...(r.processed || [])
          .filter((x: { ok: boolean }) => !x.ok)
          .map((x: { handle: string; error: string }) => `ERR ${x.handle}: ${x.error}`),
      ]);
      await loadBroken();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function editBullet(handle: string, idx: number, value: string) {
    setEdits((prev) => {
      const next = [...(prev[handle] || [])];
      next[idx] = value;
      return { ...prev, [handle]: next };
    });
  }

  const counts = useMemo(() => {
    const c = { draft: 0, approved: 0, needs_input: 0 };
    for (const s of stored) if (s.status in c) c[s.status as keyof typeof c]++;
    return c;
  }, [stored]);

  const visible = useMemo(
    () => (filter === "all" ? stored : stored.filter((s) => s.status === filter)),
    [stored, filter]
  );

  const cardsCovered = useMemo(
    () => stored.filter((s) => s.status === "approved").reduce((n, s) => n + (s.card_count || 0), 0),
    [stored]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Product Card Bullets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Replaces the generic template bullets with three short specs drawn from each product&apos;s own
          Shopify data. Work is keyed by product, not by card, so one draft covers every article that
          features it. Nothing reaches the live store until a product is approved.
        </p>
        <p className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900">
          <strong>Run Index + Draft</strong> does the long part and touches nothing on the live
          site. Leave it running. Progress is saved server-side after every batch, so closing the
          tab or losing the connection costs at most one batch. Approve and Apply are the steps
          that change published articles, and they stay manual.
        </p>
        <p className="mt-2 rounded-md border border-green-300 bg-green-50 p-2 text-sm text-green-900">
          Cards whose bullets are already product-specific are left exactly as written. They are
          detected by comparing each bullet against the full list of labels the old regex generators
          could produce, so anything a human or the long-form route wrote is protected. Those cards
          still get the flagged phrases stripped, and nothing else about them changes.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={runUnattended}
          disabled={!!busy}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          title="Index + draft everything. Writes nothing to the live site."
        >
          {busy ? "Running..." : "Run Index + Draft (safe to leave)"}
        </button>
        <button
          onClick={() => indexStore(false)}
          disabled={!!busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "inventory" ? "Indexing..." : "1. Inventory"}
        </button>
        <button
          onClick={() => indexStore(true)}
          disabled={!!busy}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          title="Re-sweep Shopify from scratch. Use after publishing or editing articles."
        >
          Re-index
        </button>
        <button
          onClick={draftAll}
          disabled={!!busy || !inv}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === "draft" ? "Drafting..." : `2. Draft All${inv ? ` (${inv.toDraft})` : ""}`}
        </button>
        <button
          onClick={approveAllDrafts}
          disabled={!!busy || counts.draft === 0}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === "approve" ? "Approving..." : `3. Approve All Drafts (${counts.draft})`}
        </button>
        <button
          onClick={loadBroken}
          disabled={!!busy}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          title="Find card links whose product no longer exists. Read-only."
        >
          {busy === "broken" ? "Checking..." : "Check broken links"}
        </button>
        <button
          onClick={applyAll}
          disabled={!!busy || counts.approved === 0}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy === "apply" ? "Applying..." : `4. Apply to Articles (${counts.approved})`}
        </button>
      </div>

      {restored && !busy && (
        <p className="rounded-md border border-sky-300 bg-sky-50 p-2 text-sm text-sky-900">
          Restored from the server. Drafts and approvals are stored in Postgres, not in this tab, so
          reloading or crashing never loses them.
        </p>
      )}
      {progress && <p className="text-sm text-blue-700">{progress}</p>}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      {inv && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Articles indexed", inv.articlesScanned],
            ["Product cards", inv.totalCards],
            ["Generic, to regenerate", inv.templateCards],
            ["Already good, protected", inv.protectedCards],
            ["Unique products", inv.uniqueProducts],
            ["Products to draft", inv.toDraft],
            ["Not in catalog", inv.missingFromCatalog.length],
            ["Cards covered by approvals", cardsCovered],
            ["Catalog size", inv.catalogSize],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}

      {inv && inv.missingFromCatalog.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{inv.missingFromCatalog.length} product handle(s) on cards no longer exist in the catalog.</strong>{" "}
          Those cards link to a dead product page, so they are worth fixing separately:{" "}
          <span className="font-mono text-xs">{inv.missingFromCatalog.slice(0, 15).join(", ")}</span>
          {inv.missingFromCatalog.length > 15 && ` and ${inv.missingFromCatalog.length - 15} more`}
        </div>
      )}

      {stored.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Review</h2>
            {(["all", "draft", "approved", "needs_input"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  filter === f ? "bg-gray-900 text-white" : "hover:bg-gray-50"
                }`}
              >
                {f === "all" ? `All (${stored.length})` : `${f.replace("_", " ")} (${counts[f] ?? 0})`}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {visible.slice(0, 500).map((s) => (
              <div key={s.handle} className="rounded-md border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a
                    href={`https://peakprimalwellness.com/products/${s.handle}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {s.title || s.handle}
                  </a>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{s.card_count ?? 0} cards</span>
                    <span
                      className={
                        s.status === "approved"
                          ? "font-medium text-green-700"
                          : s.status === "needs_input"
                            ? "font-medium text-amber-700"
                            : "text-gray-600"
                      }
                    >
                      {s.status}
                    </span>
                    <button
                      onClick={() => approve(s.handle)}
                      disabled={!!busy}
                      className="rounded border px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {s.status === "approved" ? "Re-save" : "Approve"}
                    </button>
                  </div>
                </div>
                {s.notes && <div className="mt-1 text-xs text-amber-800">{s.notes}</div>}
                <div className="mt-2 space-y-1">
                  {[0, 1].map((i) => (
                    <input
                      key={i}
                      value={(edits[s.handle] || [])[i] ?? ""}
                      onChange={(e) => editBullet(s.handle, i, e.target.value)}
                      placeholder={i === 0 ? "Spec 1 (required)" : "Spec 2 (recommended)"}
                      className="w-full rounded border px-2 py-1 text-sm"
                    />
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Plus &ldquo;Ongoing US-Based Phone Support&rdquo;, added automatically.
                  </p>
                </div>
              </div>
            ))}
          </div>
          {visible.length > 500 && (
            <p className="text-sm text-muted-foreground">
              Showing the first 500 of {visible.length}. Narrow with the filters above.
            </p>
          )}
        </div>
      )}

      {broken.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Broken product links ({broken.length})</h2>
          <p className="text-sm text-muted-foreground">
            Preview runs first on every swap. Only the card fields change: link, title, image,
            price, bullets and button label. The badge and grid position stay, because the badge
            encodes price rank within the article.
          </p>
          {broken.map((b) => (
            <div key={b.handle} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <code className="break-all font-medium">{b.handle}</code>
                <span className="text-xs text-muted-foreground">
                  {b.cards} card(s), {b.articles.length} article(s)
                </span>
              </div>
              <div
                className={`mt-1 text-xs ${b.looksLikeHandle ? "text-amber-800" : "text-red-700"}`}
              >
                {b.fault}
              </div>
              {b.samples[0] && (
                <div className="mt-1 font-mono text-xs text-gray-600">
                  card title: {b.samples[0].cardTitle || "(none)"} | href: {b.samples[0].rawHref}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  list={`sug-${b.handle}`}
                  value={swapTo[b.handle] ?? ""}
                  onChange={(e) => setSwapTo((p) => ({ ...p, [b.handle]: e.target.value }))}
                  placeholder="replacement product handle"
                  className="min-w-[22rem] flex-1 rounded border px-2 py-1 text-sm"
                />
                <datalist id={`sug-${b.handle}`}>
                  {b.suggestions.map((sg) => (
                    <option key={sg.handle} value={sg.handle}>
                      {sg.title}
                    </option>
                  ))}
                </datalist>
                <button
                  onClick={() => swap(b.handle)}
                  disabled={!!busy}
                  className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Preview and swap
                </button>
              </div>
              {b.suggestions.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  suggested: {b.suggestions.map((sg) => sg.handle).join(", ")}
                </div>
              )}
              <div className="mt-1 text-xs text-gray-600">
                in:{" "}
                {b.articles.slice(0, 4).map((a, i) => (
                  <span key={a.articleId}>
                    {i > 0 && ", "}
                    <a
                      href={`https://peakprimalwellness.com/blogs/${a.blogHandle}/${a.handle}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {a.handle}
                    </a>
                  </span>
                ))}
                {b.articles.length > 4 && ` and ${b.articles.length - 4} more`}
              </div>
            </div>
          ))}
        </div>
      )}

      {swapLog.length > 0 && (
        <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-md border bg-gray-50 p-3 font-mono text-xs">
          {swapLog.map((l, i) => (
            <div key={i} className={l.startsWith("ERR") ? "text-red-700" : "text-green-800"}>
              {l}
            </div>
          ))}
        </div>
      )}

      {applyLog.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Apply log</h2>
          <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border bg-gray-50 p-3 font-mono text-xs">
            {applyLog.map((p, i) => (
              <div key={i} className={p.ok ? "text-green-800" : "text-red-700"}>
                {p.ok
                  ? `OK  ${p.handle}: ${p.rewritten} rewritten, ${p.protectedCards ?? 0} left as written, ${p.removed} flagged bullet(s) removed`
                  : `ERR ${p.handle}: ${p.error}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
