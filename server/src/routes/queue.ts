import { Hono } from "hono";
import { eq, and, desc, isNotNull, gte, or, inArray, count, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { emailQueue, gmailConnections, networkContacts, followUpQueue } from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import { executeAction } from "../services/actions.js";
import { archiveMessage, unarchiveMessage, refreshAccessToken, type GoogleTokens } from "../lib/gmail.js";
import { generateReplyFromDirection, reclassifyForAction } from "../lib/claude.js";
import { senderSummaries, feedbackLog } from "../db/schema.js";

const VALID_ACTIONS = [
  "reply",
  "act",
  "archive",
  "skip",
  // Backward compat: old clients may still send these
  "add_task",
  "unsubscribe",
  "briefing",
] as const;

const VALID_SUB_ACTIONS = ["unsubscribe", "add_task", "briefing"] as const;

const actionSchema = z.object({
  action: z.enum(VALID_ACTIONS),
  subAction: z.enum(VALID_SUB_ACTIONS).nullish(),
  replyBody: z.string().max(10000).nullish(),
  replyContext: z.string().max(1000).nullish(),
  taskTitle: z.string().max(500).nullish(),
});

const draftSchema = z.object({
  direction: z.string().min(1).max(2000),
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
      aiRecommendedSubAction: true,
      aiPriority: true,
      aiReplyDraft: true,
      aiTaskTitle: true,
      isUrgent: true,
      chosenAction: true,
      chosenSubAction: true,
    },
  });

  return c.json({ items, total: items.length });
});

// GET /queue/count — lightweight count of actionable items (for polling/badge)
// Counts pending action items + pending/due follow-ups
queueRoutes.get("/count", async (c) => {
  const user = c.get("user");

  // Count pending action items (emails needing decisions)
  const [actionResult] = await db
    .select({ count: count() })
    .from(emailQueue)
    .where(
      and(
        eq(emailQueue.userId, user.sub),
        eq(emailQueue.status, "pending"),
        isNotNull(emailQueue.aiSummary),
      ),
    );

  // Count pending + due snoozed follow-ups
  const now = new Date();
  const contacts = await db.query.networkContacts.findMany({
    where: eq(networkContacts.userId, user.sub),
    columns: { id: true },
  });
  let followUpCount = 0;
  if (contacts.length > 0) {
    const contactIds = contacts.map((c) => c.id);
    const [fuResult] = await db
      .select({ count: count() })
      .from(followUpQueue)
      .where(
        and(
          sql`${followUpQueue.networkContactId} IN (${sql.join(
            contactIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
          or(
            eq(followUpQueue.status, "pending"),
            and(
              eq(followUpQueue.status, "snoozed"),
              lte(followUpQueue.snoozedUntil, now),
            ),
          ),
        ),
      );
    followUpCount = fuResult?.count ?? 0;
  }

  return c.json({ count: (actionResult?.count ?? 0) + followUpCount });
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
      or(
        // New model: act + briefing sub-action
        and(eq(emailQueue.aiRecommendedAction, "act"), eq(emailQueue.aiRecommendedSubAction, "briefing")),
        // Backward compat: old briefing items
        eq(emailQueue.aiRecommendedAction, "briefing"),
      ),
      gte(emailQueue.receivedAt, since),
    ),
    orderBy: [desc(emailQueue.receivedAt)],
    columns: {
      id: true,
      fromEmail: true,
      fromName: true,
      subject: true,
      bodyHtml: true,
      aiSummary: true,
      receivedAt: true,
    },
  });

  return c.json({ items });
});

// GET /queue/:id/body — fetch email body (re-fetch from Gmail if pruned)
queueRoutes.get("/:id/body", async (c) => {
  const user = c.get("user");
  const emailId = c.req.param("id");

  const email = await db.query.emailQueue.findFirst({
    where: and(
      eq(emailQueue.id, emailId),
      eq(emailQueue.userId, user.sub),
    ),
    columns: {
      subject: true,
      fromEmail: true,
      fromName: true,
      bodyHtml: true,
      bodyText: true,
      receivedAt: true,
      gmailMessageId: true,
    },
  });

  if (!email) {
    return c.json({ error: "Email not found" }, 404);
  }

  // If body is still in DB, return it
  if (email.bodyHtml) {
    return c.json({
      subject: email.subject,
      from: email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail,
      date: email.receivedAt,
      body: email.bodyHtml,
    });
  }

  // Body was pruned — re-fetch from Gmail
  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, user.sub),
  });

  if (!connection) {
    return c.json({
      subject: email.subject,
      from: email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail,
      date: email.receivedAt,
      body: email.bodyText ? `<pre style="white-space:pre-wrap;font-family:inherit">${email.bodyText}</pre>` : "<p>(Body no longer available)</p>",
    });
  }

  try {
    const tokens = await refreshAccessToken(connection as any);
    const { google } = await import("googleapis");
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: tokens.access_token });
    const gmail = google.gmail({ version: "v1", auth });

    const msg = await gmail.users.messages.get({
      userId: "me",
      id: email.gmailMessageId,
      format: "full",
    });

    // Extract HTML body from parts
    let html = "";
    function findHtml(parts: any[] | undefined) {
      if (!parts) return;
      for (const part of parts) {
        if (part.mimeType === "text/html" && part.body?.data) {
          html = Buffer.from(part.body.data, "base64url").toString("utf-8");
          return;
        }
        if (part.parts) findHtml(part.parts);
      }
    }

    const payload = msg.data.payload;
    if (payload?.body?.data && payload.mimeType === "text/html") {
      html = Buffer.from(payload.body.data, "base64url").toString("utf-8");
    } else {
      findHtml(payload?.parts);
    }

    return c.json({
      subject: email.subject,
      from: email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail,
      date: email.receivedAt,
      body: html || "<p>(Could not retrieve email body)</p>",
    });
  } catch (err) {
    console.error("Failed to re-fetch email body from Gmail:", err);
    return c.json({
      subject: email.subject,
      from: email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail,
      date: email.receivedAt,
      body: "<p>(Could not retrieve email body)</p>",
    });
  }
});

// POST /queue/reprocess — move historical items to pending so they get classified
queueRoutes.post("/reprocess", async (c) => {
  const user = c.get("user");

  const result = await db
    .update(emailQueue)
    .set({ status: "pending" })
    .where(
      and(
        eq(emailQueue.userId, user.sub),
        eq(emailQueue.status, "historical"),
      ),
    )
    .returning({ id: emailQueue.id });

  return c.json({ ok: true, requeued: result.length });
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

// PATCH /queue/:id/override — persist a user action override without executing
const overrideSchema = z.object({
  action: z.enum(["reply", "act", "archive"] as const),
  subAction: z.enum(VALID_SUB_ACTIONS).nullish(),
});

queueRoutes.patch("/:id/override", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return c.json({ error: "Invalid email ID" }, 400);
  }

  const rawBody = await c.req.json().catch(() => null);
  const parsed = overrideSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  const body = parsed.data;

  await db
    .update(emailQueue)
    .set({
      chosenAction: body.action,
      chosenSubAction: body.subAction ?? null,
    })
    .where(
      and(
        eq(emailQueue.id, id),
        eq(emailQueue.userId, user.sub),
        eq(emailQueue.status, "pending"),
      ),
    );

  return c.json({ ok: true });
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

  // Safety: strip subAction for non-act actions to prevent stale AI
  // recommendations from leaking through (e.g. archiving a task-suggested email)
  const subAction = body.action === "act" ? (body.subAction ?? undefined) : undefined;

  // Execute the action
  const result = await executeAction(user.sub, id, body.action, {
    replyBody: body.replyBody ?? undefined,
    replyContext: body.replyContext ?? undefined,
    taskTitle: body.taskTitle ?? undefined,
    subAction,
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
      chosenSubAction: subAction ?? null,
      processedAt: new Date(),
    })
    .where(and(eq(emailQueue.id, id), eq(emailQueue.userId, user.sub)));

  // When P.J. replies, update the network contact's thread status so the
  // follow-up detector doesn't keep nagging about this thread.
  if (body.action === "reply") {
    const email = await db.query.emailQueue.findFirst({
      where: eq(emailQueue.id, id),
      columns: { fromEmail: true },
    });
    if (email) {
      try {
        await db
          .update(networkContacts)
          .set({
            lastDirection: "sent",
            threadStatus: "awaiting_their_reply",
          })
          .where(
            and(
              eq(networkContacts.userId, user.sub),
              eq(networkContacts.email, email.fromEmail.toLowerCase()),
            ),
          );
      } catch (_) {
        // Non-fatal — contact might not be in network
      }
    }
  }

  return c.json({
    ok: true,
    draftId: result.draftId,
    unsubscribeMethod: result.unsubscribeMethod,
    unsubscribeUrl: result.unsubscribeUrl,
  });
});

// POST /queue/:id/draft — generate a full reply draft from a direction
queueRoutes.post("/:id/draft", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return c.json({ error: "Invalid email ID" }, 400);
  }

  const rawBody = await c.req.json().catch(() => null);
  const parsed = draftSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400);
  }

  const email = await db.query.emailQueue.findFirst({
    where: and(eq(emailQueue.id, id), eq(emailQueue.userId, user.sub)),
  });

  if (!email) {
    return c.json({ error: "Email not found" }, 404);
  }

  // Look up sender summary for context
  const senderSummary = await db.query.senderSummaries.findFirst({
    where: and(
      eq(senderSummaries.userId, user.sub),
      eq(senderSummaries.senderEmail, email.fromEmail),
    ),
  });

  const draft = await generateReplyFromDirection({
    fromName: email.fromName ?? "",
    fromEmail: email.fromEmail,
    subject: email.subject,
    bodyText: email.bodyText ?? "",
    direction: parsed.data.direction,
    senderSummary: senderSummary?.summary ?? null,
  });

  return c.json({ draft });
});

// POST /queue/:id/promote — re-classify a briefing item for the action queue
queueRoutes.post("/:id/promote", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return c.json({ error: "Invalid email ID" }, 400);
  }

  // Find the briefing item (support both old and new model)
  const email = await db.query.emailQueue.findFirst({
    where: and(
      eq(emailQueue.id, id),
      eq(emailQueue.userId, user.sub),
    ),
  });

  if (!email) {
    return c.json({ error: "Email not found" }, 404);
  }

  // Verify it's a briefing item
  const isBriefing =
    email.aiRecommendedAction === "briefing" ||
    (email.aiRecommendedAction === "act" && email.aiRecommendedSubAction === "briefing");

  if (!isBriefing) {
    return c.json({ error: "Item is not a briefing item" }, 400);
  }

  // Re-classify with AI, constrained to reply or act
  const senderSummary = await db.query.senderSummaries.findFirst({
    where: and(
      eq(senderSummaries.userId, user.sub),
      eq(senderSummaries.senderEmail, email.fromEmail),
    ),
  });

  // Build feedback context
  const recentFeedback = await db.query.feedbackLog.findMany({
    where: eq(feedbackLog.userId, user.sub),
    orderBy: (fb, { desc: d }) => [d(fb.createdAt)],
    limit: 10,
  });
  const feedbackContext = recentFeedback
    .map((fb) => {
      let line = `- Changed "${fb.originalAction}" → "${fb.chosenAction}"`;
      if (fb.sender) line += ` for ${fb.sender}`;
      if (fb.reason) line += ` (reason: "${fb.reason}")`;
      return line;
    })
    .join("\n");

  const classification = await reclassifyForAction({
    fromName: email.fromName ?? "",
    fromEmail: email.fromEmail,
    subject: email.subject,
    bodyText: email.bodyText ?? "",
    senderSummary: senderSummary?.summary ?? null,
    feedbackContext: feedbackContext || undefined,
  });

  // Update the email with new classification and set back to pending
  await db
    .update(emailQueue)
    .set({
      aiSummary: classification.summary,
      aiRecommendedAction: classification.recommendedAction,
      aiRecommendedSubAction: classification.recommendedSubAction,
      aiPriority: classification.priority,
      isUrgent: classification.isUrgent,
      aiReplyDraft: classification.replySummary,
      aiTaskTitle: classification.taskTitle,
      status: "pending",
      chosenAction: null,
      chosenSubAction: null,
      processedAt: null,
    })
    .where(eq(emailQueue.id, id));

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
      await unarchiveMessage(tokens, email.gmailMessageId);
    }
  } catch (err) {
    console.warn("Failed to move email back to inbox:", err);
  }

  // Return the new classification so frontend can add the card immediately
  return c.json({
    ok: true,
    item: {
      id: email.id,
      fromEmail: email.fromEmail,
      fromName: email.fromName,
      subject: email.subject,
      bodyHtml: email.bodyHtml,
      receivedAt: email.receivedAt,
      aiSummary: classification.summary,
      aiRecommendedAction: classification.recommendedAction,
      aiRecommendedSubAction: classification.recommendedSubAction,
      aiPriority: classification.priority,
      aiReplyDraft: classification.replySummary,
      aiTaskTitle: classification.taskTitle,
      isUrgent: classification.isUrgent,
    },
  });
});
