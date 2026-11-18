import { NextRequest, NextResponse } from "next/server";
import { bearerFrom, configuredBotToken, tokenMatches } from "@/lib/bot-auth";

/**
 * Site-wide password gate. Every page and API route requires the gtd-auth
 * cookie except /login and /api/auth. The cookie value is an HMAC-style hash
 * of SITE_PASSWORD so it cannot be forged by simply setting "authenticated".
 *
 * SITE_PASSWORD must be set in Vercel env vars. There is intentionally NO
 * fallback password. If unset, the app stays locked and /login explains why.
 *
 * API-key path: requests to /api/content-brain/* may alternatively present
 * an `x-api-key` header matching CONTENT_BRAIN_API_KEY. This lets trusted
 * automation (Claude sessions pushing brainstorm rows to ideas/bulk-csv,
 * pulling rows for dedupe) hit the Content Brain API without a browser
 * cookie. Scoped to content-brain routes only; if the env var is unset,
 * the path is disabled and cookie auth remains the only way in.
 *
 * Bot path: requests to /api/bot/* may present `Authorization: Bearer <token>`
 * matching BOT_API_TOKEN (or CONTENT_STUDIO_BOT_TOKEN). Read-only product and
 * image reads for external agents (Grok Bot, GTD - Email). Scoped to /api/bot/
 * only; unset env var disables it. Everything else stays cookie-only.
 */

async function expectedToken(): Promise<string | null> {
  const pw = process.env.SITE_PASSWORD;
  if (!pw) return null;
  const data = new TextEncoder().encode(`gtd-v2:${pw}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time-ish comparison: hash both sides so string length and
// early-mismatch timing reveal nothing about the stored key.
async function apiKeyMatches(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public: login page, auth endpoint, static assets
  if (
    pathname === "/login" ||
    pathname === "/api/auth" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg"
  ) {
    return NextResponse.next();
  }

  const expected = await expectedToken();
  const cookie = request.cookies.get("gtd-auth")?.value;

  if (expected && cookie === expected) {
    return NextResponse.next();
  }

  // API-key path for Content Brain automation (see header comment)
  if (pathname.startsWith("/api/content-brain/")) {
    const configuredKey = process.env.CONTENT_BRAIN_API_KEY;
    const providedKey = request.headers.get("x-api-key");
    if (configuredKey && providedKey && (await apiKeyMatches(providedKey, configuredKey))) {
      return NextResponse.next();
    }
  }

  // Bearer-token path for read-only bot routes (see header comment)
  if (pathname.startsWith("/api/bot/")) {
    const provided = bearerFrom(request.headers.get("authorization"));
    if (await tokenMatches(provided, configuredBotToken())) {
      return NextResponse.next();
    }
  }

  // API routes get a 401 instead of a redirect
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
