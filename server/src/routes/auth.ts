import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { gmailConnections } from "../db/schema.js";
import { getAuthUrl, exchangeCode, getUserEmail } from "../lib/gmail.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import { env } from "../config.js";

export const authRoutes = new Hono<{ Variables: { user: AuthUser } }>();

// ── Google OAuth for Gmail ──────────────────────────────────────────────────

/**
 * Start Google OAuth flow.
 * GET /auth/google
 *
 * Requires auth — uses the Supabase user ID as the OAuth state param.
 * Returns the Google consent URL as JSON so the frontend can navigate to it.
 */
authRoutes.get("/google", authMiddleware, (c) => {
  const user = c.get("user");
  const url = getAuthUrl(user.sub);
  return c.json({ url });
});

/**
 * Google OAuth callback.
 * GET /auth/google/callback?code=xxx&state=userId
 *
 * Public route (Google redirects here, no cookie on redirect).
 * State param contains the Supabase user ID.
 */
authRoutes.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const userId = c.req.query("state");

  if (!code || !userId) {
    return c.text("Missing code or state", 400);
  }

  try {
    const tokens = await exchangeCode(code);
    const gmailAddress = await getUserEmail(tokens);

    // Upsert gmail connection
    const existing = await db.query.gmailConnections.findFirst({
      where: eq(gmailConnections.userId, userId),
    });

    if (existing) {
      await db
        .update(gmailConnections)
        .set({
          googleTokens: tokens,
          gmailAddress,
          updatedAt: new Date(),
        })
        .where(eq(gmailConnections.id, existing.id));
    } else {
      await db.insert(gmailConnections).values({
        userId,
        gmailAddress,
        googleTokens: tokens,
      });
    }

    console.log(`Gmail connected for user ${userId}: ${gmailAddress}`);

    // Redirect back to the Genco frontend dashboard
    return c.redirect(`${env.FRONTEND_URL}/dashboard?gmail=connected`);
  } catch (err: any) {
    console.error("Google OAuth callback failed:", err);
    return c.redirect(`${env.FRONTEND_URL}/dashboard?gmail=error`);
  }
});
