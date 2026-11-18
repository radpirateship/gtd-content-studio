/**
 * Rate-limit response helpers for Next.js route handlers.
 *
 * The pure rate-limit decision logic lives in lib/rate-limit-core.ts so it can
 * be unit-tested without pulling in next/server. This module re-exports it for
 * convenience; nothing else needs to change at the call sites.
 *
 * Usage in a route handler:
 *
 *   import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
 *
 *   const limit = rateLimit('generate', { windowMs: 60_000, max: 3 });
 *   if (!limit.allowed) return rateLimitResponse(limit);
 */

import { NextResponse } from "next/server";

export { rateLimit, type RateLimitResult } from "./rate-limit-core";
import type { RateLimitResult } from "./rate-limit-core";
import { rateLimit } from "./rate-limit-core";

/**
 * Return a 429 response with Retry-After header for rate-limited requests.
 */
export function rateLimitResponse(limit: RateLimitResult): NextResponse {
  const retryAfter = Math.ceil(limit.resetMs / 1000);
  return NextResponse.json(
    {
      error: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      retryAfterSeconds: retryAfter,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}

/**
 * Wrap a route handler with a rate-limit check. Returns the 429 response if
 * the limit is hit; otherwise runs the handler.
 *
 *   export async function POST(req: NextRequest) {
 *     return withRateLimit({ key: "generate-image", max: 5 }, async () => {
 *       // ...handler body
 *     });
 *   }
 */
export async function withRateLimit(
  options: { key: string; max?: number; windowMs?: number },
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const limit = rateLimit(options.key, {
    max: options.max,
    windowMs: options.windowMs,
  });
  if (!limit.allowed) return rateLimitResponse(limit);
  return handler();
}
