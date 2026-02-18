import { google } from "googleapis";
import { env } from "../config.js";

// ── OAuth ───────────────────────────────────────────────────────────────────

const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI,
);

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function getAuthUrl(userId: string): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state: userId,
  });
}

export async function exchangeCode(code: string) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// ── Gmail Client ────────────────────────────────────────────────────────────

export interface GoogleTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  token_type?: string | null;
  scope?: string | null;
}

function getGmailClient(tokens: GoogleTokens) {
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
  client.setCredentials({
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
    token_type: tokens.token_type ?? undefined,
    scope: tokens.scope ?? undefined,
  });
  return { gmail: google.gmail({ version: "v1", auth: client }), client };
}

// ── Get User Email ──────────────────────────────────────────────────────────

export async function getUserEmail(tokens: GoogleTokens): Promise<string> {
  const { gmail } = getGmailClient(tokens);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress ?? "";
}

// ── Refresh Tokens ──────────────────────────────────────────────────────────

export async function refreshAccessToken(
  tokens: GoogleTokens,
): Promise<GoogleTokens> {
  const { client } = getGmailClient(tokens);
  const { credentials } = await client.refreshAccessToken();
  return {
    ...tokens,
    access_token: credentials.access_token,
    expiry_date: credentials.expiry_date,
  };
}

// ── Fetch Messages ──────────────────────────────────────────────────────────

export interface RawEmail {
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  receivedAt: Date;
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
}

/**
 * Fetch inbox messages. On first scan, fetches all inbox emails from the
 * last 30 days (read and unread). On subsequent scans, uses history.list
 * for incremental sync of new messages only.
 */
export async function fetchInboxEmails(
  tokens: GoogleTokens,
  lastHistoryId?: string | null,
  maxResults = 200,
): Promise<{ emails: RawEmail[]; newHistoryId: string | null }> {
  const { gmail } = getGmailClient(tokens);

  let messageIds: string[] = [];

  if (lastHistoryId) {
    // Incremental sync via history
    try {
      // Fetch both messageAdded AND labelsAdded events. When a reply
      // arrives on an archived thread, Gmail may record the new message
      // as a messageAdded event WITHOUT the INBOX label, then separately
      // fire a labelsAdded event to re-surface the thread. We need both.
      const historyResponse = await gmail.users.history.list({
        userId: "me",
        startHistoryId: lastHistoryId,
        historyTypes: ["messageAdded", "labelAdded"],
      });

      const seen = new Set<string>();
      const histories = historyResponse.data.history ?? [];
      for (const h of histories) {
        // New messages that landed in INBOX
        for (const msg of h.messagesAdded ?? []) {
          if (
            msg.message?.id &&
            msg.message?.labelIds?.includes("INBOX") &&
            !msg.message?.labelIds?.includes("TRASH") &&
            !msg.message?.labelIds?.includes("SPAM")
          ) {
            if (!seen.has(msg.message.id)) {
              seen.add(msg.message.id);
              messageIds.push(msg.message.id);
            }
          }
        }
        // Messages that had INBOX label added (replies to archived threads)
        for (const lbl of h.labelsAdded ?? []) {
          if (
            lbl.message?.id &&
            lbl.labelIds?.includes("INBOX") &&
            !seen.has(lbl.message.id)
          ) {
            seen.add(lbl.message.id);
            messageIds.push(lbl.message.id);
          }
        }
      }
    } catch (err: any) {
      // historyId too old or invalid — fall back to full fetch
      if (err?.code === 404) {
        console.warn("History ID expired, falling back to full fetch");
        lastHistoryId = null;
      } else {
        throw err;
      }
    }
  }

  if (!lastHistoryId) {
    // First scan: fetch all inbox messages from last 30 days (read + unread)
    // Paginate to get everything
    let pageToken: string | undefined;
    do {
      const listResponse = await gmail.users.messages.list({
        userId: "me",
        q: "in:inbox newer_than:30d",
        maxResults: Math.min(maxResults - messageIds.length, 100),
        pageToken,
      });
      const msgs = (listResponse.data.messages ?? [])
        .map((m) => m.id!)
        .filter(Boolean);
      messageIds.push(...msgs);
      pageToken = listResponse.data.nextPageToken ?? undefined;
    } while (pageToken && messageIds.length < maxResults);

    console.log(
      `First scan: found ${messageIds.length} inbox messages from last 30 days`,
    );
  }

  // Deduplicate
  messageIds = [...new Set(messageIds)];

  // Fetch full message details
  const emails: RawEmail[] = [];
  for (const msgId of messageIds) {
    try {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: msgId,
        format: "full",
      });
      const parsed = parseMessage(msg.data);
      if (parsed) emails.push(parsed);
    } catch (err) {
      console.warn(`Failed to fetch message ${msgId}:`, err);
    }
  }

  // Get current historyId for next incremental sync
  const profile = await gmail.users.getProfile({ userId: "me" });
  const newHistoryId = profile.data.historyId ?? null;

  return { emails, newHistoryId };
}

/**
 * Fetch all emails from a specific sender across the user's entire Gmail history.
 * Used to build relationship context for new senders.
 * Returns lightweight email summaries (subject + snippet), not full bodies.
 */
export async function fetchSenderHistory(
  tokens: GoogleTokens,
  senderEmail: string,
  maxResults = 50,
): Promise<SenderHistoryEmail[]> {
  const { gmail } = getGmailClient(tokens);

  // Search for all emails from this sender (sent to OR from)
  const results: SenderHistoryEmail[] = [];
  let pageToken: string | undefined;

  do {
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      q: `from:${senderEmail} OR to:${senderEmail}`,
      maxResults: Math.min(maxResults - results.length, 100),
      pageToken,
    });

    const messageIds = (listResponse.data.messages ?? [])
      .map((m) => m.id!)
      .filter(Boolean);

    // Fetch metadata only (much faster than full format)
    for (const msgId of messageIds) {
      try {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: msgId,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        });

        const headers: Record<string, string> = {};
        for (const h of msg.data.payload?.headers ?? []) {
          if (h.name && h.value) {
            headers[h.name.toLowerCase()] = h.value;
          }
        }

        const from = headers["from"] ?? "";
        const { email: fromEmail } = parseFromHeader(from);
        const isFromUser = fromEmail.toLowerCase() !== senderEmail.toLowerCase();

        results.push({
          subject: headers["subject"] ?? "(no subject)",
          date: headers["date"] ? new Date(headers["date"]) : new Date(),
          snippet: msg.data.snippet ?? "",
          direction: isFromUser ? "sent" : "received",
        });
      } catch (err) {
        // Skip individual message failures
      }
    }

    pageToken = listResponse.data.nextPageToken ?? undefined;
  } while (pageToken && results.length < maxResults);

  // Sort oldest first for chronological context
  results.sort((a, b) => a.date.getTime() - b.date.getTime());

  return results;
}

export interface SenderHistoryEmail {
  subject: string;
  date: Date;
  snippet: string;
  direction: "sent" | "received";
}

// ── Thread Reply Detection ──────────────────────────────────────────────────

/**
 * Check if the user has already replied to a thread after a specific message.
 * Returns true if any message in the thread was sent by the user (has SENT label)
 * and is newer than the given message date.
 *
 * Uses threads.get with metadata format for efficiency.
 */
export async function hasUserRepliedToThread(
  tokens: GoogleTokens,
  threadId: string,
  userEmail: string,
  afterDate: Date,
): Promise<boolean> {
  const { gmail } = getGmailClient(tokens);
  try {
    const thread = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "metadata",
      metadataHeaders: ["From", "Date"],
    });

    const messages = thread.data.messages ?? [];
    const userEmailLower = userEmail.toLowerCase();

    for (const msg of messages) {
      const headers: Record<string, string> = {};
      for (const h of msg.payload?.headers ?? []) {
        if (h.name && h.value) {
          headers[h.name.toLowerCase()] = h.value;
        }
      }

      const from = headers["from"] ?? "";
      const { email: senderEmail } = parseFromHeader(from);
      const msgDate = headers["date"] ? new Date(headers["date"]) : new Date(0);

      // Check if this message is from the user and is after the incoming email
      if (
        senderEmail.toLowerCase() === userEmailLower &&
        msgDate.getTime() > afterDate.getTime()
      ) {
        return true;
      }
    }

    return false;
  } catch (err) {
    // If thread lookup fails, don't block — assume not replied
    console.warn(`Thread reply check failed for ${threadId}:`, err);
    return false;
  }
}

// ── Gmail Actions ───────────────────────────────────────────────────────────

/**
 * Archive a message (remove INBOX label).
 * Gracefully handles cases where the email is already archived.
 */
export async function archiveMessage(
  tokens: GoogleTokens,
  messageId: string,
): Promise<void> {
  const { gmail } = getGmailClient(tokens);
  try {
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: ["INBOX"] },
    });
  } catch (err: any) {
    // If the message doesn't have the INBOX label (already archived),
    // or the message is not found (deleted), treat as success
    const status = err?.code || err?.response?.status;
    if (status === 400 || status === 404) {
      console.log(
        `Archive skipped for ${messageId}: ${err.message || "already archived or not found"}`,
      );
      return;
    }
    throw err;
  }
}

/**
 * Move a message back to the inbox (add INBOX label).
 */
export async function unarchiveMessage(
  tokens: GoogleTokens,
  messageId: string,
): Promise<void> {
  const { gmail } = getGmailClient(tokens);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds: ["INBOX"] },
  });
}

/**
 * Create a draft reply.
 */
export async function createDraft(
  tokens: GoogleTokens,
  opts: {
    threadId: string;
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string;
  },
): Promise<string> {
  const { gmail } = getGmailClient(tokens);

  const headers = [
    `To: ${opts.to}`,
    `Subject: Re: ${opts.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];
  if (opts.inReplyTo) {
    headers.push(`In-Reply-To: ${opts.inReplyTo}`);
    headers.push(`References: ${opts.inReplyTo}`);
  }

  const raw = Buffer.from(
    headers.join("\r\n") + "\r\n\r\n" + opts.body,
  ).toString("base64url");

  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw,
        threadId: opts.threadId,
      },
    },
  });

  return draft.data.id ?? "";
}

// ── Unsubscribe Helpers ─────────────────────────────────────────────────────

export interface UnsubscribeResult {
  method: "one-click" | "mailto" | "url" | "none";
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Parse the List-Unsubscribe header and extract URLs/mailto addresses.
 * Format: <https://example.com/unsub>, <mailto:unsub@example.com>
 */
function parseListUnsubscribe(header: string): {
  urls: string[];
  mailtos: string[];
} {
  const urls: string[] = [];
  const mailtos: string[] = [];

  // Extract values between angle brackets
  const matches = header.match(/<([^>]+)>/g);
  if (!matches) return { urls, mailtos };

  for (const match of matches) {
    const value = match.slice(1, -1).trim();
    if (value.startsWith("mailto:")) {
      mailtos.push(value);
    } else if (value.startsWith("http://") || value.startsWith("https://")) {
      urls.push(value);
    }
  }

  return { urls, mailtos };
}

/**
 * Attempt to unsubscribe from a mailing list using RFC 8058 / RFC 2369 headers.
 *
 * Priority:
 * 1. One-click POST (RFC 8058) — if List-Unsubscribe-Post header exists
 * 2. Mailto — send an unsubscribe email via Gmail
 * 3. URL — return the URL for the user to visit manually
 * 4. None — no unsubscribe mechanism found
 */
export async function executeUnsubscribe(
  tokens: GoogleTokens,
  listUnsubscribe: string | null,
  listUnsubscribePost: string | null,
): Promise<UnsubscribeResult> {
  if (!listUnsubscribe) {
    return { method: "none", success: false };
  }

  const { urls, mailtos } = parseListUnsubscribe(listUnsubscribe);
  const hasOneClick =
    listUnsubscribePost?.includes("List-Unsubscribe=One-Click") ?? false;

  // 1. RFC 8058 One-Click Unsubscribe — send POST to the URL
  if (hasOneClick && urls.length > 0) {
    try {
      const response = await fetch(urls[0], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      });

      if (response.ok || response.status === 202) {
        console.log(`One-click unsubscribe success: ${urls[0]}`);
        return { method: "one-click", success: true };
      }

      console.warn(
        `One-click unsubscribe returned ${response.status}: ${urls[0]}`,
      );
      // Fall through to try other methods
    } catch (err) {
      console.warn(`One-click unsubscribe failed: ${urls[0]}`, err);
      // Fall through to try other methods
    }
  }

  // 2. Mailto — send an unsubscribe email via Gmail
  if (mailtos.length > 0) {
    try {
      const mailto = mailtos[0]; // e.g., "mailto:unsub@example.com?subject=Unsubscribe"
      const url = new URL(mailto);
      const to = url.pathname; // email address
      const subject =
        url.searchParams.get("subject") ?? "Unsubscribe";
      const body = url.searchParams.get("body") ?? "";

      await sendEmail(tokens, { to, subject, body });
      console.log(`Mailto unsubscribe sent to: ${to}`);
      return { method: "mailto", success: true };
    } catch (err: any) {
      console.warn("Mailto unsubscribe failed:", err);
      // Fall through to URL method
    }
  }

  // 3. URL — return for user to visit
  if (urls.length > 0) {
    return { method: "url", success: true, url: urls[0] };
  }

  return { method: "none", success: false };
}

/**
 * Send a simple email via Gmail (used for mailto: unsubscribe).
 */
async function sendEmail(
  tokens: GoogleTokens,
  opts: { to: string; subject: string; body: string },
): Promise<void> {
  const { gmail } = getGmailClient(tokens);

  const raw = Buffer.from(
    [
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      "",
      opts.body,
    ].join("\r\n"),
  ).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

// ── Message Parsing ─────────────────────────────────────────────────────────

function parseMessage(msg: any): RawEmail | null {
  if (!msg.id) return null;

  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers ?? []) {
    if (h.name && h.value) {
      headers[h.name.toLowerCase()] = h.value;
    }
  }

  const from = headers["from"] ?? "";
  const { name: fromName, email: fromEmail } = parseFromHeader(from);

  const subject = headers["subject"] ?? "(no subject)";
  const date = headers["date"];
  const receivedAt = date ? new Date(date) : new Date();

  const { text, html } = extractBody(msg.payload);

  // Extract List-Unsubscribe headers (RFC 2369 / RFC 8058)
  const listUnsubscribe = headers["list-unsubscribe"] ?? null;
  const listUnsubscribePost = headers["list-unsubscribe-post"] ?? null;

  return {
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId ?? msg.id,
    fromEmail,
    fromName,
    subject,
    bodyText: text,
    bodyHtml: html,
    receivedAt,
    listUnsubscribe,
    listUnsubscribePost,
  };
}

function parseFromHeader(from: string): { name: string; email: string } {
  // "John Doe <john@example.com>" or just "john@example.com"
  const match = from.match(/^"?(.+?)"?\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { name: "", email: from.trim() };
}

function extractBody(payload: any): { text: string; html: string } {
  let text = "";
  let html = "";

  if (!payload) return { text, html };

  // Single part
  if (payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, "base64url").toString(
      "utf-8",
    );
    if (payload.mimeType === "text/plain") text = decoded;
    if (payload.mimeType === "text/html") html = decoded;
  }

  // Multipart
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result.text && !text) text = result.text;
      if (result.html && !html) html = result.html;
    }
  }

  return { text, html };
}
