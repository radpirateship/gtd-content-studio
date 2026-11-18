// lib/bot-auth.ts
//
// Bearer-token check for the read-only /api/bot/* routes. The token lives in
// the Vercel env var BOT_API_TOKEN (CONTENT_STUDIO_BOT_TOKEN also accepted).
// If neither is set the bot path is disabled entirely. Used by middleware.ts
// (so unauthenticated requests never reach a handler) and again inside each
// bot route as belt and braces.

export function configuredBotToken(): string | null {
  return process.env.BOT_API_TOKEN || process.env.CONTENT_STUDIO_BOT_TOKEN || null;
}

export function bearerFrom(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^\s*Bearer\s+(.+?)\s*$/i);
  return m ? m[1] : null;
}

// Hash both sides so length and early mismatch reveal nothing about the token.
export async function tokenMatches(provided: string | null, expected: string | null): Promise<boolean> {
  if (!provided || !expected) return false;
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

export async function botRequestAuthorized(req: Request): Promise<boolean> {
  return tokenMatches(bearerFrom(req.headers.get("authorization")), configuredBotToken());
}
