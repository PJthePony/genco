import { Hono } from "hono";
import { eq, and, ne, desc, isNotNull, gte, or, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { emailQueue, gmailConnections } from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import { executeAction } from "../services/actions.js";
import { archiveMessage, unarchiveMessage, refreshAccessToken, type GoogleTokens } from "../lib/gmail.js";

const VALID_ACTIONS = [
  "reply",
  "add_task",
  "archive",
  "unsubscribe",
  "briefing",
  "act",
  "skip",
] as const;

const actionSchema = z.object({
  action: z.enum(VALID_ACTIONS),
  replyBody: z.string().max(10000).nullish(),
  replyContext: z.string().max(1000).nullish(),
  taskTitle: z.string().max(500).nullish(),
});

export const queueRoutes = new Hono<{ Variables: { user: AuthUser } }>();

queueRoutes.use("*", authMiddleware);

// GET /queue — pending items for the decision queue
queueRoutes.get("/", async (c) => {
  const user = c.get("user");

  const items = await db.query.emailQueue.findMany({
    where: and(
      eq(emailQueue.userId, user.sub),
      eq(emailQueue.status, "pending"),
      isNotNull(emailQueue.aiSummary),
      ne(emailQueue.aiRecommendedAction, "briefing"),
    ),
    orderBy: [desc(emailQueue.isUrgent), desc(emailQueue.receivedAt)],
    columns: {
      id: true,
      fromEmail: true,
      fromName: true,
      subject: true,
      bodyHtml: true,
      receivedAt: true,
      aiSummary: true,
      aiRecommendedAction: true,
      aiPriority: true,
      aiReplyDraft: true,
      aiTaskTitle: true,
      isUrgent: true,
    },
  });

  return c.json({ items, total: items.length });
});

// GET /queue/digest — briefing source items for daily digest
// Returns briefing items from the last 24 hours (auto-processed, not in decision queue)
queueRoutes.get("/digest", async (c) => {
  const user = c.get("user");

  // Show briefing items from the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const items = await db.query.emailQueue.findMany({
    where: and(
      eq(emailQueue.userId, user.sub),
      eq(emailQueue.aiRecommendedAction, "briefing"),
      gte(emailQueue.receivedAt, since),
    ),
    orderBy: [desc(emailQueue.receivedAt)],
    columns: {
      id: true,
      fromEmail: true,
      fromName: true,
      subject: true,
      aiSummary: true,
      receivedAt: true,
    },
  });

  return c.json({ items });
});

// POST /queue/sync-archives — retry Gmail archive for items still in inbox
// Handles: (1) processed items whose Gmail archive failed, (2) briefing items never archived
queueRoutes.post("/sync-archives", async (c) => {
  const user = c.get("user");

  const archiveActions = ["archive", "reply", "add_task", "unsubscribe", "briefing"];

  // Find items that should be archived in Gmail:
  // 1. Processed items with an archivable action
  // 2. Pending briefing items (AI classified but scanner didn't archive)
  const items = await db.query.emailQueue.findMany({
    where: and(
      eq(emailQueue.userId, user.sub),
      or(
        // Processed items that should have been archived
        and(
          eq(emailQueue.status, "processed"),
          inArray(emailQueue.chosenAction, archiveActions),
        ),
        // Pending briefing items that were never archived in Gmail
        and(
          eq(emailQueue.status, "pending"),
          eq(emailQueue.aiRecommendedAction, "briefing"),
        ),
      ),
    ),
    columns: {
      id: true,
      gmailMessageId: true,
      chosenAction: true,
      aiRecommendedAction: true,
    },
  });

  if (items.length === 0) {
    return c.json({ ok: true, archived: 0 });
  }

  // Get Gmail tokens
  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, user.sub),
  });

  if (!connection) {
    return c.json({ error: "Gmail not connected" }, 422);
  }

  let tokens = connection.googleTokens as GoogleTokens;
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    tokens = await refreshAccessToken(tokens);
    await db
      .update(gmailConnections)
      .set({ googleTokens: tokens, updatedAt: new Date() })
      .where(eq(gmailConnections.id, connection.id));
  }

  let archived = 0;
  for (const item of items) {
    try {
      await archiveMessage(tokens, item.gmailMessageId);
      archived++;
    } catch (err) {
      console.warn(`Failed to archive ${item.gmailMessageId}:`, err);
    }
  }

  return c.json({ ok: true, archived, total: items.length });
});

// POST /queue/:id/action — record chosen action + execute
queueRoutes.post("/:id/action", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  // Validate UUID format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return c.json({ error: "Invalid email ID" }, 400);
  }

  const rawBody = await c.req.json().catch(() => null);
  const parsed = actionSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  const body = parsed.data;

  // Execute the action
  const result = await executeAction(user.sub, id, body.action, {
    replyBody: body.replyBody ?? undefined,
    replyContext: body.replyContext ?? undefined,
    taskTitle: body.taskTitle ?? undefined,
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 422);
  }

  // Mark as processed
  await db
    .update(emailQueue)
    .set({
      status: body.action === "skip" ? "skipped" : "processed",
      chosenAction: body.action,
      processedAt: new Date(),
    })
    .where(and(eq(emailQueue.id, id), eq(emailQueue.userId, user.sub)));

  return c.json({
    ok: true,
    draftId: result.draftId,
    unsubscribeMethod: result.unsubscribeMethod,
    unsubscribeUrl: result.unsubscribeUrl,
  });
});

// POST /queue/:id/promote — move a briefing item into the decision queue
queueRoutes.post("/:id/promote", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return c.json({ error: "Invalid email ID" }, 400);
  }

  // Change the recommended action so it appears in the decision queue
  const updated = await db
    .update(emailQueue)
    .set({ aiRecommendedAction: "archive" })
    .where(
      and(
        eq(emailQueue.id, id),
        eq(emailQueue.userId, user.sub),
        eq(emailQueue.aiRecommendedAction, "briefing"),
      ),
    )
    .returning({ gmailMessageId: emailQueue.gmailMessageId });

  if (updated.length === 0) {
    return c.json({ error: "Item not found or already promoted" }, 404);
  }

  // Move the email back to the inbox in Gmail
  try {
    const connection = await db.query.gmailConnections.findFirst({
      where: eq(gmailConnections.userId, user.sub),
    });

    if (connection) {
      let tokens = connection.googleTokens as GoogleTokens;
      if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
        tokens = await refreshAccessToken(tokens);
        await db
          .update(gmailConnections)
          .set({ googleTokens: tokens, updatedAt: new Date() })
          .where(eq(gmailConnections.id, connection.id));
      }
      await unarchiveMessage(tokens, updated[0].gmailMessageId);
    }
  } catch (err) {
    console.warn("Failed to move email back to inbox:", err);
    // Non-fatal: the item is still promoted in the queue
  }

  return c.json({ ok: true });
});
