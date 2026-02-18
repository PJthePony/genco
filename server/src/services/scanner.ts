import { eq, and, lt, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  gmailConnections,
  emailQueue,
  briefingSources,
  networkContacts,
} from "../db/schema.js";
import {
  fetchInboxEmails,
  refreshAccessToken,
  archiveMessage,
  hasUserRepliedToThread,
  type GoogleTokens,
  type RawEmail,
} from "../lib/gmail.js";

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

      // Update network contact tracking if sender is in the network
      const networkContactId = networkEmailMap.get(email.fromEmail.toLowerCase());
      if (networkContactId && !isHistorical) {
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
            // New incoming email — ball is in P.J.'s court
            await db
              .update(networkContacts)
              .set({
                lastContactAt: email.receivedAt,
                lastDirection: "received",
                threadStatus: "awaiting_your_reply",
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

      // Auto-archive briefing source emails in Gmail (only recent ones)
      if (isBriefingSource && !isHistorical && !userAlreadyReplied) {
        try {
          await archiveMessage(tokens, email.gmailMessageId);
          autoArchived++;
          console.log(
            `Auto-archived briefing source email: "${email.subject}" from ${email.fromEmail}`,
          );
        } catch (archiveErr) {
          console.warn(
            `Failed to auto-archive ${email.gmailMessageId}:`,
            archiveErr,
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
  }

  console.log(
    `Scan complete for ${connection.gmailAddress}: ${emails.length} fetched, ${inserted} pending, ${historical} historical, ${skipped} skipped, ${autoArchived} auto-archived, ${alreadyReplied} already replied`,
  );

  return { fetched: emails.length, inserted, historical, skipped, autoArchived, alreadyReplied };
}
