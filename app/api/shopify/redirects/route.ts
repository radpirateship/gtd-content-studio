/**
 * Shopify URL Redirect Management API
 *
 * GET    /api/shopify/redirects              — list redirects (paginated)
 * GET    /api/shopify/redirects?path=/x      — find redirect for a specific path
 * GET    /api/shopify/redirects?all=true     — fetch all redirects (walks pages)
 * POST   /api/shopify/redirects              — create a single 301 redirect
 * POST   /api/shopify/redirects?bulk=true    — create multiple redirects
 * DELETE /api/shopify/redirects              — remove a redirect by id
 *
 * Uses the Shopify REST Admin API /admin/api/{version}/redirects.json
 * Auth and versioning follow the same pattern as lib/shopify/blog-admin.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getShopifyAccessToken,
  SHOPIFY_ADMIN_DOMAIN,
} from "@/lib/shopifyAuth";

// ── Shopify Admin helpers ──────────────────────────────────────────────

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];

let cachedVersion: string | null = null;

async function getVersion(token: string): Promise<string> {
  if (cachedVersion) return cachedVersion;
  for (const v of API_VERSIONS) {
    const res = await fetch(
      `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/redirects.json?limit=1`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (res.ok) {
      cachedVersion = v;
      return v;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Shopify auth failed (${res.status}) — check SHOPIFY_ACCESS_TOKEN`
      );
    }
  }
  throw new Error("No working Shopify Admin API version found");
}

function adminUrl(version: string, path: string): string {
  return `https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${version}/${path}`;
}

async function adminGet(path: string) {
  const token = await getShopifyAccessToken();
  const version = await getVersion(token);
  const res = await fetch(adminUrl(version, path), {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!res.ok)
    return { ok: false as const, status: res.status, json: null, link: null };
  return {
    ok: true as const,
    status: res.status,
    json: await res.json(),
    link: res.headers.get("link"),
  };
}

async function adminPost(path: string, body: unknown) {
  const token = await getShopifyAccessToken();
  const version = await getVersion(token);
  const res = await fetch(adminUrl(version, path), {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function adminDelete(path: string) {
  const token = await getShopifyAccessToken();
  const version = await getVersion(token);
  const res = await fetch(adminUrl(version, path), {
    method: "DELETE",
    headers: { "X-Shopify-Access-Token": token },
  });
  return { ok: res.ok, status: res.status };
}

/** Extract next page_info cursor from Shopify Link header. */
function nextPageInfo(link: string | null): string | null {
  if (!link) return null;
  const next = link.split(",").find((p) => p.includes('rel="next"'));
  const url = next?.match(/<([^>]+)>/)?.[1];
  try {
    return url ? new URL(url).searchParams.get("page_info") : null;
  } catch {
    return null;
  }
}

/** Small delay helper for bulk operations (Shopify rate limit: ~2 req/s). */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Types ──────────────────────────────────────────────────────────────

type ShopifyRedirect = {
  id: number;
  path: string;
  target: string;
};

type BulkEntry = { path: string; target: string };

type BulkResult = {
  path: string;
  target: string;
  created: boolean;
  redirect?: ShopifyRedirect;
  error?: string;
};

// ── GET handler ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pathFilter = searchParams.get("path");
    const limitParam = searchParams.get("limit");
    const pageInfoParam = searchParams.get("page_info");
    const fetchAll = searchParams.get("all") === "true";

    // Single-path lookup
    if (pathFilter) {
      const r = await adminGet(
        `redirects.json?path=${encodeURIComponent(pathFilter)}`
      );
      if (!r.ok) {
        return NextResponse.json(
          { error: "Shopify API error", status: r.status },
          { status: r.status || 502 }
        );
      }
      const redirects: ShopifyRedirect[] = r.json?.redirects || [];
      return NextResponse.json({ redirects, count: redirects.length });
    }

    // Fetch all redirects (walks every page)
    if (fetchAll) {
      const all: ShopifyRedirect[] = [];
      let cursor: string | null = null;
      do {
        const qs = cursor
          ? `limit=250&page_info=${encodeURIComponent(cursor)}`
          : "limit=250";
        const r = await adminGet(`redirects.json?${qs}`);
        if (!r.ok) break;
        all.push(...(r.json?.redirects || []));
        cursor = nextPageInfo(r.link);
      } while (cursor);
      return NextResponse.json({ redirects: all, count: all.length });
    }

    // Paginated list (single page)
    const limit = Math.min(Number(limitParam) || 50, 250);
    const qs = pageInfoParam
      ? `limit=${limit}&page_info=${encodeURIComponent(pageInfoParam)}`
      : `limit=${limit}`;
    const r = await adminGet(`redirects.json?${qs}`);
    if (!r.ok) {
      return NextResponse.json(
        { error: "Shopify API error", status: r.status },
        { status: r.status || 502 }
      );
    }

    const redirects: ShopifyRedirect[] = r.json?.redirects || [];
    const next = nextPageInfo(r.link);

    return NextResponse.json({
      redirects,
      count: redirects.length,
      ...(next ? { next_page_info: next } : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── POST handler ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const isBulk = searchParams.get("bulk") === "true";
    const body = await req.json();

    if (isBulk) {
      return handleBulkCreate(body);
    }

    return handleSingleCreate(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function normalizePath(p: string): string {
  return p.startsWith("/") ? p : `/${p}`;
}

async function handleSingleCreate(body: {
  path?: string;
  target?: string;
}) {
  const { path, target } = body;

  if (!path || !target) {
    return NextResponse.json(
      { error: "Both `path` and `target` are required" },
      { status: 400 }
    );
  }

  const r = await adminPost("redirects.json", {
    redirect: { path: normalizePath(path), target: normalizePath(target) },
  });

  if (!r.ok) {
    return NextResponse.json(
      {
        error: "Failed to create redirect",
        shopify_status: r.status,
        details: r.json?.errors || r.json,
      },
      { status: r.status || 502 }
    );
  }

  return NextResponse.json({ redirect: r.json?.redirect, created: true });
}

async function handleBulkCreate(body: { redirects?: BulkEntry[] }) {
  const entries = body.redirects;

  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json(
      {
        error:
          "Body must include `redirects` array of { path, target } objects",
      },
      { status: 400 }
    );
  }

  if (entries.length > 500) {
    return NextResponse.json(
      { error: "Maximum 500 redirects per bulk request" },
      { status: 400 }
    );
  }

  const results: BulkResult[] = [];

  for (const entry of entries) {
    if (!entry.path || !entry.target) {
      results.push({
        path: entry.path || "",
        target: entry.target || "",
        created: false,
        error: "Missing path or target",
      });
      continue;
    }

    const cleanPath = normalizePath(entry.path);
    const cleanTarget = normalizePath(entry.target);

    const r = await adminPost("redirects.json", {
      redirect: { path: cleanPath, target: cleanTarget },
    });

    if (r.ok) {
      results.push({
        path: cleanPath,
        target: cleanTarget,
        created: true,
        redirect: r.json?.redirect,
      });
    } else {
      results.push({
        path: cleanPath,
        target: cleanTarget,
        created: false,
        error:
          JSON.stringify(r.json?.errors || r.json) ||
          `Shopify returned ${r.status}`,
      });
    }

    // Throttle to stay under Shopify's 2 req/s REST rate limit
    await sleep(550);
  }

  const created = results.filter((r) => r.created).length;
  const failed = results.length - created;

  return NextResponse.json({ results, created, failed, total: results.length });
}

// ── DELETE handler ─────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { id } = body as { id?: number };

    if (!id) {
      return NextResponse.json(
        { error: "`id` (Shopify redirect ID) is required" },
        { status: 400 }
      );
    }

    const r = await adminDelete(`redirects/${id}.json`);
    if (!r.ok) {
      return NextResponse.json(
        { error: "Failed to delete redirect", shopify_status: r.status },
        { status: r.status || 502 }
      );
    }

    return NextResponse.json({ deleted: true, id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
