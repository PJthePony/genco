import { Hono } from "hono";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { scanInbox } from "../services/scanner.js";
import { classifyPendingEmails, buildHistoricalSenderContext } from "../services/classifier.js";
import { pruneProcessedEmails } from "../services/cleanup.js";

export const emailRoutes = new Hono<{ Variables: { user: AuthUser } }>();

emailRoutes.use("*", authMiddleware);

// Rate limit scan: max 6 scans per 10 minutes per user
const scanRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 6,
});

/**
 * POST /emails/scan — trigger a manual scan of the user's inbox.
 * Fetches new unread emails, stores them in the queue, then classifies them.
 */
emailRoutes.post("/scan", scanRateLimit, async (c) => {
  const user = c.get("user");

  try {
    const scanResult = await scanInbox(user.sub);
    const classifyResult = await classifyPendingEmails(user.sub);

    // Background tasks (non-blocking):
    // 1. Build sender profiles for historical senders discovered in the scan
    buildHistoricalSenderContext(user.sub).catch((err) =>
      console.warn("Historical sender context build failed (non-blocking):", err),
    );
    // 2. Prune old processed emails
    pruneProcessedEmails().catch((err) =>
      console.warn("Prune failed (non-blocking):", err),
    );

    return c.json({
      ok: true,
      scan: scanResult,
      classify: classifyResult,
    });
  } catch (err: any) {
    console.error("Scan failed:", err);
    return c.json(
      { error: err.message || "Scan failed" },
      err.message?.includes("not connected") ? 400 : 500,
    );
  }
});

/**
 * POST /emails/classify — classify pending emails without scanning.
 * Useful for re-classifying after feedback or if classification was interrupted.
 */
emailRoutes.post("/classify", async (c) => {
  const user = c.get("user");

  try {
    const result = await classifyPendingEmails(user.sub);
    return c.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("Classification failed:", err);
    return c.json({ error: err.message || "Classification failed" }, 500);
  }
});
