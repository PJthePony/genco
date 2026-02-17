import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { feedbackLog, senderSummaries, gmailConnections } from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import { fetchSenderHistory, refreshAccessToken, type GoogleTokens } from "../lib/gmail.js";
import { buildSenderSummaryFromHistory } from "../lib/claude.js";

const feedbackSchema = z.object({
  emailQueueId: z.string().uuid().optional(),
  sender: z.string().max(500).optional(),
  originalAction: z.string().min(1).max(50),
  chosenAction: z.string().min(1).max(50),
  reason: z.string().max(1000).optional(),
});

export const feedbackRoutes = new Hono<{ Variables: { user: AuthUser } }>();

feedbackRoutes.use("*", authMiddleware);

// POST /feedback — persist a correction
feedbackRoutes.post("/", async (c) => {
  const user = c.get("user");

  const rawBody = await c.req.json().catch(() => null);
  const parsed = feedbackSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  const body = parsed.data;

  await db.insert(feedbackLog).values({
    userId: user.sub,
    emailQueueId: body.emailQueueId ?? null,
    sender: body.sender ?? null,
    originalAction: body.originalAction,
    chosenAction: body.chosenAction,
    reason: body.reason ?? null,
  });

  // Immediately regenerate sender summary with feedback context (non-blocking).
  // This ensures the sender profile reflects P.J.'s correction right away.
  if (body.sender) {
    regenerateSenderSummary(user.sub, body.sender).catch((err) =>
      console.warn("Sender summary regeneration failed (non-blocking):", err),
    );
  }

  return c.json({ ok: true });
});

/**
 * Regenerate a sender's relationship summary after feedback.
 * Pulls the sender's full Gmail history and rebuilds the profile.
 */
async function regenerateSenderSummary(userId: string, senderEmail: string) {
  // Get Gmail tokens
  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, userId),
  });
  if (!connection) return;

  let tokens = connection.googleTokens as GoogleTokens;
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    tokens = await refreshAccessToken(tokens);
    await db
      .update(gmailConnections)
      .set({ googleTokens: tokens, updatedAt: new Date() })
      .where(eq(gmailConnections.id, connection.id));
  }

  // Fetch full sender history
  const history = await fetchSenderHistory(tokens, senderEmail);
  if (history.length === 0) return;

  // Get existing summary to find sender name
  const existing = await db.query.senderSummaries.findFirst({
    where: eq(senderSummaries.senderEmail, senderEmail),
  });

  // Build new summary from history (Claude will see the feedback in the prompt context)
  const newSummary = await buildSenderSummaryFromHistory(
    senderEmail,
    existing?.senderName ?? "",
    history,
  );

  // Upsert the sender summary
  if (existing) {
    await db
      .update(senderSummaries)
      .set({
        summary: newSummary,
        emailCount: String(history.length),
        updatedAt: new Date(),
      })
      .where(eq(senderSummaries.id, existing.id));
  } else {
    await db
      .insert(senderSummaries)
      .values({
        userId,
        senderEmail,
        summary: newSummary,
        emailCount: String(history.length),
      })
      .onConflictDoNothing();
  }

  console.log(`Regenerated sender summary for ${senderEmail} after feedback`);
}

// GET /feedback/stats — override patterns for Settings > AI Learning
feedbackRoutes.get("/stats", async (c) => {
  const user = c.get("user");

  // Get override counts by action pair
  const overrides = await db
    .select({
      originalAction: feedbackLog.originalAction,
      chosenAction: feedbackLog.chosenAction,
      count: sql<number>`count(*)::int`,
    })
    .from(feedbackLog)
    .where(eq(feedbackLog.userId, user.sub))
    .groupBy(feedbackLog.originalAction, feedbackLog.chosenAction)
    .orderBy(sql`count(*) desc`);

  // Get sender-specific patterns
  const senderPatterns = await db
    .select({
      sender: feedbackLog.sender,
      chosenAction: feedbackLog.chosenAction,
      count: sql<number>`count(*)::int`,
    })
    .from(feedbackLog)
    .where(eq(feedbackLog.userId, user.sub))
    .groupBy(feedbackLog.sender, feedbackLog.chosenAction)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  // Get recent corrections for the log
  const recent = await db.query.feedbackLog.findMany({
    where: eq(feedbackLog.userId, user.sub),
    orderBy: (fb, { desc }) => [desc(fb.createdAt)],
    limit: 10,
    columns: {
      originalAction: true,
      chosenAction: true,
      sender: true,
      reason: true,
      createdAt: true,
    },
  });

  return c.json({ overrides, senderPatterns, recent });
});
