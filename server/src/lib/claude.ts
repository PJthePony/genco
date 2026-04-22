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
        enum: ["reply", "act", "archive"],
        description:
          "The recommended action: 'reply' (needs a personal response from P.J.), 'act' (a direct action is needed — unsubscribe, create task, route to briefing, RSVP, etc.), 'archive' (no action needed — receipts, confirmations, FYI-only)",
      },
      recommended_sub_action: {
        type: "string",
        enum: ["unsubscribe", "add_task", "briefing"],
        description:
          "Required when recommended_action is 'act'. Specifies the sub-action: 'unsubscribe' (marketing/newsletter to unsubscribe from), 'add_task' (contains something P.J. needs to do), 'briefing' (informational content to route to daily digest). Omit when recommended_action is 'reply' or 'archive'.",
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
      reply_summary: {
        type: "string",
        description:
          "A one-line summary of what the reply should say, if recommended_action is 'reply'. Describe the direction, e.g., 'Accept the meeting and confirm Thursday at 2pm' or 'Decline — P.J. is traveling that week'. This is NOT the full draft — just the direction. Leave blank if not a reply.",
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
      personal_context: {
        type: "array",
        description:
          "Personal facts about the sender extracted from this email. Only populate when instructed. Short, specific facts like 'Daughter Emma starting college in September', 'Training for a marathon', 'Birthday is March 12'. Include date_relevant as an ISO date string if the fact is time-bound.",
        items: {
          type: "object",
          properties: {
            fact: {
              type: "string",
              description: "A short personal fact or life event",
            },
            date_relevant: {
              type: "string",
              description:
                "ISO date (YYYY-MM-DD) if the fact is time-bound, omit otherwise",
            },
          },
          required: ["fact"],
        },
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

export interface PersonalContextItem {
  fact: string;
  dateRelevant: string | null;
}

export interface ClassificationResult {
  summary: string;
  recommendedAction: string;
  recommendedSubAction: string | null;
  priority: string;
  isUrgent: boolean;
  replySummary: string | null;
  taskTitle: string | null;
  updatedSenderSummary: string;
  personalContext?: PersonalContextItem[];
}

interface ClassifyEmailOptions {
  fromName: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  senderSummary?: string | null;
  feedbackContext?: string;
  briefingSourceEmails?: string[];
  isNetworkContact?: boolean;
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
    `- reply: The email needs a personal response from P.J. Provide a reply_summary describing the direction of the reply.`,
    `- act: A direct action is needed. Always specify a recommended_sub_action:`,
    `  - unsubscribe: Marketing, newsletters P.J. didn't ask for, promotional spam`,
    `  - add_task: The email contains something P.J. needs to do (but not reply to). Provide a task_title.`,
    `  - briefing: Informational content P.J. subscribed to — route to daily digest`,
    `- archive: No action needed — receipts, confirmations, FYI-only, automated notifications`,
    ``,
    `PRIORITY:`,
    `- high: From someone important, has a deadline, or needs a decision`,
    `- medium: Useful but not time-sensitive`,
    `- low: Informational, automated, or easily skippable`,
    ``,
    `URGENCY: Almost nothing is urgent. Only flag as urgent if P.J. needs to act within hours.`,
    ``,
    `REPLY SUMMARY: When recommending 'reply', write a one-line summary of what the reply should say — the direction, not the full text. E.g., "Accept the meeting, confirm Thursday at 2pm" or "Ask for more details about the budget".`,
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

  // Add personal context extraction for network contacts
  if (opts.isNetworkContact) {
    systemParts.push(``);
    systemParts.push(
      `PERSONAL CONTEXT EXTRACTION: This sender is in P.J.'s personal network. Extract any personal facts or life events mentioned in this email — kids, moves, milestones, hobbies, birthdays, trips, career changes, health events. Return them in the personal_context field. Only extract facts that are genuinely personal and useful for maintaining the relationship. Include date_relevant as an ISO date if the fact is time-bound.`,
    );
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

      const personalContext: PersonalContextItem[] | undefined =
        opts.isNetworkContact && Array.isArray(input.personal_context)
          ? (input.personal_context as any[]).map((pc: any) => ({
              fact: String(pc.fact ?? ""),
              dateRelevant: pc.date_relevant
                ? String(pc.date_relevant)
                : null,
            }))
          : undefined;

      // Normalize: map old action values to new 3-action model
      let action = (input.recommended_action as string) ?? "archive";
      let subAction = (input.recommended_sub_action as string) || null;

      // Backward compat: if the model returns old top-level values, remap
      if (action === "unsubscribe") { action = "act"; subAction = "unsubscribe"; }
      if (action === "add_task") { action = "act"; subAction = "add_task"; }
      if (action === "briefing") { action = "act"; subAction = "briefing"; }

      return {
        summary: (input.summary as string) ?? "",
        recommendedAction: action,
        recommendedSubAction: subAction,
        priority: (input.priority as string) ?? "medium",
        isUrgent: (input.is_urgent as boolean) ?? false,
        replySummary: (input.reply_summary as string) || null,
        taskTitle: (input.task_title as string) || null,
        updatedSenderSummary:
          (input.updated_sender_summary as string) ?? "",
        personalContext,
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

// ── iMessage Classification ────────────────────────────────────────────────

const CLASSIFY_MESSAGE_TOOL: Anthropic.Tool = {
  name: "classify_message",
  description:
    "Classify an iMessage and recommend an action.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "A concise 1 sentence summary of the message. What do they want?",
      },
      recommended_action: {
        type: "string",
        enum: ["reply", "add_task", "archive", "skip"],
        description:
          "The recommended action: 'reply' (needs a response), 'add_task' (creates a task in Tessio), 'archive' (no action needed — automated messages, group chat noise), 'skip' (not sure, let P.J. decide later)",
      },
      priority: {
        type: "string",
        enum: ["high", "medium", "low"],
        description:
          "Priority level based on sender importance and urgency.",
      },
      is_urgent: {
        type: "boolean",
        description:
          "True ONLY if the message requires attention within the next hour — e.g., 'I'm outside', 'are you coming?', 'call me ASAP'. Most messages are NOT urgent.",
      },
      reply_draft: {
        type: "string",
        description:
          "A draft reply if recommended_action is 'reply'. Write as P.J. — casual, short, text-message style. No formality. Leave blank if not a reply.",
      },
    },
    required: [
      "summary",
      "recommended_action",
      "priority",
      "is_urgent",
    ],
  },
};

export interface MessageClassificationResult {
  summary: string;
  recommendedAction: string;
  priority: string;
  isUrgent: boolean;
  replyDraft: string | null;
}

interface ClassifyMessageOptions {
  senderPhone: string;
  senderName: string;
  messageText: string;
  senderSummary?: string | null;
  feedbackContext?: string;
}

export async function classifyMessage(
  opts: ClassifyMessageOptions,
): Promise<MessageClassificationResult> {
  const systemParts: string[] = [
    `You are Genco, P.J. Tanzillo's AI communications assistant. You're classifying an iMessage (text message).`,
    ``,
    `P.J. is "The Don" — a busy founder/builder. He gets a lot of texts and wants to triage them efficiently.`,
    ``,
    `CONTEXT: This is an iMessage, not an email. Messages are typically casual, brief, and conversational. Most personal messages from known contacts should be 'reply'.`,
    ``,
    `ACTIONS:`,
    `- reply: The message needs a response from P.J. (most common for personal texts)`,
    `- add_task: The message contains something P.J. needs to do (but not reply to right now)`,
    `- archive: No action needed — automated messages, verification codes, delivery notifications, group chat noise`,
    `- skip: Unclear — let P.J. decide`,
    ``,
    `PRIORITY:`,
    `- high: Close friend/family, time-sensitive, or needs a decision`,
    `- medium: Normal conversation, not time-sensitive`,
    `- low: Automated, informational, or easily ignorable`,
    ``,
    `URGENCY: Only flag as urgent if someone is waiting right now — "I'm here", "running late?", "call me ASAP".`,
    ``,
    `REPLY DRAFTS: Write as P.J. texts — very casual, short, lowercase ok. Match text message tone. 1-2 sentences max.`,
  ];

  if (opts.senderSummary) {
    systemParts.push(``);
    systemParts.push(
      `EXISTING RELATIONSHIP with ${opts.senderName || opts.senderPhone}:`,
    );
    systemParts.push(opts.senderSummary);
  }

  if (opts.feedbackContext) {
    systemParts.push(``);
    systemParts.push(
      `USER FEEDBACK (P.J.'s past corrections — learn from these):`,
    );
    systemParts.push(opts.feedbackContext);
  }

  const system = systemParts.join("\n");

  const userMessage = `From: ${opts.senderName || "Unknown"} (${opts.senderPhone})\n\n${opts.messageText}`;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(
          `Claude API retry attempt ${attempt + 1} after ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 512,
        system,
        tools: [CLASSIFY_MESSAGE_TOOL],
        tool_choice: { type: "tool", name: "classify_message" },
        messages: [{ role: "user", content: userMessage }],
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (!toolUse) {
        throw new Error("Claude did not return a tool use response");
      }

      const input = toolUse.input as Record<string, unknown>;

      return {
        summary: (input.summary as string) ?? "",
        recommendedAction: (input.recommended_action as string) ?? "skip",
        priority: (input.priority as string) ?? "medium",
        isUrgent: (input.is_urgent as boolean) ?? false,
        replyDraft: (input.reply_draft as string) || null,
      };
    } catch (err: any) {
      lastError = err;
      if (err.status && err.status < 500 && err.status !== 429) {
        throw err;
      }
    }
  }

  throw lastError ?? new Error("Claude message classification failed after retries");
}

// ── iMessage Reply Draft ──────────────────────────────────────────────────

export async function generateMessageReplyDraft(opts: {
  senderName: string;
  senderPhone: string;
  messageText: string;
  replyContext: string;
  senderSummary?: string | null;
}): Promise<string> {
  const systemParts = [
    `You are drafting an iMessage reply for P.J. Tanzillo.`,
    `Write as P.J. texts — casual, short, no formality. Match text message tone.`,
    `Keep it to 1-3 sentences max. This is a text, not an email.`,
    ``,
    `The user has given you specific instructions about what to say. Follow those instructions closely.`,
  ];

  if (opts.senderSummary) {
    systemParts.push(``);
    systemParts.push(`RELATIONSHIP WITH ${opts.senderName || opts.senderPhone}:`);
    systemParts.push(opts.senderSummary);
  }

  const system = systemParts.join("\n");

  const userMessage = [
    `ORIGINAL MESSAGE:`,
    `From: ${opts.senderName || "Unknown"} (${opts.senderPhone})`,
    ``,
    opts.messageText,
    ``,
    `P.J.'S INSTRUCTIONS FOR THE REPLY:`,
    opts.replyContext,
    ``,
    `Write the reply now. Just the message text — nothing else.`,
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
        max_tokens: 256,
        system,
        messages: [{ role: "user", content: userMessage }],
      });

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );

      return textBlock?.text ?? "Sounds good!";
    } catch (err: any) {
      lastError = err;
      if (err.status && err.status < 500 && err.status !== 429) throw err;
    }
  }

  throw lastError ?? new Error("Failed to generate message reply draft");
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

// ── Reply From Direction ──────────────────────────────────────────────

/**
 * Generate a full reply draft from a user-approved (or edited) direction.
 * Called on-demand when the user approves or edits the reply summary.
 */
export async function generateReplyFromDirection(opts: {
  fromName: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  direction?: string | null;
  senderSummary?: string | null;
  voice?: VoiceContext | null;
  fewShotExamples?: { subject: string; body: string }[];
  previousDraft?: string | null;
  feedback?: string | null;
}): Promise<string> {
  const systemParts = [
    `You are drafting an email reply for P.J. Tanzillo.`,
    `Write in P.J.'s voice. Match the tone, sentence length, greeting and sign-off habits of the examples and voice profile below.`,
    `Keep it short and natural unless P.J.'s voice for this audience is longer.`,
  ];

  if (opts.voice) {
    systemParts.push(``);
    systemParts.push(
      `VOICE PROFILE FOR THIS AUDIENCE — "${opts.voice.label}" (formality ${opts.voice.formalityScore}/100):`,
    );
    systemParts.push(opts.voice.description);
    if (opts.voice.greetingHabits)
      systemParts.push(`Greeting: ${opts.voice.greetingHabits}`);
    if (opts.voice.signOffHabits)
      systemParts.push(`Sign-off: ${opts.voice.signOffHabits}`);
    if (opts.voice.sentenceStyle)
      systemParts.push(`Sentences: ${opts.voice.sentenceStyle}`);
    if (opts.voice.samplePhrases.length > 0) {
      systemParts.push(`Phrases P.J. uses with this audience:`);
      for (const p of opts.voice.samplePhrases.slice(0, 5)) {
        systemParts.push(`- "${p}"`);
      }
    }
  }

  if (opts.fewShotExamples && opts.fewShotExamples.length > 0) {
    systemParts.push(``);
    systemParts.push(
      `RECENT EMAILS P.J. SENT TO THIS CONTACT — match this voice precisely:`,
    );
    for (const ex of opts.fewShotExamples) {
      systemParts.push(``);
      systemParts.push(`Subject: ${ex.subject}`);
      systemParts.push(ex.body);
    }
  }

  if (opts.senderSummary) {
    systemParts.push(``);
    systemParts.push(`RELATIONSHIP WITH ${opts.fromEmail}:`);
    systemParts.push(opts.senderSummary);
  }

  const system = systemParts.join("\n");
  const bodySnippet = opts.bodyText.slice(0, 2000);

  const userParts = [
    `ORIGINAL EMAIL:`,
    `From: ${opts.fromName} <${opts.fromEmail}>`,
    `Subject: ${opts.subject}`,
    ``,
    bodySnippet,
  ];

  if (opts.direction) {
    userParts.push(``);
    userParts.push(`P.J.'S DIRECTION FOR THIS REPLY: ${opts.direction}`);
  }

  userParts.push(``);
  if (opts.previousDraft && opts.feedback) {
    userParts.push(`PREVIOUS DRAFT:`);
    userParts.push(opts.previousDraft);
    userParts.push(``);
    userParts.push(`P.J.'S FEEDBACK ON THE DRAFT: ${opts.feedback}`);
    userParts.push(``);
    userParts.push(
      `Rewrite the reply applying the feedback. Just the body — no subject line, no greeting header, no signature block.`,
    );
  } else {
    userParts.push(
      `Write the reply now. Just the reply body — no subject line, no greeting header, no signature block.`,
    );
  }

  const userMessage = userParts.join("\n");

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

  throw lastError ?? new Error("Failed to generate reply from direction");
}

// ── Re-classify for Action (Promote Flow) ────────────────────────────

/**
 * Re-classify an email constrained to 'reply' or 'act' only.
 * Used when promoting a briefing item to the action queue.
 */
const RECLASSIFY_TOOL: Anthropic.Tool = {
  name: "reclassify_email",
  description:
    "Re-classify an email for the action queue. Only 'reply' or 'act' are valid — this email needs action.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "A concise 1-2 sentence summary. Focus on what matters.",
      },
      recommended_action: {
        type: "string",
        enum: ["reply", "act"],
        description:
          "'reply' if P.J. needs to respond personally, 'act' if a direct action is needed (unsubscribe, create task, etc.)",
      },
      recommended_sub_action: {
        type: "string",
        enum: ["unsubscribe", "add_task"],
        description:
          "Required when recommended_action is 'act'. 'unsubscribe' or 'add_task'. (briefing is not valid here — this item was just promoted FROM briefing.)",
      },
      priority: {
        type: "string",
        enum: ["high", "medium", "low"],
      },
      is_urgent: {
        type: "boolean",
        description: "True only if P.J. needs to act within hours.",
      },
      reply_summary: {
        type: "string",
        description:
          "One-line direction for the reply if recommended_action is 'reply'. Leave blank otherwise.",
      },
      task_title: {
        type: "string",
        description:
          "Task title if sub-action is 'add_task'. Leave blank otherwise.",
      },
    },
    required: ["summary", "recommended_action", "priority", "is_urgent"],
  },
};

export interface ReclassifyResult {
  summary: string;
  recommendedAction: string;
  recommendedSubAction: string | null;
  priority: string;
  isUrgent: boolean;
  replySummary: string | null;
  taskTitle: string | null;
}

export async function reclassifyForAction(opts: {
  fromName: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  senderSummary?: string | null;
  feedbackContext?: string;
}): Promise<ReclassifyResult> {
  const systemParts = [
    `You are Genco, P.J.'s email triage assistant. This email was originally routed to the daily briefing but P.J. wants to take action on it.`,
    ``,
    `Re-classify it for the action queue. Only 'reply' or 'act' are valid — 'archive' and 'briefing' are not options since P.J. explicitly wants to act.`,
    ``,
    `- reply: P.J. needs to respond personally. Provide a reply_summary with the direction.`,
    `- act: A direct action is needed. Specify sub-action: 'unsubscribe' or 'add_task' (with task_title).`,
  ];

  if (opts.senderSummary) {
    systemParts.push(``);
    systemParts.push(`SENDER RELATIONSHIP:`);
    systemParts.push(opts.senderSummary);
  }

  if (opts.feedbackContext) {
    systemParts.push(``);
    systemParts.push(`USER FEEDBACK (past corrections):`);
    systemParts.push(opts.feedbackContext);
  }

  const system = systemParts.join("\n");
  const body = opts.bodyText.slice(0, 3000);
  const userMessage = `From: ${opts.fromName} <${opts.fromEmail}>\nSubject: ${opts.subject}\n\n${body}`;

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
        tools: [RECLASSIFY_TOOL],
        tool_choice: { type: "tool", name: "reclassify_email" },
        messages: [{ role: "user", content: userMessage }],
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (!toolUse) {
        throw new Error("Claude did not return a tool use response");
      }

      const input = toolUse.input as Record<string, unknown>;

      return {
        summary: (input.summary as string) ?? "",
        recommendedAction: (input.recommended_action as string) ?? "act",
        recommendedSubAction: (input.recommended_sub_action as string) || null,
        priority: (input.priority as string) ?? "medium",
        isUrgent: (input.is_urgent as boolean) ?? false,
        replySummary: (input.reply_summary as string) || null,
        taskTitle: (input.task_title as string) || null,
      };
    } catch (err: any) {
      lastError = err;
      if (err.status && err.status < 500 && err.status !== 429) throw err;
    }
  }

  throw lastError ?? new Error("Failed to reclassify email");
}

// ── Follow-Up Draft Generation ──────────────────────────────────────────

/**
 * Generate a proactive follow-up email draft for a network contact.
 * Called on-demand when the user clicks "Draft" on a follow-up card.
 */
export interface VoiceContext {
  label: string;
  description: string;
  formalityScore: number;
  greetingHabits: string;
  signOffHabits: string;
  sentenceStyle: string;
  samplePhrases: string[];
}

export async function generateFollowUpDraft(opts: {
  contactName: string;
  contactEmail: string;
  senderSummary: string | null;
  reason: string;
  contextSnapshot: string;
  personalFacts: string[];
  lastSubject: string | null;
  direction?: string | null;
  previousDraft?: string | null;
  feedback?: string | null;
  voice?: VoiceContext | null;
  fewShotExamples?: { subject: string; body: string }[];
}): Promise<string> {
  const systemParts = [
    `You are drafting a proactive outreach email for P.J. Tanzillo.`,
    `Write in P.J.'s voice. Match the tone, sentence length, greeting and sign-off habits of the examples and voice profile below.`,
    `This is a follow-up or check-in, not a reply to an incoming email. Make it feel natural and thoughtful, not transactional.`,
    `If personal facts are provided, weave them in naturally — don't force them. A birthday wish or a "how'd the marathon go?" is great. Listing every fact you know is creepy.`,
    `Keep it short — 2-4 sentences max unless P.J.'s voice for this audience is longer.`,
  ];

  if (opts.voice) {
    systemParts.push(``);
    systemParts.push(
      `VOICE PROFILE FOR THIS AUDIENCE — "${opts.voice.label}" (formality ${opts.voice.formalityScore}/100):`,
    );
    systemParts.push(opts.voice.description);
    if (opts.voice.greetingHabits)
      systemParts.push(`Greeting: ${opts.voice.greetingHabits}`);
    if (opts.voice.signOffHabits)
      systemParts.push(`Sign-off: ${opts.voice.signOffHabits}`);
    if (opts.voice.sentenceStyle)
      systemParts.push(`Sentences: ${opts.voice.sentenceStyle}`);
    if (opts.voice.samplePhrases.length > 0) {
      systemParts.push(`Phrases P.J. uses with this audience:`);
      for (const p of opts.voice.samplePhrases.slice(0, 5)) {
        systemParts.push(`- "${p}"`);
      }
    }
  }

  if (opts.fewShotExamples && opts.fewShotExamples.length > 0) {
    systemParts.push(``);
    systemParts.push(
      `RECENT EMAILS P.J. SENT TO THIS CONTACT — match this voice precisely:`,
    );
    for (const ex of opts.fewShotExamples) {
      systemParts.push(``);
      systemParts.push(`Subject: ${ex.subject}`);
      systemParts.push(ex.body);
    }
  }

  if (opts.senderSummary) {
    systemParts.push(``);
    systemParts.push(`RELATIONSHIP WITH ${opts.contactEmail}:`);
    systemParts.push(opts.senderSummary);
  }

  const system = systemParts.join("\n");

  const userParts = [
    `CONTACT: ${opts.contactName} <${opts.contactEmail}>`,
    `REASON FOR FOLLOW-UP: ${opts.reason.replace(/_/g, " ")}`,
  ];

  if (opts.contextSnapshot) {
    userParts.push(`CONTEXT: ${opts.contextSnapshot}`);
  }

  if (opts.lastSubject) {
    userParts.push(`LAST EMAIL THREAD: ${opts.lastSubject}`);
  }

  if (opts.personalFacts.length > 0) {
    userParts.push(``);
    userParts.push(`PERSONAL FACTS ABOUT ${opts.contactName}:`);
    for (const fact of opts.personalFacts) {
      userParts.push(`- ${fact}`);
    }
  }

  if (opts.direction) {
    userParts.push(``);
    userParts.push(`P.J.'S DIRECTION FOR THIS REPLY: ${opts.direction}`);
  }

  userParts.push(``);
  if (opts.previousDraft && opts.feedback) {
    userParts.push(`PREVIOUS DRAFT:`);
    userParts.push(opts.previousDraft);
    userParts.push(``);
    userParts.push(`P.J.'S FEEDBACK ON THE DRAFT: ${opts.feedback}`);
    userParts.push(``);
    userParts.push(
      `Rewrite the email applying the feedback. Just the body — no subject line, no greeting header, no signature block.`,
    );
  } else {
    userParts.push(
      `Write the email now. Just the body — no subject line, no greeting header, no signature block.`,
    );
  }

  const userMessage = userParts.join("\n");

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

      return textBlock?.text ?? "Hey — just wanted to check in. Hope all is well!";
    } catch (err: any) {
      lastError = err;
      if (err.status && err.status < 500 && err.status !== 429) throw err;
    }
  }

  throw lastError ?? new Error("Failed to generate follow-up draft");
}

/**
 * Generate 3-4 short direction chips P.J. can pick before drafting.
 * Each chip is a short imperative phrase, e.g. "Politely decline".
 */
export async function generateDirectionSuggestions(opts: {
  contactName: string;
  reason: string;
  contextSnapshot: string;
  lastSubject: string | null;
  senderSummary: string | null;
}): Promise<string[]> {
  const system = [
    `You suggest short directions for an email follow-up that P.J. is about to draft.`,
    `Return 3-4 distinct, concrete options that fit the context.`,
    `Each option is a short imperative phrase (3-7 words). No leading verbs like "Reply"; just the intent. Examples: "Politely decline, suggest next month", "Confirm and propose Tuesday 2pm", "Ask what timeline they need".`,
    `Output format: one option per line, no numbering, no quotes, no extra commentary.`,
  ].join("\n");

  const userParts = [
    `CONTACT: ${opts.contactName}`,
    `REASON: ${opts.reason.replace(/_/g, " ")}`,
    `CONTEXT: ${opts.contextSnapshot}`,
  ];
  if (opts.lastSubject) userParts.push(`THREAD: ${opts.lastSubject}`);
  if (opts.senderSummary) {
    userParts.push(``);
    userParts.push(`RELATIONSHIP:`);
    userParts.push(opts.senderSummary);
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
      }
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 256,
        system,
        messages: [{ role: "user", content: userParts.join("\n") }],
      });
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      const text = textBlock?.text ?? "";
      const lines = text
        .split("\n")
        .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
        .filter((l) => l.length > 0 && l.length < 80);
      return lines.slice(0, 4);
    } catch (err: any) {
      lastError = err;
      if (err.status && err.status < 500 && err.status !== 429) throw err;
    }
  }
  throw lastError ?? new Error("Failed to generate direction suggestions");
}

/**
 * Pick the best matching voice bucket for a contact using deterministic rules.
 * Score: exact-recipient match (5) > domain match (2) > relationship hint hit (1).
 * Returns the highest-scoring bucket, or null if no buckets were given.
 *
 * For ties (e.g. all zero scores), prefers the bucket with the most-middle
 * formality so we don't accidentally pick "close friends" for a stranger.
 */
export function pickVoiceBucket<
  T extends {
    id: string;
    formalityScore: string | null;
    sampleRecipients: unknown;
    matchSignals: unknown;
  },
>(
  buckets: T[],
  contact: { email: string; senderSummary: string | null },
  assignments?: Map<string, string>, // contactEmail → bucketId
): T | null {
  if (buckets.length === 0) return null;

  const contactEmail = contact.email.toLowerCase();
  const contactDomain = contactEmail.split("@")[1] ?? "";
  const summary = (contact.senderSummary ?? "").toLowerCase();

  // Hard override: manual assignment for this contact
  if (assignments) {
    const assignedId = assignments.get(contactEmail);
    if (assignedId) {
      const hit = buckets.find((b) => b.id === assignedId);
      if (hit) return hit;
    }
  }

  let best: { bucket: T; score: number } | null = null;
  for (const b of buckets) {
    let score = 0;
    const recipients = Array.isArray(b.sampleRecipients)
      ? (b.sampleRecipients as { email?: string }[])
      : [];
    if (
      recipients.some(
        (r) => (r.email ?? "").toLowerCase() === contactEmail,
      )
    ) {
      score += 5;
    }

    const signals = (b.matchSignals ?? {}) as {
      domainHints?: string[];
      relationshipHints?: string[];
    };
    if (signals.domainHints) {
      for (const hint of signals.domainHints) {
        const h = hint.toLowerCase().replace(/^@/, "");
        if (contactDomain === h || contactDomain.endsWith(`.${h}`)) {
          score += 2;
        }
      }
    }
    if (signals.relationshipHints && summary) {
      for (const hint of signals.relationshipHints) {
        if (summary.includes(hint.toLowerCase())) score += 1;
      }
    }

    if (!best || score > best.score) best = { bucket: b, score };
  }

  if (best && best.score > 0) return best.bucket;

  // Tie-breaker: prefer middle-formality bucket
  const ranked = [...buckets].sort((a, b) => {
    const af = Math.abs(Number(a.formalityScore ?? 50) - 50);
    const bf = Math.abs(Number(b.formalityScore ?? 50) - 50);
    return af - bf;
  });
  return ranked[0] ?? null;
}

/**
 * Distill a single voice bucket from a hand-picked subset of samples.
 * Used when the user "splits" a bucket — e.g. pulling family recipients
 * out of "Close friends and colleagues" into a new Family bucket.
 * The LLM produces exactly one bucket.
 */
export async function distillVoiceBucket(
  samples: VoiceSample[],
  opts: { hintLabel?: string } = {},
): Promise<VoiceBucket> {
  if (samples.length === 0) {
    throw new Error("distillVoiceBucket needs at least one sample");
  }

  const system = [
    `You are analyzing a person's sent emails to exactly one audience (these specific recipients).`,
    `Produce one voice bucket that captures their style with this group.`,
    `Look at: greeting habits, sign-offs, sentence length, formality, contractions, lowercase, emoji use, business jargon vs casual phrases, and any phrases unique to this audience (e.g. "love you", nicknames).`,
    opts.hintLabel
      ? `The user has labeled this group "${opts.hintLabel}" — use that as the bucket label.`
      : `Name the bucket based on who these recipients seem to be.`,
    `Return JSON only, no commentary, no markdown fences. Format:`,
    `{"label":"...","description":"...","formalityScore":0-100,"greetingHabits":"...","signOffHabits":"...","sentenceStyle":"...","samplePhrases":["...","..."],"sampleRecipients":[{"email":"...","name":"..."}],"matchSignals":{"domainHints":["..."],"relationshipHints":["..."],"notes":"..."}}`,
    `samplePhrases: 3-5 verbatim short phrases pulled directly from these emails.`,
    `sampleRecipients: the recipients provided (echo them back).`,
  ].join("\n");

  const userParts: string[] = [`SAMPLES (${samples.length}):`];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const body = s.body.length > 700 ? s.body.slice(0, 700) + "…" : s.body;
    userParts.push(``);
    userParts.push(`--- Email ${i + 1} ---`);
    userParts.push(`To: ${s.toName ? `${s.toName} <${s.to}>` : s.to}`);
    userParts.push(`Subject: ${s.subject}`);
    userParts.push(`Body:`);
    userParts.push(body);
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: userParts.join("\n") }],
      });
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      const raw = textBlock?.text ?? "";
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const b = JSON.parse(cleaned) as Partial<VoiceBucket>;
      return {
        label: b.label || opts.hintLabel || "Untitled",
        description: b.description || "",
        formalityScore:
          typeof b.formalityScore === "number" ? b.formalityScore : 50,
        greetingHabits: b.greetingHabits ?? "",
        signOffHabits: b.signOffHabits ?? "",
        sentenceStyle: b.sentenceStyle ?? "",
        samplePhrases: Array.isArray(b.samplePhrases) ? b.samplePhrases : [],
        sampleRecipients: Array.isArray(b.sampleRecipients)
          ? b.sampleRecipients
          : [],
        matchSignals: b.matchSignals ?? {},
      };
    } catch (err: any) {
      lastError = err;
      if (err.status && err.status < 500 && err.status !== 429) throw err;
    }
  }
  throw lastError ?? new Error("Failed to distill voice bucket");
}

// ── Voice Profile Clustering ────────────────────────────────────────────────

export interface VoiceSample {
  to: string;
  toName: string;
  subject: string;
  body: string;
}

export interface VoiceBucket {
  label: string;
  description: string;
  formalityScore: number; // 0-100
  greetingHabits: string;
  signOffHabits: string;
  sentenceStyle: string;
  samplePhrases: string[];
  sampleRecipients: { email: string; name: string }[];
  matchSignals: {
    domainHints?: string[]; // e.g. ["gmail.com"] vs ["@chegg.com"]
    relationshipHints?: string[]; // e.g. ["personal", "family"]
    notes?: string; // free-form rule for picking this bucket
  };
}

/**
 * Cluster a corpus of sent emails into 3-5 voice buckets.
 * The model is told to discover the buckets from the data, not pre-label them.
 */
export async function analyzeVoiceProfiles(
  samples: VoiceSample[],
): Promise<VoiceBucket[]> {
  if (samples.length === 0) return [];

  const system = [
    `You are analyzing a person's sent emails to discover the distinct writing voices they use with different audiences.`,
    `Cluster the emails into 3-8 buckets based on actual style differences — not topics. Only add more buckets when the style difference is genuine (e.g. family gets "love you" while close colleagues don't) — don't fragment when two groups would be described the same way.`,
    `Look at: greeting habits (Hi/Hey/Yo/none), sign-offs (best/thanks/—pj/none), sentence length, formality, contractions, lowercase usage, punctuation, emoji use, business jargon vs casual phrases.`,
    `For each bucket, name it based on the audience it fits (e.g. "Close friends", "Family", "Pro-formal", "Pro-casual peers", "Service/transactional"). Don't force categories — derive them from the data.`,
    `Return JSON only, no commentary, no markdown fences. Format:`,
    `{"buckets":[{"label":"...","description":"...","formalityScore":0-100,"greetingHabits":"...","signOffHabits":"...","sentenceStyle":"...","samplePhrases":["...","..."],"sampleRecipients":[{"email":"...","name":"..."}],"matchSignals":{"domainHints":["..."],"relationshipHints":["..."],"notes":"..."}}]}`,
    `samplePhrases: 3-5 verbatim short phrases pulled directly from emails in this bucket.`,
    `sampleRecipients: 2-4 representative recipients from this bucket (use exactly the email + name as provided).`,
    `matchSignals: hints for picking this bucket at draft time. domainHints can include things like "gmail.com", "@chegg.com", or "@anthropic.com". relationshipHints describe the contact category (personal, family, professional, vendor, etc.). notes is a 1-sentence rule.`,
  ].join("\n");

  // Budget: ~150k tokens for input ≈ 600k chars. Leaves room for system
  // prompt (~2k) and output (~8k).
  const CHAR_BUDGET = 550_000;
  const userParts: string[] = [];
  let chars = 0;
  let includedCount = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const body = s.body.length > 700 ? s.body.slice(0, 700) + "…" : s.body;
    const block = [
      ``,
      `--- Email ${i + 1} ---`,
      `To: ${s.toName ? `${s.toName} <${s.to}>` : s.to}`,
      `Subject: ${s.subject}`,
      `Body:`,
      body,
    ].join("\n");
    if (chars + block.length > CHAR_BUDGET) break;
    userParts.push(block);
    chars += block.length;
    includedCount++;
  }
  userParts.unshift(
    `SAMPLES (${includedCount} of ${samples.length} after trimming to fit budget):`,
  );

  const userMessage = userParts.join("\n");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: userMessage }],
      });

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      const raw = textBlock?.text ?? "";

      // Strip any markdown fences just in case
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      const parsed = JSON.parse(cleaned) as { buckets?: VoiceBucket[] };
      const buckets = parsed.buckets ?? [];
      // Defensive: ensure required fields are present
      return buckets.map((b) => ({
        label: b.label ?? "Untitled",
        description: b.description ?? "",
        formalityScore:
          typeof b.formalityScore === "number" ? b.formalityScore : 50,
        greetingHabits: b.greetingHabits ?? "",
        signOffHabits: b.signOffHabits ?? "",
        sentenceStyle: b.sentenceStyle ?? "",
        samplePhrases: Array.isArray(b.samplePhrases) ? b.samplePhrases : [],
        sampleRecipients: Array.isArray(b.sampleRecipients)
          ? b.sampleRecipients
          : [],
        matchSignals: b.matchSignals ?? {},
      }));
    } catch (err: any) {
      lastError = err;
      if (err.status && err.status < 500 && err.status !== 429) throw err;
    }
  }
  throw lastError ?? new Error("Failed to analyze voice profiles");
}
