import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ── Gmail Connections ───────────────────────────────────────────────────────

export const gmailConnections = pgTable(
  "gmail_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    gmailAddress: text("gmail_address").notNull(),
    googleTokens: jsonb("google_tokens").notNull(),
    lastHistoryId: text("last_history_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_gmail_connections_user").on(table.userId),
    index("idx_gmail_connections_email").on(table.gmailAddress),
  ],
);

// ── Email Queue ─────────────────────────────────────────────────────────────

export const emailQueue = pgTable(
  "email_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id"),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    subject: text("subject").notNull(),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    aiSummary: text("ai_summary"),
    aiRecommendedAction: text("ai_recommended_action"),
    aiPriority: text("ai_priority"),
    aiReplyDraft: text("ai_reply_draft"),
    aiTaskTitle: text("ai_task_title"),
    listUnsubscribe: text("list_unsubscribe"),
    listUnsubscribePost: text("list_unsubscribe_post"),
    isUrgent: boolean("is_urgent").notNull().default(false),
    status: text("status").notNull().default("pending"),
    chosenAction: text("chosen_action"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_email_queue_gmail_msg").on(table.userId, table.gmailMessageId),
    index("idx_email_queue_user_status").on(table.userId, table.status),
    index("idx_email_queue_user_urgent").on(table.userId, table.isUrgent),
  ],
);

// ── Feedback Log ────────────────────────────────────────────────────────────

export const feedbackLog = pgTable(
  "feedback_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    emailQueueId: uuid("email_queue_id").references(() => emailQueue.id),
    sender: text("sender"),
    originalAction: text("original_action").notNull(),
    chosenAction: text("chosen_action").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_feedback_log_user").on(table.userId),
    index("idx_feedback_log_sender").on(table.userId, table.sender),
  ],
);

// ── Briefing Sources ────────────────────────────────────────────────────────

export const briefingSources = pgTable(
  "briefing_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    emailAddress: text("email_address").notNull(),
    displayName: text("display_name").notNull(),
    tag: text("tag"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_briefing_sources_user_email").on(
      table.userId,
      table.emailAddress,
    ),
    index("idx_briefing_sources_user").on(table.userId),
  ],
);

// ── Sender Summaries ────────────────────────────────────────────────────────

export const senderSummaries = pgTable(
  "sender_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    senderEmail: text("sender_email").notNull(),
    senderName: text("sender_name"),
    summary: text("summary").notNull(),
    emailCount: text("email_count").notNull().default("1"),
    lastAction: text("last_action"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_sender_summaries_user_email").on(
      table.userId,
      table.senderEmail,
    ),
    index("idx_sender_summaries_user").on(table.userId),
  ],
);

// ── User Preferences ────────────────────────────────────────────────────────

export const userPreferences = pgTable(
  "user_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().unique(),
    scanFrequency: text("scan_frequency").notNull().default("hourly"),
    urgentSmsEnabled: boolean("urgent_sms_enabled").notNull().default(false),
    phoneNumber: text("phone_number"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("idx_user_preferences_user").on(table.userId)],
);
