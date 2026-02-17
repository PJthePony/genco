import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  emailQueue,
  gmailConnections,
  briefingSources,
  senderSummaries,
} from "../db/schema.js";
import {
  archiveMessage,
  createDraft,
  executeUnsubscribe,
  refreshAccessToken,
  type GoogleTokens,
} from "../lib/gmail.js";
import { generateReplyDraft } from "../lib/claude.js";

export interface ActionResult {
  ok: boolean;
  draftId?: string;
  unsubscribeUrl?: string;
  unsubscribeMethod?: string;
  error?: string;
}

/**
 * Get fresh Gmail tokens for a user, refreshing if expiring soon.
 */
async function getFreshTokens(userId: string): Promise<GoogleTokens | null> {
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
      console.log(`Refreshed Gmail tokens for action (${connection.gmailAddress})`);
    } catch (err) {
      console.error("Token refresh failed in action:", err);
      return null;
    }
  }

  return tokens;
}

/**
 * Execute the chosen action for an email in the queue.
 */
export async function executeAction(
  userId: string,
  emailId: string,
  action: string,
  payload?: { replyBody?: string; replyContext?: string; taskTitle?: string },
): Promise<ActionResult> {
  // Get the email
  const email = await db.query.emailQueue.findFirst({
    where: eq(emailQueue.id, emailId),
  });

  if (!email || email.userId !== userId) {
    return { ok: false, error: "Email not found" };
  }

  // Get fresh Gmail tokens (with auto-refresh)
  const tokens = await getFreshTokens(userId);

  try {
    switch (action) {
      case "reply": {
        if (!tokens) return { ok: false, error: "Gmail not connected" };

        let body: string;

        if (payload?.replyContext) {
          // User provided context for what the reply should say —
          // generate a new draft with Claude using their instructions
          console.log(
            `Generating reply draft from user context for "${email.subject}"`,
          );

          // Look up sender summary for context
          const senderSummary = await db.query.senderSummaries.findFirst({
            where: eq(senderSummaries.senderEmail, email.fromEmail),
          });

          body = await generateReplyDraft({
            fromName: email.fromName ?? "",
            fromEmail: email.fromEmail,
            subject: email.subject,
            bodyText: email.bodyText ?? "",
            replyContext: payload.replyContext,
            senderSummary: senderSummary?.summary ?? null,
          });
        } else {
          body =
            payload?.replyBody ?? email.aiReplyDraft ?? "Thanks for the email!";
        }

        const draftId = await createDraft(tokens, {
          threadId: email.gmailThreadId ?? email.gmailMessageId,
          to: email.fromEmail,
          subject: email.subject,
          body,
        });
        // Archive after drafting
        await archiveMessage(tokens, email.gmailMessageId);
        return { ok: true, draftId };
      }

      case "add_task": {
        // TODO: POST to Tessio API with tags: ['genco']
        // For now, just mark as processed
        return { ok: true };
      }

      case "archive": {
        if (!tokens) return { ok: false, error: "Gmail not connected" };
        await archiveMessage(tokens, email.gmailMessageId);
        return { ok: true };
      }

      case "unsubscribe": {
        if (!tokens) return { ok: false, error: "Gmail not connected" };

        // Try RFC 2369 / RFC 8058 unsubscribe mechanism
        const unsubResult = await executeUnsubscribe(
          tokens,
          email.listUnsubscribe,
          email.listUnsubscribePost,
        );

        // Always archive the email
        await archiveMessage(tokens, email.gmailMessageId);

        if (unsubResult.method === "one-click") {
          return {
            ok: true,
            unsubscribeMethod: "one-click",
          };
        } else if (unsubResult.method === "mailto") {
          return {
            ok: true,
            unsubscribeMethod: "mailto",
          };
        } else if (unsubResult.method === "url") {
          // Return URL for user to visit manually
          return {
            ok: true,
            unsubscribeMethod: "url",
            unsubscribeUrl: unsubResult.url,
          };
        } else {
          // No unsubscribe mechanism — just archived
          return {
            ok: true,
            unsubscribeMethod: "none",
          };
        }
      }

      case "briefing": {
        // Add sender to briefing sources, archive email
        await db
          .insert(briefingSources)
          .values({
            userId,
            emailAddress: email.fromEmail,
            displayName: email.fromName ?? email.fromEmail,
          })
          .onConflictDoNothing();

        if (tokens) {
          await archiveMessage(tokens, email.gmailMessageId);
        }
        return { ok: true };
      }

      case "act": {
        // Mark as processed — user handles the action manually
        return { ok: true };
      }

      case "skip": {
        // Skip without taking action
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown action: ${action}` };
    }
  } catch (err: any) {
    const errorMsg = err.message || "Action failed";
    const status = err?.code || err?.response?.status || "";
    console.error(
      `Action "${action}" failed for email ${emailId} (status: ${status}):`,
      errorMsg,
    );
    return { ok: false, error: errorMsg };
  }
}
