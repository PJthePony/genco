import { Hono } from "hono";
import { eq, and, or, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  networkContacts,
  contactContext,
  followUpQueue,
  senderSummaries,
  gmailConnections,
  emailQueue,
} from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import { env } from "../config.js";
import {
  fetchSenderHistory,
  refreshAccessToken,
  createDraft,
  type GoogleTokens,
} from "../lib/gmail.js";
import {
  buildSenderSummaryFromHistory,
  generateFollowUpDraft,
} from "../lib/claude.js";

export const networkRoutes = new Hono<{ Variables: { user: AuthUser } }>();

networkRoutes.use("*", authMiddleware);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check if an email address looks like a newsletter / mass-email sender. */
function isNoiseEmail(email: string, userEmail?: string): boolean {
  if (!email.includes("@")) return true;
  if (userEmail && email === userEmail) return true;

  const local = email.split("@")[0] ?? "";
  const domain = email.split("@")[1] ?? "";

  // Common noreply/system senders
  if (
    email.includes("noreply") ||
    email.includes("no-reply") ||
    email.includes("notifications") ||
    email.includes("mailer-daemon") ||
    email.includes("unsubscribe")
  ) return true;

  // Common mass-email sender local parts
  const massLocalParts = new Set([
    "info", "hello", "team", "support", "news", "newsletter",
    "updates", "marketing", "digest", "reply", "bounce",
  ]);
  if (massLocalParts.has(local)) return true;

  // Common mass-email domain prefixes (e.g. mail.company.com, em.company.com)
  if (
    domain.startsWith("mail.") ||
    domain.startsWith("email.") ||
    domain.startsWith("em.") ||
    domain.startsWith("e.") ||
    domain.startsWith("bounce.") ||
    domain.startsWith("send.") ||
    domain.startsWith("post.")
  ) return true;

  return false;
}

// ── Network Contacts CRUD ───────────────────────────────────────────────────

// GET /network — list all network contacts
networkRoutes.get("/", async (c) => {
  const user = c.get("user");

  const contacts = await db.query.networkContacts.findMany({
    where: eq(networkContacts.userId, user.sub),
    orderBy: (nc, { desc }) => [desc(nc.lastContactAt)],
  });

  // Enrich with sender summaries
  if (contacts.length > 0) {
    const summaries = await db.query.senderSummaries.findMany({
      where: eq(senderSummaries.userId, user.sub),
    });
    const summaryMap = new Map(
      summaries.map((s) => [s.senderEmail, s.summary]),
    );

    const enriched = contacts.map((c) => ({
      ...c,
      senderSummary: summaryMap.get(c.email) ?? null,
    }));

    return c.json({ ok: true, contacts: enriched });
  }

  return c.json({ ok: true, contacts: [] });
});

// POST /network — add a contact
const addContactSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  company: z.string().nullish(),
  title: z.string().nullish(),
  notes: z.string().nullish(),
});

networkRoutes.post("/", async (c) => {
  const user = c.get("user");
  const rawBody = await c.req.json().catch(() => null);
  const parsed = addContactSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  const body = parsed.data;

  try {
    const [contact] = await db
      .insert(networkContacts)
      .values({
        userId: user.sub,
        email: body.email.toLowerCase(),
        displayName: body.displayName,
        company: body.company ?? null,
        title: body.title ?? null,
        notes: body.notes ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!contact) {
      // Already exists — return the existing one
      const existing = await db.query.networkContacts.findFirst({
        where: and(
          eq(networkContacts.userId, user.sub),
          eq(networkContacts.email, body.email.toLowerCase()),
        ),
      });
      return c.json({ ok: true, contact: existing, alreadyExists: true });
    }

    return c.json({ ok: true, contact });
  } catch (err) {
    console.error("[Network] Failed to add contact:", err);
    return c.json(
      { error: `Database error: ${(err as Error).message}` },
      500,
    );
  }
});

// POST /network/batch — bulk add contacts
const batchAddSchema = z.object({
  contacts: z.array(
    z.object({
      email: z.string().email(),
      displayName: z.string().min(1),
      company: z.string().nullish(),
      title: z.string().nullish(),
      notes: z.string().nullish(),
    }),
  ),
});

networkRoutes.post("/batch", async (c) => {
  const user = c.get("user");
  const rawBody = await c.req.json().catch(() => null);
  const parsed = batchAddSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  let added = 0;
  for (const item of parsed.data.contacts) {
    const [result] = await db
      .insert(networkContacts)
      .values({
        userId: user.sub,
        email: item.email.toLowerCase(),
        displayName: item.displayName,
        company: item.company ?? null,
        title: item.title ?? null,
        notes: item.notes ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (result) added++;
  }

  return c.json({ ok: true, added, total: parsed.data.contacts.length });
});

// ── Follow-Up Queue ─────────────────────────────────────────────────────────
// NOTE: These must be registered BEFORE /:id routes to avoid path conflicts

// GET /network/follow-ups — pending follow-ups with contact info
networkRoutes.get("/follow-ups", async (c) => {
  const user = c.get("user");
  const now = new Date();

  // Get all network contact IDs for this user
  const contacts = await db.query.networkContacts.findMany({
    where: eq(networkContacts.userId, user.sub),
  });

  if (contacts.length === 0) {
    return c.json({ ok: true, followUps: [] });
  }

  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const contactIds = contacts.map((c) => c.id);

  // Get pending + due snoozed follow-ups
  const items = await db.query.followUpQueue.findMany({
    where: and(
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
    orderBy: (fq, { desc }) => [desc(fq.surfacedAt)],
  });

  // Enrich with contact info
  const followUps = items.map((item) => ({
    ...item,
    contact: contactMap.get(item.networkContactId) ?? null,
  }));

  return c.json({ ok: true, followUps });
});

// POST /network/follow-ups/:id/action — act on a follow-up
const followUpActionSchema = z.object({
  action: z.enum(["act", "snooze", "dismiss"]),
  snoozeDays: z.number().min(1).max(90).optional(),
});

networkRoutes.post("/follow-ups/:id/action", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid follow-up ID" }, 400);
  }

  const rawBody = await c.req.json().catch(() => null);
  const parsed = followUpActionSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  const body = parsed.data;

  if (body.action === "snooze") {
    const snoozeDays = body.snoozeDays ?? 7;
    const snoozedUntil = new Date(
      Date.now() + snoozeDays * 24 * 60 * 60 * 1000,
    );

    await db
      .update(followUpQueue)
      .set({ status: "snoozed", snoozedUntil })
      .where(eq(followUpQueue.id, id));
  } else {
    const newStatus = body.action === "act" ? "acted" : "dismissed";
    await db
      .update(followUpQueue)
      .set({ status: newStatus })
      .where(eq(followUpQueue.id, id));

    // When dismissing, mark the contact's thread as "conversation_ended"
    // so no new follow-ups are generated until a new thread starts
    if (newStatus === "dismissed") {
      const followUp = await db.query.followUpQueue.findFirst({
        where: eq(followUpQueue.id, id),
        columns: { networkContactId: true },
      });
      if (followUp) {
        await db
          .update(networkContacts)
          .set({ threadStatus: "conversation_ended" })
          .where(
            and(
              eq(networkContacts.id, followUp.networkContactId),
              eq(networkContacts.userId, user.sub),
            ),
          );
      }
    }
  }

  return c.json({ ok: true });
});

// POST /network/follow-ups/:id/draft — generate AI draft on demand
networkRoutes.post("/follow-ups/:id/draft", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid follow-up ID" }, 400);
  }

  // Get the follow-up
  const followUp = await db.query.followUpQueue.findFirst({
    where: eq(followUpQueue.id, id),
  });

  if (!followUp) {
    return c.json({ error: "Follow-up not found" }, 404);
  }

  // Get the contact
  const contact = await db.query.networkContacts.findFirst({
    where: and(
      eq(networkContacts.id, followUp.networkContactId),
      eq(networkContacts.userId, user.sub),
    ),
  });

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
  }

  // Get sender summary
  const summary = await db.query.senderSummaries.findFirst({
    where: and(
      eq(senderSummaries.userId, user.sub),
      eq(senderSummaries.senderEmail, contact.email),
    ),
  });

  // Get personal facts
  const facts = await db.query.contactContext.findMany({
    where: and(
      eq(contactContext.networkContactId, contact.id),
      eq(contactContext.expired, false),
    ),
    orderBy: (cc, { desc }) => [desc(cc.extractedAt)],
    limit: 10,
  });

  const draft = await generateFollowUpDraft({
    contactName: contact.displayName,
    contactEmail: contact.email,
    senderSummary: summary?.summary ?? null,
    reason: followUp.reason,
    contextSnapshot: followUp.contextSnapshot ?? "",
    personalFacts: facts.map((f) => f.fact),
    lastSubject: contact.lastSubject ?? null,
  });

  // Save the draft on the follow-up record
  await db
    .update(followUpQueue)
    .set({ aiDraft: draft })
    .where(eq(followUpQueue.id, id));

  return c.json({ ok: true, draft });
});

// ── Seed Flow ───────────────────────────────────────────────────────────────
// NOTE: Must be registered BEFORE /:id routes to avoid path conflicts

// POST /network/seed — discover top contacts from Gmail sent history (SSE)
const SEED_LIMIT = 5000;

networkRoutes.post("/seed", async (c) => {
  const user = c.get("user");
  const rawBody = await c.req.json().catch(() => ({})) as { resumeToken?: string };

  // Get Gmail tokens
  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, user.sub),
  });

  if (!connection) {
    return c.json({ error: "Gmail not connected" }, 422);
  }

  let tokens = connection.googleTokens as GoogleTokens;
  if (
    tokens.expiry_date &&
    tokens.expiry_date < Date.now() + 5 * 60 * 1000
  ) {
    tokens = await refreshAccessToken(tokens);
    await db
      .update(gmailConnections)
      .set({ googleTokens: tokens, updatedAt: new Date() })
      .where(eq(gmailConnections.id, connection.id));
  }

  const userEmail = connection.gmailAddress.toLowerCase();

  const { google } = await import("googleapis");
  const authClient = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
  authClient.setCredentials({
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
    token_type: tokens.token_type ?? undefined,
    scope: tokens.scope ?? undefined,
  });
  const gmail = google.gmail({ version: "v1", auth: authClient });

  // Stream progress via SSE
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(
          new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const recipientCounts = new Map<
          string,
          { email: string; name: string; count: number }
        >();
        let pageToken: string | undefined = rawBody.resumeToken || undefined;
        let totalFetched = 0;

        send("progress", { fetched: 0, limit: SEED_LIMIT, phase: pageToken ? "Resuming scan..." : "Scanning sent mail..." });

        while (totalFetched < SEED_LIMIT) {
          const listRes: any = await gmail.users.messages.list({
            userId: "me",
            q: "in:sent",
            maxResults: Math.min(100, SEED_LIMIT - totalFetched),
            pageToken,
          });

          const messages = listRes.data.messages ?? [];
          if (messages.length === 0) break;

          // Fetch To headers in parallel (batches of 20)
          for (let i = 0; i < messages.length; i += 20) {
            const batch = messages.slice(i, i + 20);
            const details = await Promise.all(
              batch.map((msg: any) =>
                gmail.users.messages
                  .get({
                    userId: "me",
                    id: msg.id,
                    format: "metadata",
                    metadataHeaders: ["To", "Cc", "From"],
                  })
                  .catch(() => null),
              ),
            );

            for (const detail of details) {
              if (!detail?.data?.payload?.headers) continue;

              const toHeader = detail.data.payload.headers.find(
                (h: any) => h.name === "To",
              )?.value;
              const ccHeader = detail.data.payload.headers.find(
                (h: any) => h.name === "Cc",
              )?.value;

              const allRecipients = [toHeader, ccHeader].filter(Boolean).join(",");
              if (!allRecipients) continue;

              const recipients = allRecipients.split(",").map((r: string) => r.trim());
              for (const recipient of recipients) {
                const emailMatch = recipient.match(/<([^>]+)>/);
                const email = (emailMatch?.[1] ?? recipient).toLowerCase().trim();

                if (isNoiseEmail(email, userEmail)) continue;

                const nameMatch = recipient.match(/^([^<]+)</);
                const name = nameMatch?.[1]?.trim()?.replace(/"/g, "") ?? "";

                const existing = recipientCounts.get(email);
                if (existing) {
                  existing.count++;
                  if (!existing.name && name) existing.name = name;
                } else {
                  recipientCounts.set(email, { email, name, count: 1 });
                }
              }
            }

            // Send progress after each batch of 20
            totalFetched += batch.length;
            send("progress", {
              fetched: totalFetched,
              limit: SEED_LIMIT,
              contacts: recipientCounts.size,
              phase: `Scanned ${totalFetched.toLocaleString()} sent emails...`,
            });
          }

          pageToken = listRes.data.nextPageToken;
          if (!pageToken) break;
        }

        send("progress", {
          fetched: totalFetched,
          limit: SEED_LIMIT,
          contacts: recipientCounts.size,
          phase: "Checking received emails...",
        });

        // Also include senders from received emails (from email_queue DB)
        // This catches contacts who email P.J. but he hasn't sent to frequently
        try {
          const receivedRows = await db
            .select({
              email: emailQueue.fromEmail,
              name: emailQueue.fromName,
              count: sql<number>`count(*)::int`,
            })
            .from(emailQueue)
            .where(eq(emailQueue.userId, user.sub))
            .groupBy(emailQueue.fromEmail, emailQueue.fromName);

          for (const row of receivedRows) {
            const email = row.email.toLowerCase().trim();
            if (isNoiseEmail(email, userEmail)) continue;

            const existing = recipientCounts.get(email);
            if (existing) {
              existing.count += row.count;
              if (!existing.name && row.name) existing.name = row.name;
            } else {
              recipientCounts.set(email, {
                email,
                name: row.name || "",
                count: row.count,
              });
            }
          }
        } catch (err) {
          // Non-fatal — still return sent-only results
          console.warn("Failed to query received emails for seed:", err);
        }

        send("progress", {
          fetched: totalFetched,
          limit: SEED_LIMIT,
          contacts: recipientCounts.size,
          phase: "Preparing results...",
        });

        // Sort by frequency (return all — frontend handles search/display)
        const sorted = [...recipientCounts.values()]
          .sort((a, b) => b.count - a.count);

        // Exclude already-added contacts
        const existingContacts = await db.query.networkContacts.findMany({
          where: eq(networkContacts.userId, user.sub),
          columns: { email: true },
        });
        const existingSet = new Set(existingContacts.map((nc) => nc.email));

        // Enrich with sender summaries
        const allSummaries = await db.query.senderSummaries.findMany({
          where: eq(senderSummaries.userId, user.sub),
        });
        const summaryMap = new Map(
          allSummaries.map((s) => [s.senderEmail, s.summary]),
        );

        const suggestions = sorted
          .filter((r) => !existingSet.has(r.email))
          .map((r) => ({
            email: r.email,
            displayName: r.name || r.email.split("@")[0],
            messageCount: r.count,
            senderSummary: summaryMap.get(r.email) ?? null,
          }));

        send("done", { suggestions, totalScanned: totalFetched, resumeToken: pageToken ?? null, hasMore: !!pageToken });
      } catch (err: any) {
        send("error", { message: err.message ?? "Seed failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ── Thread Scan — find unresolved threads for follow-up ──────────────────────

const THREAD_SCAN_LIMIT = 5000;

networkRoutes.post("/scan-threads", async (c) => {
  const user = c.get("user");
  const rawBody = await c.req.json().catch(() => ({})) as { resumeToken?: string };

  // Get Gmail tokens
  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, user.sub),
  });

  if (!connection) {
    return c.json({ error: "Gmail not connected" }, 422);
  }

  let tokens = connection.googleTokens as GoogleTokens;
  if (
    tokens.expiry_date &&
    tokens.expiry_date < Date.now() + 5 * 60 * 1000
  ) {
    tokens = await refreshAccessToken(tokens);
    await db
      .update(gmailConnections)
      .set({ googleTokens: tokens, updatedAt: new Date() })
      .where(eq(gmailConnections.id, connection.id));
  }

  const userEmail = connection.gmailAddress.toLowerCase();

  const { google } = await import("googleapis");
  const authClient = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
  authClient.setCredentials({
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
    token_type: tokens.token_type ?? undefined,
    scope: tokens.scope ?? undefined,
  });
  const gmail = google.gmail({ version: "v1", auth: authClient });

  // Stream progress via SSE
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(
          new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        // Load network contacts for this user
        const networkContactsList = await db.query.networkContacts.findMany({
          where: eq(networkContacts.userId, user.sub),
        });

        if (networkContactsList.length === 0) {
          send("done", { found: 0, totalScanned: 0, message: "Add contacts to your network first" });
          return;
        }

        const networkEmailMap = new Map(
          networkContactsList.map((nc) => [nc.email.toLowerCase(), nc]),
        );

        // Load existing pending/snoozed follow-ups to avoid duplicates
        const existingFollowUps = await db.query.followUpQueue.findMany({
          where: or(
            eq(followUpQueue.status, "pending"),
            eq(followUpQueue.status, "snoozed"),
          ),
        });
        const existingFollowUpKeys = new Set(
          existingFollowUps.map((fu) => `${fu.networkContactId}:${fu.reason}`),
        );

        let pageToken: string | undefined = rawBody.resumeToken || undefined;
        let totalFetched = 0;
        let followUpsCreated = 0;
        const now = Date.now();
        const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
        const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;

        send("progress", {
          fetched: 0,
          limit: THREAD_SCAN_LIMIT,
          found: 0,
          phase: pageToken ? "Resuming thread scan..." : "Scanning conversations...",
        });

        while (totalFetched < THREAD_SCAN_LIMIT) {
          // Fetch threads (not messages) — each thread is a conversation
          const listRes: any = await gmail.users.threads.list({
            userId: "me",
            q: "in:inbox -category:promotions -category:social -category:updates -category:forums",
            maxResults: Math.min(100, THREAD_SCAN_LIMIT - totalFetched),
            pageToken,
          });

          const threads = listRes.data.threads ?? [];
          if (threads.length === 0) break;

          // Process threads in batches of 10
          for (let i = 0; i < threads.length; i += 10) {
            const batch = threads.slice(i, i + 10);
            const threadDetails = await Promise.all(
              batch.map((t: any) =>
                gmail.users.threads
                  .get({
                    userId: "me",
                    id: t.id,
                    format: "metadata",
                    metadataHeaders: ["From", "To", "Date", "Subject", "List-Unsubscribe"],
                  })
                  .catch(() => null),
              ),
            );

            for (const detail of threadDetails) {
              if (!detail?.data?.messages?.length) continue;

              const messages = detail.data.messages;
              // Get the last message in the thread
              const lastMsg = messages[messages.length - 1];
              const lastHeaders: Record<string, string> = {};
              for (const h of lastMsg.payload?.headers ?? []) {
                if (h.name && h.value) {
                  lastHeaders[h.name.toLowerCase()] = h.value;
                }
              }

              const fromRaw = lastHeaders["from"] ?? "";
              const fromMatch = fromRaw.match(/<([^>]+)>/) ?? [null, fromRaw];
              const lastSenderEmail = (fromMatch[1] ?? fromRaw).toLowerCase().trim();
              const lastDate = lastHeaders["date"]
                ? new Date(lastHeaders["date"]).getTime()
                : 0;
              const subject = lastHeaders["subject"] ?? "(no subject)";
              const threadId = detail.data.id;

              // Skip newsletters/mass emails — List-Unsubscribe header is the
              // strongest signal that this is not a personal conversation
              if (lastHeaders["list-unsubscribe"]) continue;

              // Skip if sender is P.J. (he sent last — ball is in their court)
              if (lastSenderEmail === userEmail) {
                // Check if this is a network contact we should update
                const nc = networkEmailMap.get(lastSenderEmail);
                // Actually, the last sender is P.J. — check the To header for the recipient
                const toRaw = lastHeaders["to"] ?? "";
                const toMatch = toRaw.match(/<([^>]+)>/) ?? [null, toRaw];
                const recipientEmail = (toMatch[1] ?? toRaw).toLowerCase().trim();
                const recipientNc = networkEmailMap.get(recipientEmail);
                if (recipientNc && threadId) {
                  // Update contact: P.J. sent last, awaiting their reply
                  await db
                    .update(networkContacts)
                    .set({
                      lastContactAt: new Date(lastDate || now),
                      lastDirection: "sent",
                      threadStatus: "awaiting_their_reply",
                      gmailThreadId: threadId,
                      lastSubject: subject,
                    })
                    .where(eq(networkContacts.id, recipientNc.id));
                }
                continue;
              }

              // Skip noise / mass-email senders
              if (isNoiseEmail(lastSenderEmail, userEmail)) continue;

              // Only process network contacts
              const contact = networkEmailMap.get(lastSenderEmail);
              if (!contact) continue;

              // Skip contacts with "conversation_ended" status
              if (contact.threadStatus === "conversation_ended") continue;

              // Check if P.J. has already replied to this thread
              // Look through thread messages for any from P.J. after the last inbound
              let pjRepliedAfterLast = false;
              for (const msg of messages) {
                const msgHeaders: Record<string, string> = {};
                for (const h of msg.payload?.headers ?? []) {
                  if (h.name && h.value) {
                    msgHeaders[h.name.toLowerCase()] = h.value;
                  }
                }
                const msgFrom = msgHeaders["from"] ?? "";
                const msgFromMatch = msgFrom.match(/<([^>]+)>/) ?? [null, msgFrom];
                const msgSender = (msgFromMatch[1] ?? msgFrom).toLowerCase().trim();
                const msgDate = msgHeaders["date"]
                  ? new Date(msgHeaders["date"]).getTime()
                  : 0;

                if (msgSender === userEmail && msgDate > lastDate) {
                  pjRepliedAfterLast = true;
                  break;
                }
              }

              if (pjRepliedAfterLast) continue;

              // Update network contact thread state
              await db
                .update(networkContacts)
                .set({
                  lastContactAt: new Date(lastDate || now),
                  lastDirection: "received",
                  threadStatus: "awaiting_your_reply",
                  gmailThreadId: threadId ?? undefined,
                  lastSubject: subject,
                })
                .where(eq(networkContacts.id, contact.id));

              // Determine follow-up reason
              let reason: string;
              let suggestedAction: string;
              let contextSnapshot: string;

              if (lastDate > fourteenDaysAgo) {
                // Recent enough to be "ball in your court"
                reason = "ball_in_your_court";
                suggestedAction = "reply";
                const daysAgo = Math.floor((now - lastDate) / (24 * 60 * 60 * 1000));
                contextSnapshot = `${contact.displayName} emailed you ${daysAgo}d ago: "${subject}"`;
              } else {
                // Older than 14 days — went cold
                reason = "went_cold";
                suggestedAction = "nudge";
                const daysAgo = Math.floor((now - lastDate) / (24 * 60 * 60 * 1000));
                contextSnapshot = `Last heard from ${contact.displayName} ${daysAgo}d ago: "${subject}"`;
              }

              // Only if older than 2 days (don't flag very recent emails)
              if (lastDate > twoDaysAgo) continue;

              // Skip if follow-up already exists
              const key = `${contact.id}:${reason}`;
              if (existingFollowUpKeys.has(key)) continue;

              // Insert follow-up
              await db.insert(followUpQueue).values({
                networkContactId: contact.id,
                reason,
                suggestedAction,
                contextSnapshot,
              });
              existingFollowUpKeys.add(key);
              followUpsCreated++;
            }

            totalFetched += batch.length;
            send("progress", {
              fetched: totalFetched,
              limit: THREAD_SCAN_LIMIT,
              found: followUpsCreated,
              phase: `Scanned ${totalFetched.toLocaleString()} threads...`,
            });
          }

          pageToken = listRes.data.nextPageToken;
          if (!pageToken) break;
        }

        // Also check for date_coming_up follow-ups
        const sevenDaysFromNow = new Date(now + 7 * 24 * 60 * 60 * 1000);
        const upcomingFacts = await db.query.contactContext.findMany({
          where: and(
            eq(contactContext.expired, false),
            lte(contactContext.dateRelevant, sevenDaysFromNow),
          ),
        });

        for (const fact of upcomingFacts) {
          if (!fact.dateRelevant || fact.dateRelevant.getTime() < now) continue;
          const key = `${fact.networkContactId}:date_coming_up`;
          if (existingFollowUpKeys.has(key)) continue;

          // Look up the contact name
          const factContact = networkContactsList.find(
            (nc) => nc.id === fact.networkContactId,
          );
          if (!factContact) continue;

          const daysUntil = Math.ceil(
            (fact.dateRelevant.getTime() - now) / (24 * 60 * 60 * 1000),
          );
          await db.insert(followUpQueue).values({
            networkContactId: fact.networkContactId,
            reason: "date_coming_up",
            suggestedAction: "nudge",
            contextSnapshot: `${factContact.displayName}: ${fact.fact} (in ${daysUntil} day${daysUntil === 1 ? "" : "s"})`,
          });
          existingFollowUpKeys.add(key);
          followUpsCreated++;
        }

        send("done", {
          found: followUpsCreated,
          totalScanned: totalFetched,
          resumeToken: pageToken ?? null,
          hasMore: !!pageToken,
        });
      } catch (err: any) {
        send("error", { message: err.message ?? "Thread scan failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ── Save Draft to Gmail ─────────────────────────────────────────────────────

networkRoutes.post("/follow-ups/:id/save-draft", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid follow-up ID" }, 400);
  }

  const rawBody = await c.req.json().catch(() => null) as { body?: string } | null;
  if (!rawBody?.body?.trim()) {
    return c.json({ error: "Draft body is required" }, 400);
  }

  // Get the follow-up
  const followUp = await db.query.followUpQueue.findFirst({
    where: eq(followUpQueue.id, id),
  });

  if (!followUp) {
    return c.json({ error: "Follow-up not found" }, 404);
  }

  // Get the contact
  const contact = await db.query.networkContacts.findFirst({
    where: and(
      eq(networkContacts.id, followUp.networkContactId),
      eq(networkContacts.userId, user.sub),
    ),
  });

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
  }

  // Get Gmail tokens
  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, user.sub),
  });

  if (!connection) {
    return c.json({ error: "Gmail not connected" }, 422);
  }

  let tokens = connection.googleTokens as GoogleTokens;
  if (
    tokens.expiry_date &&
    tokens.expiry_date < Date.now() + 5 * 60 * 1000
  ) {
    tokens = await refreshAccessToken(tokens);
    await db
      .update(gmailConnections)
      .set({ googleTokens: tokens, updatedAt: new Date() })
      .where(eq(gmailConnections.id, connection.id));
  }

  let draftId: string;

  if (followUp.suggestedAction === "reply" && contact.gmailThreadId) {
    // Reply in existing thread
    draftId = await createDraft(tokens, {
      threadId: contact.gmailThreadId,
      to: contact.email,
      subject: contact.lastSubject ?? "Re: ",
      body: rawBody.body.trim(),
    });
  } else {
    // New nudge email — compose fresh
    draftId = await createDraft(tokens, {
      threadId: "",
      to: contact.email,
      subject: "Checking in",
      body: rawBody.body.trim(),
    });
  }

  // Mark follow-up as acted
  await db
    .update(followUpQueue)
    .set({ status: "acted", aiDraft: rawBody.body.trim() })
    .where(eq(followUpQueue.id, id));

  return c.json({ ok: true, draftId });
});

// ── Parameterized routes (/:id) — must come AFTER literal paths ─────────────

// GET /network/:id — single contact with context and follow-ups
networkRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid contact ID" }, 400);
  }

  const contact = await db.query.networkContacts.findFirst({
    where: and(
      eq(networkContacts.id, id),
      eq(networkContacts.userId, user.sub),
    ),
  });

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
  }

  // Get sender summary
  const summary = await db.query.senderSummaries.findFirst({
    where: and(
      eq(senderSummaries.userId, user.sub),
      eq(senderSummaries.senderEmail, contact.email),
    ),
  });

  // Get context facts
  const facts = await db.query.contactContext.findMany({
    where: and(
      eq(contactContext.networkContactId, id),
      eq(contactContext.expired, false),
    ),
    orderBy: (cc, { desc }) => [desc(cc.extractedAt)],
  });

  // Get pending follow-ups
  const pendingFollowUps = await db.query.followUpQueue.findMany({
    where: and(
      eq(followUpQueue.networkContactId, id),
      or(
        eq(followUpQueue.status, "pending"),
        eq(followUpQueue.status, "snoozed"),
      ),
    ),
    orderBy: (fq, { desc }) => [desc(fq.surfacedAt)],
  });

  return c.json({
    ok: true,
    contact,
    senderSummary: summary?.summary ?? null,
    facts,
    followUps: pendingFollowUps,
  });
});

// PUT /network/:id — update a contact
networkRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid contact ID" }, 400);
  }

  const body = await c.req.json<{
    displayName?: string;
    company?: string | null;
    title?: string | null;
    notes?: string | null;
  }>();

  await db
    .update(networkContacts)
    .set({
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.company !== undefined && { company: body.company }),
      ...(body.title !== undefined && { title: body.title }),
      ...(body.notes !== undefined && { notes: body.notes }),
    })
    .where(
      and(eq(networkContacts.id, id), eq(networkContacts.userId, user.sub)),
    );

  return c.json({ ok: true });
});

// DELETE /network/:id — remove a contact (cascades context + follow-ups)
networkRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid contact ID" }, 400);
  }

  await db
    .delete(networkContacts)
    .where(
      and(eq(networkContacts.id, id), eq(networkContacts.userId, user.sub)),
    );

  return c.json({ ok: true });
});

// ── Contact Context (Personal Facts) ────────────────────────────────────────

// GET /network/:id/context — get facts for a contact
networkRoutes.get("/:id/context", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid contact ID" }, 400);
  }

  // Verify ownership
  const contact = await db.query.networkContacts.findFirst({
    where: and(
      eq(networkContacts.id, id),
      eq(networkContacts.userId, user.sub),
    ),
    columns: { id: true },
  });

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
  }

  const facts = await db.query.contactContext.findMany({
    where: and(
      eq(contactContext.networkContactId, id),
      eq(contactContext.expired, false),
    ),
    orderBy: (cc, { desc }) => [desc(cc.extractedAt)],
  });

  return c.json({ ok: true, facts });
});

// POST /network/:id/context — add a fact manually
const addFactSchema = z.object({
  fact: z.string().min(1).max(500),
  dateRelevant: z.string().nullish(),
});

networkRoutes.post("/:id/context", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid contact ID" }, 400);
  }

  const rawBody = await c.req.json().catch(() => null);
  const parsed = addFactSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  // Verify ownership
  const contact = await db.query.networkContacts.findFirst({
    where: and(
      eq(networkContacts.id, id),
      eq(networkContacts.userId, user.sub),
    ),
    columns: { id: true },
  });

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
  }

  const [fact] = await db
    .insert(contactContext)
    .values({
      networkContactId: id,
      fact: parsed.data.fact,
      dateRelevant: parsed.data.dateRelevant
        ? new Date(parsed.data.dateRelevant)
        : null,
      sourceSubject: "Manual entry",
    })
    .returning();

  return c.json({ ok: true, fact });
});

// DELETE /network/:id/context/:factId — remove a fact
networkRoutes.delete("/:id/context/:factId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const factId = c.req.param("factId");

  if (!UUID_RE.test(id) || !UUID_RE.test(factId)) {
    return c.json({ error: "Invalid ID" }, 400);
  }

  // Verify ownership
  const contact = await db.query.networkContacts.findFirst({
    where: and(
      eq(networkContacts.id, id),
      eq(networkContacts.userId, user.sub),
    ),
    columns: { id: true },
  });

  if (!contact) {
    return c.json({ error: "Contact not found" }, 404);
  }

  await db
    .delete(contactContext)
    .where(
      and(
        eq(contactContext.id, factId),
        eq(contactContext.networkContactId, id),
      ),
    );

  return c.json({ ok: true });
});

