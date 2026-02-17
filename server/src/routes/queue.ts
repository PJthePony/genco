import { Hono } from "hono";
import { eq, and, desc, isNotNull, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { emailQueue } from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import { executeAction } from "../services/actions.js";

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
  replyBody: z.string().max(10000).optional(),
  replyContext: z.string().max(1000).optional(),
  taskTitle: z.string().max(500).optional(),
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
    replyBody: body.replyBody,
    replyContext: body.replyContext,
    taskTitle: body.taskTitle,
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 500);
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
