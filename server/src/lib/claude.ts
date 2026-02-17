import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config.js";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ── Tool Definition ─────────────────────────────────────────────────────────

const CLASSIFY_EMAIL_TOOL: Anthropic.Tool = {
  name: "classify_email",
  description:
    "Classify an email, recommend an action, and update the sender relationship summary.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "A concise 1-2 sentence summary of the email. Focus on what matters — who wants what, by when. No filler.",
      },
      recommended_action: {
        type: "string",
        enum: [
          "reply",
          "add_task",
          "archive",
          "unsubscribe",
          "briefing",
          "act",
        ],
        description:
          "The recommended action: 'reply' (needs a response), 'add_task' (creates a task in Tessio), 'archive' (no action needed), 'unsubscribe' (newsletter/marketing to unsubscribe from), 'briefing' (informational — route to daily digest), 'act' (take a direct action like RSVP, confirm, etc.)",
      },
      priority: {
        type: "string",
        enum: ["high", "medium", "low"],
        description:
          "Priority level based on sender importance, deadline urgency, and action required.",
      },
      is_urgent: {
        type: "boolean",
        description:
          "True ONLY if the email requires attention within the next few hours — e.g., meeting in 1 hour, server is down, time-sensitive deadline today. Most emails are NOT urgent.",
      },
      reply_draft: {
        type: "string",
        description:
          "A draft reply if recommended_action is 'reply'. Write as P.J. — casual, direct, friendly. Keep it short. Leave blank if not a reply.",
      },
      task_title: {
        type: "string",
        description:
          "A concise task title if recommended_action is 'add_task'. Action-oriented, e.g., 'Review Q3 budget proposal from Sarah'. Leave blank if not a task.",
      },
      updated_sender_summary: {
        type: "string",
        description:
          "An updated summary of P.J.'s relationship with this sender. Include: who they are, their role/org, what the ongoing conversation is about, how P.J. typically interacts with them, and any patterns. 2-4 sentences max. If this is the first email from this sender, create the initial summary. If a previous summary exists, update it with context from this email.",
      },
    },
    required: [
      "summary",
      "recommended_action",
      "priority",
      "is_urgent",
      "updated_sender_summary",
    ],
  },
};

// ── Classification ──────────────────────────────────────────────────────────

export interface ClassificationResult {
  summary: string;
  recommendedAction: string;
  priority: string;
  isUrgent: boolean;
  replyDraft: string | null;
  taskTitle: string | null;
  updatedSenderSummary: string;
}

interface ClassifyEmailOptions {
  fromName: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  senderSummary?: string | null;
  feedbackContext?: string;
  briefingSourceEmails?: string[];
}

export async function classifyEmail(
  opts: ClassifyEmailOptions,
): Promise<ClassificationResult> {
  const systemParts: string[] = [
    `You are Genco, P.J. Tanzillo's AI email triage assistant. Your job is to classify each email and recommend the best action.`,
    ``,
    `P.J. is "The Don" — a busy founder/builder. He wants to spend zero time on email that doesn't need him.`,
    ``,
    `ACTIONS:`,
    `- reply: The email needs a personal response from P.J.`,
    `- add_task: The email contains something P.J. needs to do (but not reply to)`,
    `- archive: No action needed — receipts, confirmations, FYI-only, automated notifications`,
    `- unsubscribe: Marketing, newsletters P.J. didn't ask for, promotional spam`,
    `- briefing: Informational content P.J. subscribed to — route to daily digest instead of inbox`,
    `- act: A clear, simple action like RSVPing, confirming attendance, clicking a link`,
    ``,
    `PRIORITY:`,
    `- high: From someone important, has a deadline, or needs a decision`,
    `- medium: Useful but not time-sensitive`,
    `- low: Informational, automated, or easily skippable`,
    ``,
    `URGENCY: Almost nothing is urgent. Only flag as urgent if P.J. needs to act within hours.`,
    ``,
    `REPLY DRAFTS: Write as P.J. — casual, direct, warm but not wordy. First-name basis. No "Dear" or "Best regards."`,
    ``,
    `SENDER SUMMARY: You must update the sender relationship summary. This is P.J.'s memory of this sender. If there's an existing summary, update it with new context from this email. If there's no existing summary, create one from scratch. Include: who they are, their role/company, what the conversation is about, and how P.J. should handle their emails. Keep it to 2-4 sentences.`,
  ];

  // Add sender relationship context
  if (opts.senderSummary) {
    systemParts.push(``);
    systemParts.push(
      `EXISTING SENDER RELATIONSHIP with ${opts.fromEmail}:`,
    );
    systemParts.push(opts.senderSummary);
  } else {
    systemParts.push(``);
    systemParts.push(
      `This is the FIRST email P.J. has received from ${opts.fromEmail}. Create an initial sender summary.`,
    );
  }

  // Add briefing source context
  if (opts.briefingSourceEmails?.length) {
    systemParts.push(``);
    systemParts.push(
      `BRIEFING SOURCES (these senders should be routed to 'briefing'):`,
    );
    for (const email of opts.briefingSourceEmails) {
      systemParts.push(`- ${email}`);
    }
  }

  // Add feedback history context
  if (opts.feedbackContext) {
    systemParts.push(``);
    systemParts.push(
      `USER FEEDBACK (P.J.'s past corrections — learn from these):`,
    );
    systemParts.push(opts.feedbackContext);
  }

  const system = systemParts.join("\n");

  // Truncate body to avoid blowing the context
  const body = opts.bodyText.slice(0, 3000);

  const userMessage = `From: ${opts.fromName} <${opts.fromEmail}>\nSubject: ${opts.subject}\n\n${body}`;

  // Retry with exponential backoff (max 3 attempts)
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
        console.log(
          `Claude API retry attempt ${attempt + 1} after ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system,
        tools: [CLASSIFY_EMAIL_TOOL],
        tool_choice: { type: "tool", name: "classify_email" },
        messages: [{ role: "user", content: userMessage }],
      });

      // Extract tool use response
      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (!toolUse) {
        throw new Error("Claude did not return a tool use response");
      }

      const input = toolUse.input as Record<string, unknown>;

      return {
        summary: (input.summary as string) ?? "",
        recommendedAction: (input.recommended_action as string) ?? "archive",
        priority: (input.priority as string) ?? "medium",
        isUrgent: (input.is_urgent as boolean) ?? false,
        replyDraft: (input.reply_draft as string) || null,
        taskTitle: (input.task_title as string) || null,
        updatedSenderSummary:
          (input.updated_sender_summary as string) ?? "",
      };
    } catch (err: any) {
      lastError = err;
      // Don't retry on non-transient errors
      if (err.status && err.status < 500 && err.status !== 429) {
        throw err;
      }
    }
  }

  throw lastError ?? new Error("Claude classification failed after retries");
}

// ── Sender Summary from History ────────────────────────────────────────

export interface SenderHistoryItem {
  subject: string;
  date: Date;
  snippet: string;
  direction: "sent" | "received";
}

/**
 * Build a sender relationship summary from their full email history.
 * Called once per new sender to establish context before classification.
 */
export async function buildSenderSummaryFromHistory(
  senderEmail: string,
  senderName: string,
  history: SenderHistoryItem[],
): Promise<string> {
  if (history.length === 0) {
    return `First email from ${senderName || senderEmail}. No prior history.`;
  }

  // Build a compact representation of the email history
  const historyLines = history.map((h) => {
    const dateStr = h.date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const dir = h.direction === "sent" ? "P.J. →" : "→ P.J.";
    // Truncate snippet to keep prompt lean
    const snippet = h.snippet.slice(0, 120);
    return `[${dateStr}] ${dir} "${h.subject}" — ${snippet}`;
  });

  // Cap history context at ~4000 chars to stay within budget
  let historyText = "";
  for (const line of historyLines) {
    if (historyText.length + line.length > 4000) break;
    historyText += line + "\n";
  }

  const system = [
    `You are building a sender relationship profile for P.J. Tanzillo's email assistant.`,
    `Analyze the email history between P.J. and this sender and create a concise relationship summary.`,
    ``,
    `Include:`,
    `- Who this person/organization is (role, company, type of sender)`,
    `- The nature of the relationship (colleague, vendor, newsletter, personal contact, etc.)`,
    `- What they typically email about`,
    `- Communication patterns (frequency, typical tone, who initiates)`,
    `- How P.J. should handle their emails (reply quickly, archive, unsubscribe, etc.)`,
    ``,
    `Keep it to 3-5 sentences. Be specific and practical.`,
  ].join("\n");

  const userMessage = [
    `Sender: ${senderName} <${senderEmail}>`,
    `Total emails in history: ${history.length}`,
    ``,
    `Email history (chronological):`,
    historyText,
  ].join("\n");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 512,
        system,
        messages: [{ role: "user", content: userMessage }],
      });

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );

      return textBlock?.text ?? `Sender: ${senderName || senderEmail}. ${history.length} emails in history.`;
    } catch (err: any) {
      lastError = err;
      if (err.status && err.status < 500 && err.status !== 429) throw err;
    }
  }

  throw lastError ?? new Error("Failed to build sender summary");
}

// ── Reply Draft Generation ──────────────────────────────────────────────

/**
 * Generate a reply draft based on user-provided context/instructions.
 * Called when the user overrides an action to "Reply" and provides
 * instructions about what the reply should say.
 */
export async function generateReplyDraft(opts: {
  fromName: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  replyContext: string;
  senderSummary?: string | null;
}): Promise<string> {
  const systemParts = [
    `You are drafting an email reply for P.J. Tanzillo.`,
    `Write as P.J. — casual, direct, warm but not wordy. First-name basis. No "Dear" or "Best regards."`,
    `Keep it short and natural. Match P.J.'s tone: friendly, efficient, slightly informal.`,
    ``,
    `The user has given you specific instructions about what to say. Follow those instructions closely.`,
  ];

  if (opts.senderSummary) {
    systemParts.push(``);
    systemParts.push(`RELATIONSHIP WITH ${opts.fromEmail}:`);
    systemParts.push(opts.senderSummary);
  }

  const system = systemParts.join("\n");

  const bodySnippet = opts.bodyText.slice(0, 2000);

  const userMessage = [
    `ORIGINAL EMAIL:`,
    `From: ${opts.fromName} <${opts.fromEmail}>`,
    `Subject: ${opts.subject}`,
    ``,
    bodySnippet,
    ``,
    `P.J.'S INSTRUCTIONS FOR THE REPLY:`,
    opts.replyContext,
    ``,
    `Write the reply now. Just the reply body — no subject line, no greeting header, no signature block.`,
  ].join("\n");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userMessage }],
      });

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );

      return textBlock?.text ?? "Thanks for the email!";
    } catch (err: any) {
      lastError = err;
      if (err.status && err.status < 500 && err.status !== 429) throw err;
    }
  }

  throw lastError ?? new Error("Failed to generate reply draft");
}
