// lib/gsc-client.ts
// Shared Google Search Console client for audit and reporting routes.
// Signs the service-account JWT with Node's built-in crypto, mirroring
// app/api/gsc/sync. Reads the same env vars, in the same priority order:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_KEY (raw PEM)
//   GOOGLE_SERVICE_ACCOUNT_KEY = full service-account JSON
//   GOOGLE_SERVICE_ACCOUNT_JSON = full service-account JSON
//   GSC_SITE_URL = "sc-domain:greenthumbdepot.com" or a URL prefix
import crypto from "crypto";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function normalizePrivateKey(raw: string): string {
  let k = (raw || "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  k = k.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return k.trim();
}

export function resolveServiceAccount(): ServiceAccount | null {
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

  if (key && key.trim().startsWith("{")) return fromJson(key);
  if (email && key) return { client_email: email, private_key: key };
  if (json) return fromJson(json);
  return null;
}

export async function getGscAccessToken(sa: ServiceAccount): Promise<string> {
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
    throw new Error("Service-account private key is not valid PEM.");
  }
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = b64url(signer.sign(pem));
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

export type GscRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

export async function queryGsc(options: {
  dimensions: string[];
  days: number;
  rowLimit?: number;
  startRow?: number;
}): Promise<{ rows: GscRow[] }> {
  const site = process.env.GSC_SITE_URL;
  if (!site) throw new Error("GSC_SITE_URL not set.");
  const sa = resolveServiceAccount();
  if (!sa) throw new Error("Could not read service-account credentials from env.");
  const token = await getGscAccessToken(sa);

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - options.days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: options.dimensions,
      rowLimit: options.rowLimit ?? 25000,
      startRow: options.startRow ?? 0,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GSC query failed (${res.status}): ${JSON.stringify(j).slice(0, 300)}`);
  }
  return { rows: j.rows || [] };
}
