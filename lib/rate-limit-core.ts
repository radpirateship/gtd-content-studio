/**
 * Pure rate-limiting logic — separated from the Next.js-dependent response
 * helpers in lib/rate-limit.ts so it can be unit-tested without a Next.js
 * runtime. Most callers should import from lib/rate-limit.ts (which re-exports
 * everything here); import directly from this file only in tests.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the oldest request in the window expires */
  resetMs: number;
}

const store = new Map<string, number[]>();

/**
 * Check whether a request for `key` is within the rate limit.
 *
 * @param key - Identifies the bucket (e.g. route name or "generate")
 * @param options.windowMs - Sliding window size in ms (default: 60 000 = 1 min)
 * @param options.max - Max requests allowed within the window (default: 10)
 */
export function rateLimit(
  key: string,
  options: { windowMs?: number; max?: number } = {}
): RateLimitResult {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 10;
  const now = Date.now();
  const windowStart = now - windowMs;

  let timestamps = store.get(key);
  if (!timestamps) {
    timestamps = [];
    store.set(key, timestamps);
  }

  // Prune entries older than the window
  const pruned = timestamps.filter(t => t > windowStart);
  store.set(key, pruned);

  if (pruned.length >= max) {
    const oldestInWindow = pruned[0];
    return {
      allowed: false,
      remaining: 0,
      resetMs: oldestInWindow + windowMs - now,
    };
  }

  pruned.push(now);
  return {
    allowed: true,
    remaining: max - pruned.length,
    resetMs: windowMs,
  };
}
