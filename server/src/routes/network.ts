import { Hono } from "hono";
import { eq, ne, and, or, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  networkContacts,
  contactContext,
  followUpQueue,
  senderSummaries,
  gmailConnections,
  emailQueue,
  outboundMessages,
  userNoiseList,
  voiceProfiles,
  userPreferences,
} from "../db/schema.js";
import { authMiddleware, type AuthUser } from "../middleware/auth.js";
import { env } from "../config.js";
import {
  fetchSenderHistory,
  fetchSentEmailsToContact,
  refreshAccessToken,
  createDraft,
  sendReply,
  type GoogleTokens,
} from "../lib/gmail.js";
import {
  buildSenderSummaryFromHistory,
  generateFollowUpDraft,
  generateDirectionSuggestions,
  pickVoiceBucket,
} from "../lib/claude.js";
import { draftSuggestsMeeting } from "../lib/meeting.js";
import { DEFAULT_CALENDAR_ASSISTANT_EMAIL } from "../lib/defaults.js";
import { isNoiseEmail } from "../lib/noise.js";

export const networkRoutes = new Hono<{ Variables: { user: AuthUser } }>();

networkRoutes.use("*", authMiddleware);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  phoneNumber: z.string().nullish(),
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
        phoneNumber: body.phoneNumber ?? null,
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
      phoneNumber: z.string().nullish(),
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
        phoneNumber: item.phoneNumber ?? null,
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

  // Get pending + due snoozed follow-ups. Exclude legacy ball_in_your_court
  // rows from the old rule — they're replaced by the main email queue.
  const items = await db.query.followUpQueue.findMany({
    where: and(
      sql`${followUpQueue.networkContactId} IN (${sql.join(
        contactIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
      ne(followUpQueue.reason, "ball_in_your_court"),
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
  action: z.enum(["act", "snooze", "dismiss", "noise"]),
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

  if (body.action === "noise") {
    // "Not a person" — permanently block this sender:
    // 1. Look up the contact
    const followUp = await db.query.followUpQueue.findFirst({
      where: eq(followUpQueue.id, id),
      columns: { networkContactId: true },
    });
    if (!followUp) {
      return c.json({ error: "Follow-up not found" }, 404);
    }

    const contact = await db.query.networkContacts.findFirst({
      where: and(
        eq(networkContacts.id, followUp.networkContactId),
        eq(networkContacts.userId, user.sub),
      ),
      columns: { id: true, email: true, displayName: true },
    });
    if (!contact) {
      return c.json({ error: "Contact not found" }, 404);
    }

    // 2. Add to user's noise list
    await db
      .insert(userNoiseList)
      .values({
        userId: user.sub,
        email: contact.email.toLowerCase(),
        displayName: contact.displayName,
      })
      .onConflictDoNothing();

    // 3. Dismiss ALL pending/snoozed follow-ups for this contact
    const allContactFollowUps = await db.query.followUpQueue.findMany({
      where: and(
        eq(followUpQueue.networkContactId, contact.id),
        or(
          eq(followUpQueue.status, "pending"),
          eq(followUpQueue.status, "snoozed"),
        ),
      ),
      columns: { id: true },
    });
    for (const fu of allContactFollowUps) {
      await db
        .update(followUpQueue)
        .set({ status: "dismissed" })
        .where(eq(followUpQueue.id, fu.id));
    }

    // 4. Delete the contact from network
    await db
      .delete(networkContacts)
      .where(
        and(
          eq(networkContacts.id, contact.id),
          eq(networkContacts.userId, user.sub),
        ),
      );

    console.log(`[Noise] Blocked sender: ${contact.email} (${contact.displayName})`);
  } else if (body.action === "snooze") {
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
    // and record which thread was dismissed so the classifier won't re-flag it
    if (newStatus === "dismissed") {
      const followUp = await db.query.followUpQueue.findFirst({
        where: eq(followUpQueue.id, id),
        columns: { networkContactId: true },
      });
      if (followUp) {
        const contact = await db.query.networkContacts.findFirst({
          where: and(
            eq(networkContacts.id, followUp.networkContactId),
            eq(networkContacts.userId, user.sub),
          ),
          columns: { gmailThreadId: true },
        });
        await db
          .update(networkContacts)
          .set({
            threadStatus: "conversation_ended",
            dismissedGmailThreadId: contact?.gmailThreadId ?? null,
          })
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

// POST /network/follow-ups/:id/draft — generate or refine AI draft.
// Body: { direction?, previousDraft?, feedback? }
networkRoutes.post("/follow-ups/:id/draft", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid follow-up ID" }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    direction?: string;
    previousDraft?: string;
    feedback?: string;
    voiceBucketId?: string;
  };

  const followUp = await db.query.followUpQueue.findFirst({
    where: eq(followUpQueue.id, id),
  });
  if (!followUp) return c.json({ error: "Follow-up not found" }, 404);

  const contact = await db.query.networkContacts.findFirst({
    where: and(
      eq(networkContacts.id, followUp.networkContactId),
      eq(networkContacts.userId, user.sub),
    ),
  });
  if (!contact) return c.json({ error: "Contact not found" }, 404);

  const summary = await db.query.senderSummaries.findFirst({
    where: and(
      eq(senderSummaries.userId, user.sub),
      eq(senderSummaries.senderEmail, contact.email),
    ),
  });

  const facts = await db.query.contactContext.findMany({
    where: and(
      eq(contactContext.networkContactId, contact.id),
      eq(contactContext.expired, false),
    ),
    orderBy: (cc, { desc }) => [desc(cc.extractedAt)],
    limit: 10,
  });

  // Voice match: prefer per-contact few-shot from prior sent emails;
  // fall back to picking the best matching voice bucket.
  const buckets = await db.query.voiceProfiles.findMany({
    where: eq(voiceProfiles.userId, user.sub),
  });

  let fewShotExamples: { subject: string; body: string }[] = [];
  let voiceLabel: string | null = null;
  let voiceSource: "history" | "bucket" | "default" = "default";
  let voiceContext: Parameters<typeof generateFollowUpDraft>[0]["voice"] = null;
  let activeBucketId: string | null = null;

  // Explicit voice override: skip few-shot, use the chosen bucket
  if (body.voiceBucketId) {
    const picked = buckets.find((b) => b.id === body.voiceBucketId);
    if (picked) {
      activeBucketId = picked.id;
      voiceSource = "bucket";
      voiceLabel = picked.label;
      voiceContext = {
        label: picked.label,
        description: picked.description,
        formalityScore: Number(picked.formalityScore ?? 50),
        greetingHabits: picked.greetingHabits ?? "",
        signOffHabits: picked.signOffHabits ?? "",
        sentenceStyle: picked.sentenceStyle ?? "",
        samplePhrases: Array.isArray(picked.samplePhrases)
          ? (picked.samplePhrases as string[])
          : [],
      };
    }
  } else {
    // Pull Gmail tokens once if we'll need them
    const connection = await db.query.gmailConnections.findFirst({
      where: eq(gmailConnections.userId, user.sub),
    });
    if (connection) {
      let tokens = connection.googleTokens as GoogleTokens;
      if (
        tokens.expiry_date &&
        tokens.expiry_date < Date.now() + 5 * 60 * 1000
      ) {
        try {
          tokens = await refreshAccessToken(tokens);
          await db
            .update(gmailConnections)
            .set({ googleTokens: tokens, updatedAt: new Date() })
            .where(eq(gmailConnections.id, connection.id));
        } catch {}
      }
      try {
        const prior = await fetchSentEmailsToContact(tokens, contact.email, 3);
        if (prior.length >= 2) {
          fewShotExamples = prior.map((p) => ({
            subject: p.subject,
            body: p.body,
          }));
          voiceSource = "history";
          voiceLabel = "Your prior emails to this contact";
        }
      } catch (err) {
        console.warn("Few-shot fetch failed:", err);
      }
    }

    if (voiceSource !== "history" && buckets.length > 0) {
      const picked = pickVoiceBucket(buckets, {
        email: contact.email,
        senderSummary: summary?.summary ?? null,
      });
      if (picked) {
        activeBucketId = picked.id;
        voiceSource = "bucket";
        voiceLabel = picked.label;
        voiceContext = {
          label: picked.label,
          description: picked.description,
          formalityScore: Number(picked.formalityScore ?? 50),
          greetingHabits: picked.greetingHabits ?? "",
          signOffHabits: picked.signOffHabits ?? "",
          sentenceStyle: picked.sentenceStyle ?? "",
          samplePhrases: Array.isArray(picked.samplePhrases)
            ? (picked.samplePhrases as string[])
            : [],
        };
      }
    }
  }

  const draft = await generateFollowUpDraft({
    contactName: contact.displayName,
    contactEmail: contact.email,
    senderSummary: summary?.summary ?? null,
    reason: followUp.reason,
    contextSnapshot: followUp.contextSnapshot ?? "",
    personalFacts: facts.map((f) => f.fact),
    lastSubject: contact.lastSubject ?? null,
    direction: body.direction?.trim() || null,
    previousDraft: body.previousDraft?.trim() || null,
    feedback: body.feedback?.trim() || null,
    voice: voiceContext,
    fewShotExamples,
  });

  await db
    .update(followUpQueue)
    .set({ aiDraft: draft })
    .where(eq(followUpQueue.id, id));

  const prefs = await db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, user.sub),
    columns: { lucaEmail: true },
  });

  return c.json({
    ok: true,
    draft,
    voiceLabel,
    voiceSource,
    activeBucketId,
    availableBuckets: buckets.map((b) => ({
      id: b.id,
      label: b.label,
      formalityScore: Number(b.formalityScore ?? 50),
    })),
    suggestsMeeting: draftSuggestsMeeting(draft),
    lucaEmail: prefs?.lucaEmail ?? DEFAULT_CALENDAR_ASSISTANT_EMAIL,
  });
});

// POST /network/follow-ups/:id/suggestions — 3-4 direction chips for the draft
networkRoutes.post("/follow-ups/:id/suggestions", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid follow-up ID" }, 400);
  }

  const followUp = await db.query.followUpQueue.findFirst({
    where: eq(followUpQueue.id, id),
  });
  if (!followUp) return c.json({ error: "Follow-up not found" }, 404);

  const contact = await db.query.networkContacts.findFirst({
    where: and(
      eq(networkContacts.id, followUp.networkContactId),
      eq(networkContacts.userId, user.sub),
    ),
  });
  if (!contact) return c.json({ error: "Contact not found" }, 404);

  const summary = await db.query.senderSummaries.findFirst({
    where: and(
      eq(senderSummaries.userId, user.sub),
      eq(senderSummaries.senderEmail, contact.email),
    ),
  });

  const suggestions = await generateDirectionSuggestions({
    contactName: contact.displayName,
    reason: followUp.reason,
    contextSnapshot: followUp.contextSnapshot ?? "",
    lastSubject: contact.lastSubject ?? null,
    senderSummary: summary?.summary ?? null,
  });

  return c.json({ ok: true, suggestions });
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

  // Load per-user noise list
  const seedNoiseRows = await db.query.userNoiseList.findMany({
    where: eq(userNoiseList.userId, user.sub),
    columns: { email: true },
  });
  const userNoiseSet = new Set(seedNoiseRows.map((r) => r.email.toLowerCase()));

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
                if (userNoiseSet.has(email)) continue;

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
            if (userNoiseSet.has(email)) continue;

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
    try {
      tokens = await refreshAccessToken(tokens);
      await db
        .update(gmailConnections)
        .set({ googleTokens: tokens, updatedAt: new Date() })
        .where(eq(gmailConnections.id, connection.id));
    } catch (err) {
      // Token may have been refreshed by a concurrent request (e.g. /emails/scan).
      // Re-read from DB to pick up the freshest tokens before giving up.
      const refreshed = await db.query.gmailConnections.findFirst({
        where: eq(gmailConnections.id, connection.id),
      });
      const updated = refreshed?.googleTokens as GoogleTokens | undefined;
      if (updated?.expiry_date && updated.expiry_date > Date.now() + 60_000) {
        tokens = updated;
      } else {
        console.error("scan-threads token refresh failed:", err);
        return c.json({ error: "Gmail token refresh failed — reconnect required" }, 401);
      }
    }
  }

  const userEmail = connection.gmailAddress.toLowerCase();

  // Load per-user noise list
  const scanNoiseRows = await db.query.userNoiseList.findMany({
    where: eq(userNoiseList.userId, user.sub),
    columns: { email: true },
  });
  const scanNoiseSet = new Set(scanNoiseRows.map((r) => r.email.toLowerCase()));

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

              // Skip noise / mass-email senders (static + per-user)
              if (isNoiseEmail(lastSenderEmail, userEmail)) continue;
              if (scanNoiseSet.has(lastSenderEmail)) continue;

              // Only process network contacts
              const contact = networkEmailMap.get(lastSenderEmail);
              if (!contact) continue;

              // Skip contacts with "conversation_ended" status
              if (contact.threadStatus === "conversation_ended") continue;

              // Check if P.J. has replied to this thread after the contact's
              // second-to-last message. We know the contact sent the last message
              // (we filtered out P.J.-last threads above). Walk through all
              // messages to find the latest non-PJ message before the last one,
              // then check if P.J. replied between it and the contact's last msg.
              //
              // More precisely: find the last message from the contact, then check
              // if P.J. sent ANY message after the previous contact message.
              // If the last message is the ONLY message from the contact, check
              // if P.J. sent anything after any earlier message.
              let pjRepliedAfterPrevious = false;
              {
                // Parse all messages with sender + date
                const threadMsgs = messages.map((msg: any) => {
                  const mh: Record<string, string> = {};
                  for (const h of msg.payload?.headers ?? []) {
                    if (h.name && h.value) mh[h.name.toLowerCase()] = h.value;
                  }
                  const mFrom = mh["from"] ?? "";
                  const mMatch = mFrom.match(/<([^>]+)>/) ?? [null, mFrom];
                  return {
                    sender: (mMatch[1] ?? mFrom).toLowerCase().trim(),
                    date: mh["date"] ? new Date(mh["date"]).getTime() : 0,
                  };
                });

                // Find the second-to-last contact message (the one P.J. should
                // have replied to before the contact sent again)
                const contactMsgs = threadMsgs.filter((m: any) => m.sender !== userEmail);
                if (contactMsgs.length >= 2) {
                  const prevContactDate = contactMsgs[contactMsgs.length - 2].date;
                  // Check if P.J. replied between the previous and last contact messages
                  pjRepliedAfterPrevious = threadMsgs.some(
                    (m: any) => m.sender === userEmail && m.date > prevContactDate,
                  );
                }
                // If there's only one contact message, check if P.J. sent anything at all
                if (contactMsgs.length === 1) {
                  pjRepliedAfterPrevious = false; // no previous msg to reply to
                }
              }

              // If P.J. already replied after the previous contact message but the
              // contact sent again, that's a NEW message — P.J. needs to respond.
              // We only skip if there's clear evidence this was already handled.
              // Check the email queue: was this contact's latest email already
              // processed (reply/archive) in Genco?
              let alreadyProcessedInGenco = false;
              try {
                const latestQueued = await db.query.emailQueue.findFirst({
                  where: and(
                    eq(emailQueue.userId, user.sub),
                    eq(emailQueue.fromEmail, contact.email),
                  ),
                  orderBy: (eq: any, { desc: d }: any) => [d(eq.receivedAt)],
                  columns: { chosenAction: true },
                });
                if (latestQueued?.chosenAction === "reply" || latestQueued?.chosenAction === "archive") {
                  alreadyProcessedInGenco = true;
                }
              } catch (_) {}

              if (alreadyProcessedInGenco) continue;

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

              // Contact-sent-last threads surface in the main email queue.
              // The Follow Up section only tracks threads where P.J. sent
              // last and is awaiting their reply — handled by detectFollowUps
              // on scan and by the daily cron. Nothing to insert here.
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

// ── Send Follow-Up Email Directly ───────────────────────────────────────────

networkRoutes.post("/follow-ups/:id/send", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid follow-up ID" }, 400);
  }

  const rawBody = (await c.req.json().catch(() => null)) as {
    body?: string;
    cc?: string[];
  } | null;
  if (!rawBody?.body?.trim()) {
    return c.json({ error: "Email body is required" }, 400);
  }
  const cc = Array.isArray(rawBody.cc)
    ? rawBody.cc.filter((e) => typeof e === "string" && e.includes("@"))
    : [];

  const followUp = await db.query.followUpQueue.findFirst({
    where: eq(followUpQueue.id, id),
  });
  if (!followUp) return c.json({ error: "Follow-up not found" }, 404);

  const contact = await db.query.networkContacts.findFirst({
    where: and(
      eq(networkContacts.id, followUp.networkContactId),
      eq(networkContacts.userId, user.sub),
    ),
  });
  if (!contact) return c.json({ error: "Contact not found" }, 404);

  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, user.sub),
  });
  if (!connection) return c.json({ error: "Gmail not connected" }, 422);

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

  const messageId = await sendReply(tokens, {
    threadId: contact.gmailThreadId ?? "",
    to: contact.email,
    subject: contact.lastSubject ?? "Checking in",
    body: rawBody.body.trim(),
    cc,
  });

  // Update contact + follow-up state: P.J. just sent, now awaiting their reply
  const now = new Date();
  await db
    .update(networkContacts)
    .set({
      lastContactAt: now,
      lastDirection: "sent",
      threadStatus: "awaiting_their_reply",
    })
    .where(eq(networkContacts.id, contact.id));

  await db
    .update(followUpQueue)
    .set({ status: "acted", aiDraft: rawBody.body.trim() })
    .where(eq(followUpQueue.id, id));

  return c.json({ ok: true, messageId });
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

// ── Send Follow-Up as iMessage ───────────────────────────────────────────────

networkRoutes.post("/follow-ups/:id/send-imessage", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid follow-up ID" }, 400);
  }

  const rawBody = (await c.req.json().catch(() => null)) as {
    body?: string;
  } | null;
  if (!rawBody?.body?.trim()) {
    return c.json({ error: "Message body is required" }, 400);
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

  if (!contact.phoneNumber) {
    return c.json({ error: "Contact has no phone number" }, 422);
  }

  // Create outbound message for the bridge to send
  await db.insert(outboundMessages).values({
    userId: user.sub,
    recipientPhone: contact.phoneNumber,
    recipientName: contact.displayName,
    messageText: rawBody.body.trim(),
    sourceType: "follow_up_nudge",
    sourceId: followUp.id,
  });

  // Mark follow-up as acted
  await db
    .update(followUpQueue)
    .set({ status: "acted", aiDraft: rawBody.body.trim() })
    .where(eq(followUpQueue.id, id));

  return c.json({ ok: true });
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
    phoneNumber?: string | null;
  }>();

  await db
    .update(networkContacts)
    .set({
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.company !== undefined && { company: body.company }),
      ...(body.title !== undefined && { title: body.title }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.phoneNumber !== undefined && { phoneNumber: body.phoneNumber }),
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

