import { createMiddleware } from "hono/factory";
import { verifySupabaseJwt, parseCookie } from "../lib/supabase-jwt.js";

export type AuthUser = {
  sub: string;
  email: string;
};

/**
 * Auth middleware that verifies the Supabase JWT.
 * Checks (in order):
 *   1. Authorization: Bearer <token> header
 *   2. sb_access_token cookie (set by Luca on .tanzillo.ai)
 * Sets c.get('user') with { sub, email } from the JWT.
 * Returns 401 if unauthenticated (API server, not a redirect).
 */
export const authMiddleware = createMiddleware<{
  Variables: { user: AuthUser };
}>(async (c, next) => {
  // Try Authorization header first (works on localhost & cross-origin)
  let token: string | undefined;
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  // Fall back to cookie (production on .tanzillo.ai)
  if (!token) {
    token = parseCookie(c.req.header("cookie"), "sb_access_token");
  }

  if (token) {
    try {
      const payload = await verifySupabaseJwt(token);
      c.set("user", { sub: payload.sub, email: payload.email });
      return next();
    } catch {
      // Token expired or invalid
    }
  }

  return c.json({ error: "Unauthorized" }, 401);
});
