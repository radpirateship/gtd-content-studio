// app/api/shopify/collections/retire/route.ts
//
// Retire a collection URL behind a 301: unpublish the collection from the
// Online Store channel (Shopify only honours a URL redirect once the path no
// longer resolves to a live page), then create the redirect, then verify the
// storefront actually answers 301 with the expected Location.
//
// Nothing is deleted. The collection keeps its rules, products and body_html
// and can be restored with op: "restore" (re-publish + remove the redirect).
//
// POST /api/shopify/collections/retire
//   { items: [{ handle, target }], confirm?: boolean, op?: "retire" | "restore" }
//
// Without confirm: true this is a DRY RUN. It resolves every handle and
// target, checks for chains and existing redirects, and reports what it
// would do. Nothing is written.
//
// Guard rails:
//   - a target that is itself a source in the same batch is refused (no chains)
//   - a target that does not resolve, or is unpublished, is refused
//   - an existing redirect FROM the source path is refused (inspect it first)
//   - the frozen link-experiment URLs cannot be retired
import { NextRequest, NextResponse } from "next/server";
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];
const STOREFRONT = "https://peakprimalwellness.com";
const FROZEN = new Set(["barrel-saunas", "outdoor-saunas", "hyperbaric-chambers"]);

type Col = { id: number; type: "custom" | "smart"; handle: string; title: string; published: boolean };

async function shopifyFetch(path: string, options: RequestInit = {}) {
  const token = await getShopifyAccessToken();
  const errors: string[] = [];
  for (const version of API_VERSIONS) {
    const url = `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
            ...((options.headers as Record<string, string>) || {}),
          },
        });
        if (res.ok) return { ok: true as const, data: await res.json(), version };
        if (res.status === 429 || res.status >= 500) {
          const wait = Math.min(10, Number(res.headers.get("retry-after")) || 2);
          errors.push(`${version}: ${res.status} (attempt ${attempt + 1}, waiting ${wait}s)`);
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
        const body = await res.text();
        errors.push(`${version}: ${res.status} - ${body.slice(0, 200)}`);
        if (res.status === 401 || res.status === 403) throw new Error(`Shopify auth failed (${res.status})`);
        break;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        break;
      }
    }
  }
  return { ok: false as const, data: null, errors };
}

async function resolveCollection(handle: string): Promise<Col | null> {
  for (const type of ["custom", "smart"] as const) {
    const r = await shopifyFetch(`${type}_collections.json?handle=${encodeURIComponent(handle)}&limit=1`);
    if (!r.ok) continue;
    const list = ((r.data as Record<string, unknown>)[`${type}_collections`] as Array<Record<string, unknown>>) || [];
    const c = list.find((x) => x.handle === handle);
    if (c) {
      return {
        id: Number(c.id),
        type,
        handle,
        title: String(c.title || ""),
        published: c.published_at != null,
      };
    }
  }
  return null;
}

function norm(p: string): string {
  const s = p.trim();
  return s.startsWith("/") ? s.replace(/\/+$/, "") : `/${s}`.replace(/\/+$/, "");
}

async function findRedirect(path: string): Promise<{ id: number; path: string; target: string } | null> {
  const r = await shopifyFetch(`redirects.json?path=${encodeURIComponent(path)}&limit=5`);
  if (!r.ok) return null;
  const list = ((r.data as { redirects?: Array<{ id: number; path: string; target: string }> }).redirects) || [];
  return list.find((x) => norm(x.path) === path) || null;
}

async function storefrontStatus(path: string): Promise<{ status: number; location: string | null }> {
  try {
    const res = await fetch(`${STOREFRONT}${path}`, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 ppw-content-studio retire-check" },
      cache: "no-store",
    });
    return { status: res.status, location: res.headers.get("location") };
  } catch (e) {
    return { status: 0, location: e instanceof Error ? e.message : String(e) };
  }
}

type Item = { handle: string; target: string };
type Report = {
  handle: string;
  target: string;
  path: string;
  targetPath: string;
  plan: string[];
  blockers: string[];
  source?: Col | null;
  destination?: Col | null;
  existingRedirect?: { id: number; path: string; target: string } | null;
  result?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body.items) ? body.items : [];
  const confirm = body.confirm === true;
  const op: "retire" | "restore" = body.op === "restore" ? "restore" : "retire";
  if (items.length === 0) return NextResponse.json({ error: "items[] required: [{ handle, target }]" }, { status: 400 });
  if (items.length > 100) return NextResponse.json({ error: "max 100 items per call" }, { status: 400 });

  const sources = new Set(items.map((i) => String(i.handle || "").trim()));
  const reports: Report[] = [];

  for (const it of items) {
    const handle = String(it.handle || "").trim();
    const target = String(it.target || "").trim();
    const rep: Report = { handle, target, path: `/collections/${handle}`, targetPath: `/collections/${target}`, plan: [], blockers: [] };
    reports.push(rep);
    if (!handle) { rep.blockers.push("empty handle"); continue; }
    if (FROZEN.has(handle)) { rep.blockers.push(`${handle} is a frozen link-experiment URL`); continue; }

    rep.source = await resolveCollection(handle);
    if (!rep.source) { rep.blockers.push("source collection not found on Shopify"); continue; }
    rep.existingRedirect = await findRedirect(rep.path);

    if (op === "restore") {
      rep.plan.push(rep.source.published ? "already published" : "re-publish to Online Store");
      rep.plan.push(rep.existingRedirect ? `delete redirect #${rep.existingRedirect.id} (${rep.existingRedirect.path} -> ${rep.existingRedirect.target})` : "no redirect to delete");
      continue;
    }

    if (!target) { rep.blockers.push("empty target"); continue; }
    if (target === handle) { rep.blockers.push("target equals source"); continue; }
    if (sources.has(target)) { rep.blockers.push(`target ${target} is itself being retired in this batch (would create a chain)`); continue; }
    rep.destination = await resolveCollection(target);
    if (!rep.destination) { rep.blockers.push("destination collection not found on Shopify"); continue; }
    if (!rep.destination.published) { rep.blockers.push("destination is not published to the Online Store"); continue; }
    if (rep.existingRedirect) {
      if (norm(rep.existingRedirect.target) === rep.targetPath && !rep.source.published) {
        rep.plan.push("already retired with the expected redirect (nothing to do)");
      } else {
        rep.blockers.push(`a redirect already exists from ${rep.path} to ${rep.existingRedirect.target} (id ${rep.existingRedirect.id}); remove or inspect it first`);
      }
      continue;
    }
    rep.plan.push(rep.source.published ? "unpublish from Online Store (keeps rules, products and copy)" : "already unpublished");
    rep.plan.push(`create 301 ${rep.path} -> ${rep.targetPath}`);
    rep.plan.push("verify storefront answers 301 with that Location");
  }

  const runnable = reports.filter((r) => r.blockers.length === 0 && !r.plan.some((p) => p.startsWith("already retired")));
  if (!confirm) {
    return NextResponse.json({
      dryRun: true,
      op,
      summary: { items: reports.length, runnable: runnable.length, blocked: reports.length - runnable.length },
      reports,
      next: "Re-send the same body with confirm: true to apply the runnable items.",
    });
  }

  for (const rep of runnable) {
    const result: Record<string, unknown> = {};
    rep.result = result;
    const src = rep.source as Col;
    const key = `${src.type}_collection`;
    if (op === "restore") {
      if (!src.published) {
        const r = await shopifyFetch(`${src.type}_collections/${src.id}.json`, {
          method: "PUT",
          body: JSON.stringify({ [key]: { id: src.id, published: true } }),
        });
        result.republished = r.ok ? true : (r.errors || []).join("; ");
      }
      if (rep.existingRedirect) {
        const r = await shopifyFetch(`redirects/${rep.existingRedirect.id}.json`, { method: "DELETE" });
        result.redirectDeleted = r.ok ? true : (r.errors || []).join("; ");
      }
      continue;
    }

    // 1) unpublish so the path stops resolving
    if (src.published) {
      const r = await shopifyFetch(`${src.type}_collections/${src.id}.json`, {
        method: "PUT",
        body: JSON.stringify({ [key]: { id: src.id, published: false } }),
      });
      if (!r.ok) { result.unpublished = (r.errors || []).join("; ") || "failed"; continue; }
      result.unpublished = true;
    } else {
      result.unpublished = "already";
    }

    // 2) create the redirect
    const cr = await shopifyFetch("redirects.json", {
      method: "POST",
      body: JSON.stringify({ redirect: { path: rep.path, target: rep.targetPath } }),
    });
    if (!cr.ok) { result.redirect = (cr.errors || []).join("; ") || "failed"; continue; }
    const created = (cr.data as { redirect?: { id: number } }).redirect;
    result.redirect = created?.id ?? true;

    // 3) verify on the storefront (allow a few seconds for the unpublish to propagate)
    let check = await storefrontStatus(rep.path);
    for (let i = 0; i < 4 && check.status !== 301 && check.status !== 302; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      check = await storefrontStatus(rep.path);
    }
    result.storefront = check;
    result.verified = (check.status === 301 || check.status === 302) && !!check.location && norm(new URL(check.location, STOREFRONT).pathname) === rep.targetPath;
  }

  return NextResponse.json({
    dryRun: false,
    op,
    summary: {
      applied: runnable.length,
      verified: runnable.filter((r) => r.result?.verified === true).length,
      blocked: reports.length - runnable.length,
    },
    reports,
  });
}
