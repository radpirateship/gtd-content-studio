// lib/shopify/collection-seo.ts
// Read and write a collection's SEO title and description, which Shopify keeps
// as the global.title_tag / global.description_tag metafields. Shared by the
// keyword audit; the revamp route has its own copy of the same logic.
import { getShopifyAccessToken, SHOPIFY_ADMIN_DOMAIN } from "@/lib/shopifyAuth";

const API_VERSIONS = ["2024-10", "2024-07", "2024-04", "2024-01"];

async function shopifyFetch(path: string, options: RequestInit = {}) {
  const token = await getShopifyAccessToken();
  let last = "";
  for (const v of API_VERSIONS) {
    let res: Response | null = null;
    // Shopify REST leaks 2 calls/s; a bulk push hits 429, so wait for Retry-After and try again.
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(`https://${SHOPIFY_ADMIN_DOMAIN}/admin/api/${v}/${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token, ...((options.headers as Record<string, string>) || {}) },
      });
      if (res.status !== 429) break;
      const wait = Math.min(10, Number(res.headers.get("Retry-After") || 2)) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }
    if (!res) continue;
    if (res.ok) return { ok: true as const, data: (await res.json()) as Record<string, any> };
    last = `${res.status}: ${(await res.text()).slice(0, 200)}`;
    if ([401, 403, 404, 422, 429].includes(res.status)) break;
  }
  return { ok: false as const, data: null, error: last };
}

export async function resolveCollectionId(handle: string): Promise<{ id: number; type: "custom" | "smart"; title: string } | null> {
  for (const type of ["custom", "smart"] as const) {
    const r = await shopifyFetch(`${type}_collections.json?handle=${encodeURIComponent(handle)}&limit=1`);
    if (!r.ok) continue;
    const list = (r.data[`${type}_collections`] as Array<{ id: number; handle: string; title: string }>) || [];
    const c = list.find((x) => x.handle === handle);
    if (c) return { id: c.id, type, title: c.title };
  }
  return null;
}

export async function readCollectionSeo(id: number): Promise<{ title_tag: string | null; description_tag: string | null }> {
  const r = await shopifyFetch(`collections/${id}/metafields.json?namespace=global&limit=50`);
  const out = { title_tag: null as string | null, description_tag: null as string | null };
  if (!r.ok) return out;
  for (const m of (r.data.metafields as Array<{ key: string; value: string }>) || []) {
    if (m.key === "title_tag") out.title_tag = m.value;
    if (m.key === "description_tag") out.description_tag = m.value;
  }
  return out;
}

export async function upsertCollectionSeoField(id: number, key: "title_tag" | "description_tag", value: string): Promise<string | null> {
  const existing = await shopifyFetch(`collections/${id}/metafields.json?namespace=global&key=${key}`);
  const mf = existing.ok ? ((existing.data.metafields as Array<{ id: number }>) || [])[0] : null;
  if (mf?.id) {
    const r = await shopifyFetch(`metafields/${mf.id}.json`, { method: "PUT", body: JSON.stringify({ metafield: { id: mf.id, value, type: "single_line_text_field" } }) });
    return r.ok ? null : r.error || "update failed";
  }
  const r = await shopifyFetch(`collections/${id}/metafields.json`, { method: "POST", body: JSON.stringify({ metafield: { namespace: "global", key, value, type: "single_line_text_field" } }) });
  return r.ok ? null : r.error || "create failed";
}

/** Replace a collection's body_html (custom or smart). Returns an error string or null. */
export async function updateCollectionBody(id: number, type: "custom" | "smart", bodyHtml: string): Promise<string | null> {
  const r = await shopifyFetch(`${type}_collections/${id}.json`, { method: "PUT", body: JSON.stringify({ [`${type}_collection`]: { id, body_html: bodyHtml } }) });
  return r.ok ? null : r.error || "body update failed";
}
