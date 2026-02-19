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
import { createTessioTask } from "../lib/tessio.js";

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
  payload?: { replyBody?: string; replyContext?: string; taskTitle?: string; subAction?: string },
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
          // Legacy path: user provided context via the old override flow
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
          // New path: frontend generates the draft via /queue/:id/draft
          // and passes the full replyBody here
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

      case "act": {
        const subAction = payload?.subAction;

        switch (subAction) {
          case "unsubscribe": {
            if (!tokens) return { ok: false, error: "Gmail not connected" };

            const unsubResult = await executeUnsubscribe(
              tokens,
              email.listUnsubscribe,
              email.listUnsubscribePost,
            );

            await archiveMessage(tokens, email.gmailMessageId);

            if (unsubResult.method === "one-click") {
              return { ok: true, unsubscribeMethod: "one-click" };
            } else if (unsubResult.method === "mailto") {
              return { ok: true, unsubscribeMethod: "mailto" };
            } else if (unsubResult.method === "url") {
              return { ok: true, unsubscribeMethod: "url", unsubscribeUrl: unsubResult.url };
            } else {
              return { ok: true, unsubscribeMethod: "none" };
            }
          }

          case "add_task": {
            const title =
              payload?.taskTitle || email.aiTaskTitle || email.subject;
            const notes = `From: ${email.fromName ?? email.fromEmail}\nSubject: ${email.subject}\n\n${email.aiSummary ?? ""}`.trim();
            await createTessioTask(userId, title, notes);
            if (tokens) {
              await archiveMessage(tokens, email.gmailMessageId);
            }
            return { ok: true };
          }

          case "briefing": {
            if (!tokens) return { ok: false, error: "Gmail not connected" };

            await db
              .insert(briefingSources)
              .values({
                userId,
                emailAddress: email.fromEmail,
                displayName: email.fromName ?? email.fromEmail,
              })
              .onConflictDoNothing();

            await archiveMessage(tokens, email.gmailMessageId);
            return { ok: true };
          }

          default:
            return { ok: false, error: `Unknown sub-action: ${subAction}` };
        }
      }

      case "archive": {
        if (!tokens) return { ok: false, error: "Gmail not connected" };
        await archiveMessage(tokens, email.gmailMessageId);
        return { ok: true };
      }

      // Backward compat: old clients may still send these as top-level actions
      case "unsubscribe":
        return executeAction(userId, emailId, "act", { ...payload, subAction: "unsubscribe" });

      case "add_task":
        return executeAction(userId, emailId, "act", { ...payload, subAction: "add_task" });

      case "briefing":
        return executeAction(userId, emailId, "act", { ...payload, subAction: "briefing" });

      case "skip": {
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
