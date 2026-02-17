import type { Context, Next } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory rate limiter for Hono.
 * Limits requests per user (by Supabase sub) or by IP.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyGenerator?: (c: Context) => string;
}) {
  const store = new Map<string, RateLimitEntry>();

  // Clean up expired entries every minute
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }, 60_000);

  return async (c: Context, next: Next) => {
    const key =
      opts.keyGenerator?.(c) ??
      (c.get("user") as { sub: string } | undefined)?.sub ??
      c.req.header("x-forwarded-for") ??
      "unknown";

    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(opts.max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, opts.max - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > opts.max) {
      return c.json(
        { error: "Too many requests. Please try again later." },
        429,
      );
    }

    await next();
  };
}
