import { Hono } from "hono";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";
import { z } from "zod";
import { createHash } from "crypto";
import { db } from "../db/index.js";
import {
  messageQueue,
  outboundMessages,
  networkContacts,
  senderSummaries,
  feedbackLog,
} from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import { env } from "../config.js";
import {
  classifyMessage,
  generateMessageReplyDraft,
} from "../lib/claude.js";
import { createTessioTask } from "../lib/tessio.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Bridge Auth Middleware ────────────────────────────────────────────────────

/**
 * Middleware for bridge-only endpoints.
 * Accepts either the BRIDGE_API_KEY or a valid Supabase JWT.
 */
function bridgeAuth() {
  return async (c: any, next: any) => {
    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      // Check bridge key first
      if (env.BRIDGE_API_KEY && token === env.BRIDGE_API_KEY) {
        // Bridge auth — set a fixed user ID (P.J.'s Supabase user ID)
        // The bridge must include userId in the request body
        return next();
      }
    }
    // Fall through to standard auth
    return authMiddleware(c, next);
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export const messageRoutes = new Hono();

// ── Ingest (bridge-authenticated) ────────────────────────────────────────────

const ingestSchema = z.object({
  userId: z.string().min(1),
  messages: z.array(
    z.object({
      senderPhone: z.string().min(1),
      senderName: z.string().nullish(),
      messageText: z.string().min(1),
      receivedAt: z.string(), // ISO date
      isFromMe: z.boolean().default(false),
    }),
  ),
});

messageRoutes.post("/ingest", bridgeAuth(), async (c) => {
  const rawBody = await c.req.json().catch(() => null);
  const parsed = ingestSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  const { userId, messages } = parsed.data;
  let inserted = 0;
  let skipped = 0;

  for (const msg of messages) {
    // Skip messages from P.J. (sent messages)
    if (msg.isFromMe) {
      skipped++;
      continue;
    }

    // Generate dedup hash: senderPhone + messageText + receivedAt (rounded to minute)
    const receivedDate = new Date(msg.receivedAt);
    const minuteKey = `${receivedDate.getFullYear()}-${receivedDate.getMonth()}-${receivedDate.getDate()}-${receivedDate.getHours()}-${receivedDate.getMinutes()}`;
    const hashInput = `${msg.senderPhone}:${msg.messageText}:${minuteKey}`;
    const messageHash = createHash("sha256").update(hashInput).digest("hex");

    try {
      const [result] = await db
        .insert(messageQueue)
        .values({
          userId,
          messageHash,
          senderPhone: msg.senderPhone,
          senderName: msg.senderName ?? null,
          messageText: msg.messageText,
          receivedAt: receivedDate,
          isFromMe: msg.isFromMe,
        })
        .onConflictDoNothing()
        .returning();

      if (result) {
        inserted++;

        // Auto-add sender to network contacts if they have a phone match
        try {
          const existingByPhone = await db.query.networkContacts.findFirst({
            where: and(
              eq(networkContacts.userId, userId),
              eq(networkContacts.phoneNumber, msg.senderPhone),
            ),
          });

          if (existingByPhone) {
            // Update last contact info
            await db
              .update(networkContacts)
              .set({
                lastContactAt: receivedDate,
                lastDirection: "received",
              })
              .where(eq(networkContacts.id, existingByPhone.id));
          }
        } catch {
          // Non-fatal
        }
      } else {
        skipped++;
      }
    } catch (err) {
      console.warn(`Failed to insert message from ${msg.senderPhone}:`, err);
      skipped++;
    }
  }

  return c.json({ ok: true, inserted, skipped });
});

// ── Classify pending messages ────────────────────────────────────────────────

messageRoutes.post(
  "/classify",
  bridgeAuth(),
  async (c) => {
    const rawBody = await c.req.json().catch(() => ({})) as { userId?: string };
    const userId = rawBody.userId;

    if (!userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const pending = await db.query.messageQueue.findMany({
      where: and(
        eq(messageQueue.userId, userId),
        eq(messageQueue.status, "pending"),
        isNull(messageQueue.aiSummary),
      ),
      orderBy: [desc(messageQueue.receivedAt)],
      limit: 20,
    });

    if (pending.length === 0) {
      return c.json({ ok: true, processed: 0, failed: 0, urgent: 0 });
    }

    // Build feedback context
    const recentFeedback = await db.query.feedbackLog.findMany({
      where: eq(feedbackLog.userId, userId),
      orderBy: (fb, { desc }) => [desc(fb.createdAt)],
      limit: 20,
    });

    const feedbackContext = recentFeedback.length > 0
      ? recentFeedback
          .map((fb) => {
            let line = `- Changed "${fb.originalAction}" → "${fb.chosenAction}"`;
            if (fb.sender) line += ` for ${fb.sender}`;
            return line;
          })
          .join("\n")
      : "";

    // Pre-load network contacts by phone for sender matching
    const allContacts = await db.query.networkContacts.findMany({
      where: eq(networkContacts.userId, userId),
    });
    const phoneToContact = new Map(
      allContacts
        .filter((c) => c.phoneNumber)
        .map((c) => [c.phoneNumber!, c]),
    );

    // Pre-load sender summaries
    const allSummaries = await db.query.senderSummaries.findMany({
      where: eq(senderSummaries.userId, userId),
    });
    const summaryByEmail = new Map(
      allSummaries.map((s) => [s.senderEmail, s.summary]),
    );

    let processed = 0;
    let failed = 0;
    let urgent = 0;

    for (const msg of pending) {
      try {
        // Try to find sender summary via phone → contact → email
        let senderSummary: string | null = null;
        const matchedContact = phoneToContact.get(msg.senderPhone);
        if (matchedContact) {
          senderSummary = summaryByEmail.get(matchedContact.email) ?? null;
        }

        const result = await classifyMessage({
          senderPhone: msg.senderPhone,
          senderName: msg.senderName ?? "",
          messageText: msg.messageText,
          senderSummary,
          feedbackContext,
        });

        await db
          .update(messageQueue)
          .set({
            aiSummary: result.summary,
            aiRecommendedAction: result.recommendedAction,
            aiPriority: result.priority,
            isUrgent: result.isUrgent,
            aiReplyDraft: result.replyDraft,
          })
          .where(eq(messageQueue.id, msg.id));

        processed++;
        if (result.isUrgent) urgent++;

        console.log(
          `Classified message from ${msg.senderName || msg.senderPhone}: → ${result.recommendedAction} (${result.priority}${result.isUrgent ? ", URGENT" : ""})`,
        );
      } catch (err) {
        console.error(
          `Failed to classify message from ${msg.senderPhone}:`,
          err,
        );
        failed++;
      }
    }

    return c.json({ ok: true, processed, failed, urgent });
  },
);

// ── Queue (user-authenticated) ───────────────────────────────────────────────

const userRoutes = new Hono<{ Variables: { user: AuthUser } }>();
userRoutes.use("*", authMiddleware);

// GET /messages/queue — pending classified messages
userRoutes.get("/queue", async (c) => {
  const user = c.get("user");

  const classified = await db.query.messageQueue.findMany({
    where: and(
      eq(messageQueue.userId, user.sub),
      eq(messageQueue.status, "pending"),
      isNotNull(messageQueue.aiSummary),
    ),
    orderBy: [desc(messageQueue.isUrgent), desc(messageQueue.receivedAt)],
  });

  return c.json({ items: classified, total: classified.length });
});

// POST /messages/:id/action — take action on a message
const messageActionSchema = z.object({
  action: z.enum(["reply", "add_task", "archive", "skip"]),
  replyBody: z.string().max(5000).nullish(),
  replyContext: z.string().max(1000).nullish(),
  taskTitle: z.string().max(500).nullish(),
});

userRoutes.post("/:id/action", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid message ID" }, 400);
  }

  const rawBody = await c.req.json().catch(() => null);
  const parsed = messageActionSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  const body = parsed.data;

  // Get the message
  const msg = await db.query.messageQueue.findFirst({
    where: and(eq(messageQueue.id, id), eq(messageQueue.userId, user.sub)),
  });

  if (!msg) {
    return c.json({ error: "Message not found" }, 404);
  }

  try {
    switch (body.action) {
      case "reply": {
        let replyText: string;

        if (body.replyContext) {
          // Generate a new draft from user instructions
          const matchedContact = await db.query.networkContacts.findFirst({
            where: and(
              eq(networkContacts.userId, user.sub),
              eq(networkContacts.phoneNumber, msg.senderPhone),
            ),
          });

          let senderSummary: string | null = null;
          if (matchedContact) {
            const summary = await db.query.senderSummaries.findFirst({
              where: eq(senderSummaries.senderEmail, matchedContact.email),
            });
            senderSummary = summary?.summary ?? null;
          }

          replyText = await generateMessageReplyDraft({
            senderName: msg.senderName ?? "",
            senderPhone: msg.senderPhone,
            messageText: msg.messageText,
            replyContext: body.replyContext,
            senderSummary,
          });
        } else {
          replyText =
            body.replyBody ?? msg.aiReplyDraft ?? "Sounds good!";
        }

        // Create outbound message for the bridge to send
        await db.insert(outboundMessages).values({
          userId: user.sub,
          recipientPhone: msg.senderPhone,
          recipientName: msg.senderName,
          messageText: replyText,
          sourceType: "message_reply",
          sourceId: msg.id,
        });

        // Mark as processed
        await db
          .update(messageQueue)
          .set({
            status: "processed",
            chosenAction: "reply",
            processedAt: new Date(),
          })
          .where(eq(messageQueue.id, id));

        return c.json({ ok: true, replyText });
      }

      case "add_task": {
        const title =
          body.taskTitle ||
          `Reply to ${msg.senderName || msg.senderPhone}: ${msg.messageText.slice(0, 60)}`;
        const notes =
          `From: ${msg.senderName ?? msg.senderPhone}\n\n${msg.messageText}`.trim();
        await createTessioTask(user.sub, title, notes);

        await db
          .update(messageQueue)
          .set({
            status: "processed",
            chosenAction: "add_task",
            processedAt: new Date(),
          })
          .where(eq(messageQueue.id, id));

        return c.json({ ok: true });
      }

      case "archive":
      case "skip": {
        await db
          .update(messageQueue)
          .set({
            status: body.action === "skip" ? "skipped" : "processed",
            chosenAction: body.action,
            processedAt: new Date(),
          })
          .where(eq(messageQueue.id, id));

        return c.json({ ok: true });
      }

      default:
        return c.json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err: any) {
    console.error(`Message action "${body.action}" failed for ${id}:`, err);
    return c.json({ ok: false, error: err.message || "Action failed" }, 500);
  }
});

// ── Outbound Messages (bridge-authenticated) ─────────────────────────────────
// NOTE: Must be registered BEFORE userRoutes.route("/") which catches all paths

// GET /messages/outbound — pending messages for the bridge to send
messageRoutes.get("/outbound", bridgeAuth(), async (c) => {
  const rawUserId = c.req.query("userId");
  if (!rawUserId) {
    return c.json({ error: "userId query param required" }, 400);
  }

  const pending = await db.query.outboundMessages.findMany({
    where: and(
      eq(outboundMessages.userId, rawUserId),
      eq(outboundMessages.status, "pending"),
    ),
    orderBy: [desc(outboundMessages.createdAt)],
  });

  return c.json({ items: pending });
});

// POST /messages/outbound/:id/sent — mark as sent
messageRoutes.post("/outbound/:id/sent", bridgeAuth(), async (c) => {
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid outbound message ID" }, 400);
  }

  await db
    .update(outboundMessages)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(outboundMessages.id, id));

  return c.json({ ok: true });
});

// POST /messages/outbound/:id/failed — mark as failed
messageRoutes.post("/outbound/:id/failed", bridgeAuth(), async (c) => {
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid outbound message ID" }, 400);
  }

  await db
    .update(outboundMessages)
    .set({ status: "failed" })
    .where(eq(outboundMessages.id, id));

  return c.json({ ok: true });
});

// Mount user-authenticated routes (must come AFTER bridge routes)
messageRoutes.route("/", userRoutes);
