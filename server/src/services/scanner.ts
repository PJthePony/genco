import { eq, and, lt, or, lte, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  gmailConnections,
  emailQueue,
  briefingSources,
  networkContacts,
  followUpQueue,
  contactContext,
  userNoiseList,
} from "../db/schema.js";
import {
  fetchInboxEmails,
  refreshAccessToken,
  archiveMessage,
  hasUserRepliedToThread,
  type GoogleTokens,
  type RawEmail,
} from "../lib/gmail.js";
import { isNoiseEmail } from "../lib/noise.js";

export interface ScanResult {
  fetched: number;
  inserted: number;
  historical: number;
  skipped: number;
  autoArchived: number;
  alreadyReplied: number;
}

// Emails older than this are "historical" — used for sender context only,
// not shown in the decision queue.
const RECENT_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Scan a user's Gmail inbox for emails.
 *
 * First scan: fetches all inbox emails from the last 30 days. Emails older
 * than 24 hours are stored as "historical" (for sender context building).
 * Only recent emails go into the decision queue as "pending".
 *
 * Subsequent scans: uses historyId for incremental sync — only new emails.
 */
export async function scanInbox(userId: string): Promise<ScanResult> {
  // Reset deferred (skipped) emails that are older than 24 hours back to pending.
  // This makes skipped emails reappear in the next day's queue.
  const skipThreshold = new Date(Date.now() - RECENT_THRESHOLD_MS);
  const resetResult = await db
    .update(emailQueue)
    .set({ status: "pending", processedAt: null })
    .where(
      and(
        eq(emailQueue.userId, userId),
        eq(emailQueue.status, "skipped"),
        isNotNull(emailQueue.processedAt),
        lt(emailQueue.processedAt, skipThreshold),
      ),
    );

  // Get the user's Gmail connection
  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, userId),
  });

  if (!connection) {
    throw new Error("Gmail not connected");
  }

  let tokens = connection.googleTokens as GoogleTokens;

  // Refresh token if expiring soon (within 5 minutes)
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    try {
      tokens = await refreshAccessToken(tokens);
      await db
        .update(gmailConnections)
        .set({ googleTokens: tokens, updatedAt: new Date() })
        .where(eq(gmailConnections.id, connection.id));
      console.log(`Refreshed Gmail tokens for ${connection.gmailAddress}`);
    } catch (err) {
      console.error("Token refresh failed:", err);
      throw new Error("Gmail token refresh failed — reconnect required");
    }
  }

  const isFirstScan = !connection.lastHistoryId;

  // Fetch emails
  const { emails, newHistoryId } = await fetchInboxEmails(
    tokens,
    connection.lastHistoryId,
  );

  // Update historyId for next incremental fetch
  if (newHistoryId) {
    await db
      .update(gmailConnections)
      .set({ lastHistoryId: newHistoryId, updatedAt: new Date() })
      .where(eq(gmailConnections.id, connection.id));
  }

  // Load briefing sources so we can auto-archive matching emails
  const sources = await db.query.briefingSources.findMany({
    where: eq(briefingSources.userId, userId),
  });
  const briefingEmails = new Set(sources.map((s) => s.emailAddress.toLowerCase()));

  // Load network contacts so we can update their tracking during scan
  let networkEmailMap = new Map<string, string>();
  try {
    const networkContactsList = await db.query.networkContacts.findMany({
      where: eq(networkContacts.userId, userId),
      columns: { id: true, email: true },
    });
    networkEmailMap = new Map(
      networkContactsList.map((nc) => [nc.email.toLowerCase(), nc.id]),
    );
  } catch (err) {
    console.warn("Could not load network contacts (table may not exist yet):", (err as Error).message);
  }

  // Load per-user noise list (blocked senders)
  const userNoiseRows = await db.query.userNoiseList.findMany({
    where: eq(userNoiseList.userId, userId),
    columns: { email: true },
  });
  const userNoiseSet = new Set(userNoiseRows.map((r) => r.email.toLowerCase()));

  const userEmail = connection.gmailAddress;
  const now = Date.now();
  let inserted = 0;
  let historical = 0;
  let skipped = 0;
  let autoArchived = 0;
  let alreadyReplied = 0;

  for (const email of emails) {
    const isBriefingSource = briefingEmails.has(email.fromEmail.toLowerCase());

    // On first scan, emails older than 24h are "historical" — they build
    // sender context but don't go in the decision queue.
    const emailAgeMs = now - email.receivedAt.getTime();
    const isHistorical = isFirstScan && emailAgeMs > RECENT_THRESHOLD_MS;

    // Skip emails sent by P.J. himself (his own sent messages in inbox)
    if (userEmail && email.fromEmail.toLowerCase() === userEmail.toLowerCase()) {
      skipped++;
      continue;
    }

    // For recent (non-historical) emails, check if P.J. already replied
    // to this thread AFTER this specific message arrived. Each message
    // needs its own check since the afterDate differs per message.
    let userAlreadyReplied = false;
    if (!isHistorical && email.gmailThreadId) {
      userAlreadyReplied = await hasUserRepliedToThread(
        tokens,
        email.gmailThreadId,
        userEmail,
        email.receivedAt,
      );
    }

    try {
      await db.insert(emailQueue).values({
        userId,
        gmailMessageId: email.gmailMessageId,
        gmailThreadId: email.gmailThreadId,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        subject: email.subject,
        bodyText: email.bodyText,
        bodyHtml: email.bodyHtml,
        receivedAt: email.receivedAt,
        listUnsubscribe: email.listUnsubscribe,
        listUnsubscribePost: email.listUnsubscribePost,
        status: isHistorical
          ? "historical"
          : userAlreadyReplied
            ? "processed"
            : "pending",
        ...(userAlreadyReplied
          ? { chosenAction: "already_replied", processedAt: new Date() }
          : {}),
      });

      if (isHistorical) {
        historical++;
      } else if (userAlreadyReplied) {
        alreadyReplied++;
      } else {
        inserted++;
      }

      // NOTE: Auto-add to network_contacts is handled post-classification
      // in classifier.ts, where the AI signal (recommendedAction) determines
      // whether the sender belongs in the network.

      // Update network contact tracking if sender is already in the network
      // (skip if sender is on the user's noise list)
      const senderEmailLower = email.fromEmail.toLowerCase();
      const networkContactId = networkEmailMap.get(senderEmailLower);
      if (networkContactId && !isHistorical && !userNoiseSet.has(senderEmailLower)) {
        try {
          if (userAlreadyReplied) {
            // P.J. already replied — ball is in their court
            await db
              .update(networkContacts)
              .set({
                lastContactAt: email.receivedAt,
                lastDirection: "sent",
                threadStatus: "awaiting_their_reply",
                gmailThreadId: email.gmailThreadId,
                lastSubject: email.subject,
              })
              .where(eq(networkContacts.id, networkContactId));
          } else {
            // Update metadata only — threadStatus will be set by the
            // classifier after AI determines whether this email warrants a reply
            await db
              .update(networkContacts)
              .set({
                lastContactAt: email.receivedAt,
                lastDirection: "received",
                gmailThreadId: email.gmailThreadId,
                lastSubject: email.subject,
              })
              .where(eq(networkContacts.id, networkContactId));
          }
        } catch (err) {
          console.warn(
            `Failed to update network contact for ${email.fromEmail}:`,
            err,
          );
        }
      }

    } catch (err: any) {
      // Unique constraint violation = already in queue
      if (err?.code === "23505") {
        skipped++;
      } else {
        console.warn(
          `Failed to insert email ${email.gmailMessageId}:`,
          err,
        );
        skipped++;
      }
    }

    // Auto-archive briefing source emails in Gmail
    // This runs OUTSIDE the insert try/catch so it works even if the email
    // was already in the DB (unique constraint). Also archives historical ones.
    if (isBriefingSource && !userAlreadyReplied) {
      try {
        await archiveMessage(tokens, email.gmailMessageId);
        autoArchived++;
      } catch (archiveErr) {
        // Silently skip — may already be archived
      }
    }
  }

  console.log(
    `Scan complete for ${connection.gmailAddress}: ${emails.length} fetched, ${inserted} pending, ${historical} historical, ${skipped} skipped, ${autoArchived} auto-archived, ${alreadyReplied} already replied`,
  );

  // Run lightweight follow-up detection after each scan
  try {
    const followUpsCreated = await detectFollowUps(userId);
    if (followUpsCreated > 0) {
      console.log(`Follow-up detection: created ${followUpsCreated} new follow-ups for ${connection.gmailAddress}`);
    }
  } catch (err) {
    console.warn("Follow-up detection failed (non-fatal):", err);
  }

  return { fetched: emails.length, inserted, historical, skipped, autoArchived, alreadyReplied };
}

/**
 * Detect follow-up opportunities from network contacts.
 *
 * Runs after each inbox scan to check:
 * 1. ball_in_your_court: contact's thread awaiting your reply for 2+ days
 * 2. went_cold: no activity for 14+ days (and not marked conversation_ended)
 * 3. date_coming_up: personal facts with dateRelevant in the next 7 days
 *
 * For "ball_in_your_court", verifies P.J. hasn't already replied by checking:
 *   a) Whether the email was already processed in Genco (reply or archive action)
 *   b) Whether P.J. replied in the Gmail thread directly
 *
 * Skips contacts that already have a pending/snoozed follow-up for the same reason.
 */
async function detectFollowUps(userId: string): Promise<number> {
  const now = Date.now();
  const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
  const sevenDaysFromNow = new Date(now + 7 * 24 * 60 * 60 * 1000);

  // Load all network contacts for this user
  const contacts = await db.query.networkContacts.findMany({
    where: eq(networkContacts.userId, userId),
  });

  if (contacts.length === 0) return 0;

  // Load per-user noise list (blocked senders)
  const userNoiseRows = await db.query.userNoiseList.findMany({
    where: eq(userNoiseList.userId, userId),
    columns: { email: true },
  });
  const userNoiseSet = new Set(userNoiseRows.map((r) => r.email.toLowerCase()));

  // Load existing pending/snoozed follow-ups to avoid duplicates
  const contactIds = contacts.map((c) => c.id);
  const existingFollowUps = await db.query.followUpQueue.findMany({
    where: and(
      sql`${followUpQueue.networkContactId} IN (${sql.join(
        contactIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
      or(
        eq(followUpQueue.status, "pending"),
        eq(followUpQueue.status, "snoozed"),
      ),
    ),
  });
  const existingKeys = new Set(
    existingFollowUps.map((fu) => `${fu.networkContactId}:${fu.reason}`),
  );

  // Get Gmail tokens + user email for thread reply checking
  const gmailConnection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, userId),
  });
  let gmailTokens: GoogleTokens | null = null;
  let userEmail: string | null = null;
  if (gmailConnection) {
    gmailTokens = gmailConnection.googleTokens as GoogleTokens;
    userEmail = gmailConnection.gmailAddress?.toLowerCase() ?? null;
    // Refresh if expiring soon
    if (gmailTokens.expiry_date && gmailTokens.expiry_date < Date.now() + 5 * 60 * 1000) {
      try {
        gmailTokens = await refreshAccessToken(gmailTokens);
        await db
          .update(gmailConnections)
          .set({ googleTokens: gmailTokens, updatedAt: new Date() })
          .where(eq(gmailConnections.id, gmailConnection.id));
      } catch {
        gmailTokens = null;
      }
    }
  }

  let created = 0;

  for (const contact of contacts) {
    // Skip contacts with conversation_ended status
    if (contact.threadStatus === "conversation_ended") continue;
    if (!contact.lastContactAt) continue;
    // Skip noise / mass-email senders (static list + per-user blocked list)
    if (isNoiseEmail(contact.email)) continue;
    if (userNoiseSet.has(contact.email.toLowerCase())) continue;

    const lastContactTime = contact.lastContactAt.getTime();

    // 1. Ball in your court: awaiting_your_reply AND last contact > 2 days ago
    //    AND the AI actually classified the latest email as needing a reply
    if (
      contact.threadStatus === "awaiting_your_reply" &&
      contact.lastContactAt < twoDaysAgo
    ) {
      const key = `${contact.id}:ball_in_your_court`;
      if (!existingKeys.has(key)) {
        // Verify: the latest email from this contact was classified as "reply"
        const latestEmail = await db.query.emailQueue.findFirst({
          where: and(
            eq(emailQueue.userId, userId),
            eq(emailQueue.fromEmail, contact.email),
          ),
          orderBy: (eq, { desc }) => [desc(eq.receivedAt)],
          columns: {
            aiRecommendedAction: true,
            chosenAction: true,
            gmailThreadId: true,
            receivedAt: true,
          },
        });

        if (latestEmail?.aiRecommendedAction !== "reply") continue;

        // Skip if P.J. already handled this email in Genco
        if (latestEmail.chosenAction === "reply" || latestEmail.chosenAction === "archive") {
          // Update contact status since P.J. took action
          await db
            .update(networkContacts)
            .set({
              threadStatus: latestEmail.chosenAction === "reply"
                ? "awaiting_their_reply"
                : "dormant",
            })
            .where(eq(networkContacts.id, contact.id));
          continue;
        }

        // Check Gmail: did P.J. reply to this thread directly (outside Genco)?
        if (gmailTokens && userEmail && latestEmail.gmailThreadId) {
          try {
            const replied = await hasUserRepliedToThread(
              gmailTokens,
              latestEmail.gmailThreadId,
              userEmail,
              latestEmail.receivedAt,
            );
            if (replied) {
              // P.J. already responded — update contact and skip
              await db
                .update(networkContacts)
                .set({
                  lastDirection: "sent",
                  threadStatus: "awaiting_their_reply",
                })
                .where(eq(networkContacts.id, contact.id));
              console.log(
                `Follow-up skipped: ${contact.displayName} — P.J. already replied in Gmail`,
              );
              continue;
            }
          } catch (err) {
            // Non-fatal — fall through to create follow-up if check fails
            console.warn(
              `Thread reply check failed for ${contact.email}:`,
              err,
            );
          }
        }

        const daysAgo = Math.floor((now - lastContactTime) / (24 * 60 * 60 * 1000));
        await db.insert(followUpQueue).values({
          networkContactId: contact.id,
          reason: "ball_in_your_court",
          suggestedAction: "reply",
          contextSnapshot: `${contact.displayName} emailed you ${daysAgo}d ago: "${contact.lastSubject || "(no subject)"}"`,
        });
        existingKeys.add(key);
        created++;
      }
    }

    // 2. Went cold: P.J. sent last but they haven't responded in 14+ days
    if (
      contact.threadStatus === "awaiting_their_reply" &&
      contact.lastContactAt < fourteenDaysAgo
    ) {
      const key = `${contact.id}:went_cold`;
      if (!existingKeys.has(key)) {
        const daysAgo = Math.floor((now - lastContactTime) / (24 * 60 * 60 * 1000));
        await db.insert(followUpQueue).values({
          networkContactId: contact.id,
          reason: "went_cold",
          suggestedAction: "nudge",
          contextSnapshot: `${contact.displayName} hasn't replied in ${daysAgo}d — last thread: "${contact.lastSubject || "(no subject)"}"`,
        });
        existingKeys.add(key);
        created++;
      }
    }
  }

  // 3. Date coming up: personal facts with upcoming dates (next 7 days)
  const upcomingFacts = await db.query.contactContext.findMany({
    where: and(
      eq(contactContext.expired, false),
      lte(contactContext.dateRelevant, sevenDaysFromNow),
    ),
  });

  // Filter to only contacts belonging to this user
  const userContactIds = new Set(contactIds);

  for (const fact of upcomingFacts) {
    if (!fact.dateRelevant || fact.dateRelevant.getTime() < now) continue;
    if (!userContactIds.has(fact.networkContactId)) continue;

    const key = `${fact.networkContactId}:date_coming_up`;
    if (existingKeys.has(key)) continue;

    const factContact = contacts.find((c) => c.id === fact.networkContactId);
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
    existingKeys.add(key);
    created++;
  }

  return created;
}
