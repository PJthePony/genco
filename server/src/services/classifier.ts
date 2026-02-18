import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  emailQueue,
  feedbackLog,
  briefingSources,
  senderSummaries,
  gmailConnections,
  networkContacts,
  contactContext,
  userNoiseList,
} from "../db/schema.js";
import { classifyEmail, buildSenderSummaryFromHistory } from "../lib/claude.js";
import {
  fetchSenderHistory,
  refreshAccessToken,
  archiveMessage,
  type GoogleTokens,
} from "../lib/gmail.js";
import { isNoiseEmail } from "../lib/noise.js";

export interface ClassifyResult {
  processed: number;
  failed: number;
  urgent: number;
  newSenders: number;
}

/**
 * Classify all pending, unclassified emails in the queue.
 * For each email:
 * 1. If sender is new → fetch their full Gmail history and build a relationship summary
 * 2. Look up existing sender summary
 * 3. Run Claude with sender context + feedback history
 * 4. Update email_queue with AI results
 * 5. Upsert the sender summary with Claude's updated version
 */
export async function classifyPendingEmails(
  userId: string,
): Promise<ClassifyResult> {
  // Get pending emails that haven't been classified yet
  const pending = await db.query.emailQueue.findMany({
    where: and(
      eq(emailQueue.userId, userId),
      eq(emailQueue.status, "pending"),
      isNull(emailQueue.aiSummary),
    ),
    orderBy: (eq, { desc }) => [desc(eq.receivedAt)],
    limit: 20,
  });

  if (pending.length === 0) {
    return { processed: 0, failed: 0, urgent: 0, newSenders: 0 };
  }

  // Build feedback context from recent corrections
  const feedbackContext = await buildFeedbackContext(userId);

  // Get briefing source emails
  const sources = await db.query.briefingSources.findMany({
    where: eq(briefingSources.userId, userId),
  });
  const briefingSourceEmails = sources.map((s) => s.emailAddress);

  // Pre-load all sender summaries for this user (one query instead of N)
  const allSummaries = await db.query.senderSummaries.findMany({
    where: eq(senderSummaries.userId, userId),
  });
  const summaryMap = new Map(
    allSummaries.map((s) => [s.senderEmail, s]),
  );

  // Load network contacts for personal context extraction
  let networkContactMap = new Map<string, string>();
  try {
    const networkContactsList = await db.query.networkContacts.findMany({
      where: eq(networkContacts.userId, userId),
      columns: { id: true, email: true },
    });
    networkContactMap = new Map(
      networkContactsList.map((nc) => [nc.email.toLowerCase(), nc.id]),
    );
  } catch (err) {
    console.warn("Could not load network contacts:", (err as Error).message);
  }

  // Get Gmail tokens and user email for sender history lookups + noise filtering
  const gmailTokens = await getGmailTokens(userId);
  const userEmail = await getUserEmail(userId);

  // Load per-user noise list (blocked senders)
  const userNoiseRows = await db.query.userNoiseList.findMany({
    where: eq(userNoiseList.userId, userId),
    columns: { email: true },
  });
  const userNoiseSet = new Set(userNoiseRows.map((r) => r.email.toLowerCase()));

  // Track which senders we've already built history for in this batch
  const historyBuilt = new Set<string>();

  let processed = 0;
  let failed = 0;
  let urgent = 0;
  let newSenders = 0;

  for (const email of pending) {
    try {
      // If this is a new sender we haven't seen before, build their
      // relationship summary from full Gmail history FIRST
      if (!summaryMap.has(email.fromEmail) && !historyBuilt.has(email.fromEmail)) {
        historyBuilt.add(email.fromEmail);

        if (gmailTokens) {
          try {
            console.log(`Building sender history for: ${email.fromEmail}`);
            const history = await fetchSenderHistory(gmailTokens, email.fromEmail);

            if (history.length > 0) {
              const historySummary = await buildSenderSummaryFromHistory(
                email.fromEmail,
                email.fromName ?? "",
                history,
              );

              // Store the history-based summary
              const [newSummary] = await db
                .insert(senderSummaries)
                .values({
                  userId,
                  senderEmail: email.fromEmail,
                  senderName: email.fromName,
                  summary: historySummary,
                  emailCount: String(history.length),
                })
                .onConflictDoNothing()
                .returning();

              if (newSummary) {
                summaryMap.set(email.fromEmail, newSummary);
                newSenders++;
                console.log(
                  `Built sender profile: ${email.fromEmail} (${history.length} emails in history)`,
                );
              }
            }
          } catch (err) {
            console.warn(
              `Failed to build sender history for ${email.fromEmail}:`,
              err,
            );
            // Continue without history — classifier will create a basic summary
          }
        }
      }

      // Look up sender summary (may have just been created above)
      const existingSummary = summaryMap.get(email.fromEmail);
      const isNetworkContact = networkContactMap.has(email.fromEmail.toLowerCase());

      const result = await classifyEmail({
        fromName: email.fromName ?? "",
        fromEmail: email.fromEmail,
        subject: email.subject,
        bodyText: email.bodyText ?? "",
        senderSummary: existingSummary?.summary ?? null,
        feedbackContext,
        briefingSourceEmails,
        isNetworkContact,
      });

      // Update email with classification results
      await db
        .update(emailQueue)
        .set({
          aiSummary: result.summary,
          aiRecommendedAction: result.recommendedAction,
          aiPriority: result.priority,
          isUrgent: result.isUrgent,
          aiReplyDraft: result.replyDraft,
          aiTaskTitle: result.taskTitle,
        })
        .where(eq(emailQueue.id, email.id));

      // Upsert the sender summary
      if (result.updatedSenderSummary) {
        if (existingSummary) {
          // Update existing summary
          await db
            .update(senderSummaries)
            .set({
              summary: result.updatedSenderSummary,
              senderName: email.fromName ?? existingSummary.senderName,
              emailCount: String(
                parseInt(existingSummary.emailCount) + 1,
              ),
              lastAction: result.recommendedAction,
              updatedAt: new Date(),
            })
            .where(eq(senderSummaries.id, existingSummary.id));

          // Update in-memory map for subsequent emails from same sender
          summaryMap.set(email.fromEmail, {
            ...existingSummary,
            summary: result.updatedSenderSummary,
            emailCount: String(
              parseInt(existingSummary.emailCount) + 1,
            ),
            lastAction: result.recommendedAction,
          });
        } else {
          // Create new sender summary
          const [newSummary] = await db
            .insert(senderSummaries)
            .values({
              userId,
              senderEmail: email.fromEmail,
              senderName: email.fromName,
              summary: result.updatedSenderSummary,
              emailCount: "1",
              lastAction: result.recommendedAction,
            })
            .onConflictDoNothing()
            .returning();

          if (newSummary) {
            summaryMap.set(email.fromEmail, newSummary);
          }
        }
      }

      // Persist personal context facts for network contacts
      if (isNetworkContact && result.personalContext?.length) {
        const contactId = networkContactMap.get(email.fromEmail.toLowerCase())!;
        for (const pc of result.personalContext) {
          try {
            await db.insert(contactContext).values({
              networkContactId: contactId,
              fact: pc.fact,
              dateRelevant: pc.dateRelevant
                ? new Date(pc.dateRelevant)
                : null,
              sourceSubject: email.subject,
            });
          } catch (err) {
            console.warn(
              `Failed to insert personal context for ${email.fromEmail}:`,
              err,
            );
          }
        }
        console.log(
          `Extracted ${result.personalContext.length} personal facts from "${email.subject}" for ${email.fromEmail}`,
        );
      }

      // Auto-add sender to network if the AI classified this as needing
      // a personal reply or task — meaning a real person is asking for P.J.'s input.
      // This replaces the old scanner-based auto-add which had no AI signal.
      const senderLower = email.fromEmail.toLowerCase();
      const isBriefingSender = briefingSourceEmails.some(
        (b) => b.toLowerCase() === senderLower,
      );
      if (
        (result.recommendedAction === "reply" || result.recommendedAction === "add_task") &&
        !networkContactMap.has(senderLower) &&
        !isBriefingSender &&
        !isNoiseEmail(senderLower, userEmail ?? undefined) &&
        !userNoiseSet.has(senderLower) &&
        senderLower !== userEmail
      ) {
        try {
          const [newContact] = await db
            .insert(networkContacts)
            .values({
              userId,
              email: senderLower,
              displayName: email.fromName || senderLower.split("@")[0],
              lastContactAt: email.receivedAt,
              lastDirection: "received",
              threadStatus: "awaiting_your_reply",
              gmailThreadId: email.gmailThreadId,
              lastSubject: email.subject,
            })
            .onConflictDoNothing()
            .returning();

          if (newContact) {
            networkContactMap.set(senderLower, newContact.id);
            console.log(
              `Auto-added ${senderLower} to network (reason: ${result.recommendedAction})`,
            );

            // Persist personal facts for the newly-added contact
            if (result.personalContext?.length) {
              for (const pc of result.personalContext) {
                try {
                  await db.insert(contactContext).values({
                    networkContactId: newContact.id,
                    fact: pc.fact,
                    dateRelevant: pc.dateRelevant
                      ? new Date(pc.dateRelevant)
                      : null,
                    sourceSubject: email.subject,
                  });
                } catch (err) {
                  // Non-fatal
                }
              }
            }
          }
        } catch (err) {
          console.warn(`Failed to auto-add network contact ${senderLower}:`, err);
        }
      }

      // Update threadStatus for existing network contacts based on AI signal.
      // Only set "awaiting_your_reply" when the AI confirmed this email
      // actually needs P.J.'s personal response — not for newsletters,
      // notifications, or FYI emails from people who happen to be in the network.
      if (isNetworkContact && result.recommendedAction === "reply") {
        const contactId = networkContactMap.get(email.fromEmail.toLowerCase());
        if (contactId) {
          try {
            await db
              .update(networkContacts)
              .set({ threadStatus: "awaiting_your_reply" })
              .where(eq(networkContacts.id, contactId));
          } catch (err) {
            console.warn(
              `Failed to update threadStatus for ${email.fromEmail}:`,
              err,
            );
          }
        }
      }

      // Auto-process briefing items — they go straight to the digest,
      // not the decision queue. User doesn't need to approve these.
      if (result.recommendedAction === "briefing") {
        await db
          .update(emailQueue)
          .set({
            status: "processed",
            chosenAction: "briefing",
            processedAt: new Date(),
          })
          .where(eq(emailQueue.id, email.id));

        // Also archive in Gmail so it doesn't clutter the inbox
        if (gmailTokens) {
          try {
            await archiveMessage(gmailTokens, email.gmailMessageId);
          } catch (archiveErr) {
            console.warn(
              `Failed to archive briefing email ${email.gmailMessageId}:`,
              archiveErr,
            );
          }
        }
      }

      processed++;
      if (result.isUrgent) urgent++;

      console.log(
        `Classified: "${email.subject}" → ${result.recommendedAction} (${result.priority}${result.isUrgent ? ", URGENT" : ""})`,
      );
    } catch (err) {
      console.error(`Failed to classify "${email.subject}":`, err);
      failed++;
    }
  }

  return { processed, failed, urgent, newSenders };
}

/**
 * Build sender summaries for historical emails (from the initial 30-day scan).
 * This processes emails with status 'historical' — it doesn't classify them
 * for the decision queue, just builds sender relationship context.
 */
export async function buildHistoricalSenderContext(
  userId: string,
): Promise<{ sendersProcessed: number }> {
  // Get distinct senders from historical emails that don't have summaries yet
  const historicalEmails = await db.query.emailQueue.findMany({
    where: and(
      eq(emailQueue.userId, userId),
      eq(emailQueue.status, "historical"),
    ),
    columns: {
      fromEmail: true,
      fromName: true,
    },
  });

  // Get existing summaries
  const existingSummaries = await db.query.senderSummaries.findMany({
    where: eq(senderSummaries.userId, userId),
    columns: { senderEmail: true },
  });
  const existingSet = new Set(existingSummaries.map((s) => s.senderEmail));

  // Find unique new senders
  const newSenderMap = new Map<string, string | null>();
  for (const e of historicalEmails) {
    if (!existingSet.has(e.fromEmail) && !newSenderMap.has(e.fromEmail)) {
      newSenderMap.set(e.fromEmail, e.fromName);
    }
  }

  if (newSenderMap.size === 0) {
    return { sendersProcessed: 0 };
  }

  const gmailTokens = await getGmailTokens(userId);
  if (!gmailTokens) {
    return { sendersProcessed: 0 };
  }

  let sendersProcessed = 0;

  for (const [senderEmail, senderName] of newSenderMap) {
    try {
      const history = await fetchSenderHistory(gmailTokens, senderEmail);

      if (history.length > 0) {
        const summary = await buildSenderSummaryFromHistory(
          senderEmail,
          senderName ?? "",
          history,
        );

        await db
          .insert(senderSummaries)
          .values({
            userId,
            senderEmail,
            senderName,
            summary,
            emailCount: String(history.length),
          })
          .onConflictDoNothing();

        sendersProcessed++;
        console.log(
          `Built historical sender profile: ${senderEmail} (${history.length} emails)`,
        );
      }
    } catch (err) {
      console.warn(
        `Failed to build history for ${senderEmail}:`,
        err,
      );
    }
  }

  return { sendersProcessed };
}

/**
 * Get fresh Gmail tokens for sender history lookups.
 */
async function getGmailTokens(userId: string): Promise<GoogleTokens | null> {
  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, userId),
  });

  if (!connection) return null;

  let tokens = connection.googleTokens as GoogleTokens;

  // Refresh if expiring within 5 minutes
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    try {
      tokens = await refreshAccessToken(tokens);
      await db
        .update(gmailConnections)
        .set({ googleTokens: tokens, updatedAt: new Date() })
        .where(eq(gmailConnections.id, connection.id));
    } catch (err) {
      console.error("Token refresh failed in classifier:", err);
      return null;
    }
  }

  return tokens;
}

/**
 * Get the user's Gmail address for noise-email filtering.
 */
async function getUserEmail(userId: string): Promise<string | null> {
  const connection = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, userId),
    columns: { gmailAddress: true },
  });
  return connection?.gmailAddress?.toLowerCase() ?? null;
}

/**
 * Build a feedback context string from recent user corrections.
 * This teaches Claude the user's preferences.
 */
async function buildFeedbackContext(userId: string): Promise<string> {
  const recentFeedback = await db.query.feedbackLog.findMany({
    where: eq(feedbackLog.userId, userId),
    orderBy: (fb, { desc }) => [desc(fb.createdAt)],
    limit: 20,
  });

  if (recentFeedback.length === 0) return "";

  const lines = recentFeedback.map((fb) => {
    let line = `- Changed "${fb.originalAction}" → "${fb.chosenAction}"`;
    if (fb.sender) line += ` for ${fb.sender}`;
    if (fb.reason) line += ` (reason: "${fb.reason}")`;
    return line;
  });

  return lines.join("\n");
}
