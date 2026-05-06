/**
 * In-memory rate limiter (per key, typically IP address).
 * Suitable for single-instance deployments.
 * For multi-instance production, replace with a Redis-backed solution.
 */

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

// Hard cap on tracked keys to prevent memory exhaustion under high load
const MAX_STORE_SIZE = 20_000;

// Clean up expired entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 5 * 60 * 1000);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // If store is full, reject new keys (fail-safe under extreme load)
    if (!entry && store.size >= MAX_STORE_SIZE) {
      return { allowed: false, remaining: 0, resetAt: now + windowMs };
    }
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}
