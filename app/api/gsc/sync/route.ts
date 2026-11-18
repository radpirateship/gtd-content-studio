// POST /api/gsc/sync
// Pulls per-page Search Console metrics (clicks, impressions, CTR, position)
// DIRECTLY from Google Search Console via a service account, and upserts them
// into blog_posts (keyed by article slug) so the Revamp backlog can rank and
// flag title/meta-rewrite and content-refresh candidates.
//
// Zero external deps: signs the service-account JWT with Node's built-in crypto.
//
// Required env (see content-brain-build-summary / GSC setup notes):
//   GOOGLE_SERVICE_ACCOUNT_JSON  — the full service-account key JSON (one line)
//   GSC_SITE_URL                 — e.g. "sc-domain:peakprimalwellness.com"
//                                  or "https://peakprimalwellness.com/"
import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import crypto from "crypto";

export const runtime = "nodejs";
export const maxDuration = 120;

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

// Normalize a private key pasted into an env var into valid PEM:
// strips wrapping quotes, converts \\n and \n escapes and CRLF into real newlines.
export function normalizePrivateKey(raw: string): string {
  let k = (raw || "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  k = k.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return k.trim();
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const pem = normalizePrivateKey(sa.private_key);
  if (!pem.includes("BEGIN") || !pem.includes("PRIVATE KEY")) {
    throw new Error(
      `Private key isn't valid PEM (no BEGIN PRIVATE KEY marker). len=${pem.length}, newlines=${(pem.match(/\n/g) || []).length}, startsWith="${pem.slice(0, 27)}"`
    );
  }
  let signature: string;
  try {
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signature = b64url(signer.sign(pem));
  } catch (e) {
    throw new Error(
      `Key sign failed (${e instanceof Error ? e.message : "unknown"}). len=${pem.length}, newlines=${(pem.match(/\n/g) || []).length}, startsWith="${pem.slice(0, 27)}", endsWith="${pem.slice(-25)}"`
    );
  }
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(j).slice(0, 200)}`);
  }
  return j.access_token as string;
}

function slugFromUrl(u: string): string | null {
  try {
    const parts = new URL(u).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const site = process.env.GSC_SITE_URL;
    if (!site) return NextResponse.json({ error: "GSC_SITE_URL not set in Vercel env." }, { status: 400 });

    // Flexible credential resolution. Any of these work:
    //  - GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_KEY (key = raw PEM)
    //  - GOOGLE_SERVICE_ACCOUNT_KEY = the FULL service-account JSON file
    //  - GOOGLE_SERVICE_ACCOUNT_JSON = the full JSON file
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    const fromJson = (s: string): ServiceAccount | null => {
      try {
        const o = JSON.parse(s);
        if (o?.private_key) {
          return { client_email: o.client_email || email || "", private_key: o.private_key, token_uri: o.token_uri };
        }
      } catch {
        /* not JSON */
      }
      return null;
    };

    let sa: ServiceAccount | null = null;
    if (key && key.trim().startsWith("{")) {
      sa = fromJson(key); // KEY var actually holds the whole JSON file
    } else if (email && key) {
      sa = { client_email: email, private_key: key };
    } else if (json) {
      sa = fromJson(json);
    }

    if (!sa || !sa.private_key) {
      return NextResponse.json(
        {
          error:
            "Could not read service-account credentials. Set GOOGLE_SERVICE_ACCOUNT_KEY to the full JSON file (or to the raw private key plus GOOGLE_SERVICE_ACCOUNT_EMAIL).",
        },
        { status: 400 }
      );
    }

    const token = await getAccessToken(sa);

    const body = await request.json().catch(() => ({}));
    const days = Number(body.days) || 90;
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const queryUrl = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
    const gscRes = await fetch(queryUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: fmt(start),
        endDate: fmt(end),
        dimensions: ["page"],
        rowLimit: 25000,
      }),
    });
    const gsc = await gscRes.json().catch(() => ({}));
    if (!gscRes.ok) {
      return NextResponse.json(
        { error: `GSC query failed (${gscRes.status}): ${JSON.stringify(gsc).slice(0, 300)}` },
        { status: 500 }
      );
    }

    const rows: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }> =
      gsc.rows || [];

    const sql = getSQL();
    let upserted = 0;
    let skipped = 0;
    for (const r of rows) {
      const pageUrl = r.keys?.[0];
      if (!pageUrl || !/\/blogs\//.test(pageUrl)) { skipped++; continue; }
      const slug = slugFromUrl(pageUrl);
      if (!slug) { skipped++; continue; }
      await sql`
        INSERT INTO blog_posts (slug, url, clicks, impressions, ctr, position)
        VALUES (
          ${slug}, ${pageUrl}, ${Math.round(r.clicks || 0)}, ${Math.round(r.impressions || 0)},
          ${r.ctr || 0}, ${r.position || 0}
        )
        ON CONFLICT (slug) DO UPDATE SET
          url = EXCLUDED.url,
          clicks = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions,
          ctr = EXCLUDED.ctr,
          position = EXCLUDED.position
      `;
      upserted++;
    }

    return NextResponse.json({
      ok: true,
      totalRows: rows.length,
      upserted,
      skipped,
      range: { start: fmt(start), end: fmt(end), days },
      message: `Synced ${upserted} article pages from Search Console (${fmt(start)} → ${fmt(end)}).`,
    });
  } catch (err) {
    console.error("[gsc/sync]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "GSC sync failed" }, { status: 500 });
  }
}
