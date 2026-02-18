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

// ── Network Contacts (Personal CRM) ────────────────────────────────────────

export const networkContacts = pgTable(
  "network_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    company: text("company"),
    title: text("title"),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    lastDirection: text("last_direction"), // "sent" | "received"
    threadStatus: text("thread_status"), // "awaiting_their_reply" | "awaiting_your_reply" | "dormant" | "conversation_ended"
    gmailThreadId: text("gmail_thread_id"),
    lastSubject: text("last_subject"),
    phoneNumber: text("phone_number"),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("idx_network_contacts_user_email").on(table.userId, table.email),
    index("idx_network_contacts_user").on(table.userId),
    index("idx_network_contacts_thread_status").on(
      table.userId,
      table.threadStatus,
    ),
  ],
);

// ── Contact Context (Personal Facts) ────────────────────────────────────────

export const contactContext = pgTable(
  "contact_context",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    networkContactId: uuid("network_contact_id")
      .notNull()
      .references(() => networkContacts.id, { onDelete: "cascade" }),
    fact: text("fact").notNull(),
    dateRelevant: timestamp("date_relevant", { withTimezone: true }),
    sourceSubject: text("source_subject"),
    extractedAt: timestamp("extracted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expired: boolean("expired").notNull().default(false),
  },
  (table) => [
    index("idx_contact_context_contact").on(table.networkContactId),
    index("idx_contact_context_date").on(table.dateRelevant),
  ],
);

// ── Message Queue (iMessage) ────────────────────────────────────────────────

export const messageQueue = pgTable(
  "message_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    messageHash: text("message_hash").notNull(),
    senderPhone: text("sender_phone").notNull(),
    senderName: text("sender_name"),
    messageText: text("message_text").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    isFromMe: boolean("is_from_me").notNull().default(false),
    aiSummary: text("ai_summary"),
    aiRecommendedAction: text("ai_recommended_action"),
    aiPriority: text("ai_priority"),
    aiReplyDraft: text("ai_reply_draft"),
    isUrgent: boolean("is_urgent").notNull().default(false),
    status: text("status").notNull().default("pending"),
    chosenAction: text("chosen_action"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_message_queue_hash").on(table.userId, table.messageHash),
    index("idx_message_queue_user_status").on(table.userId, table.status),
    index("idx_message_queue_user_urgent").on(table.userId, table.isUrgent),
  ],
);

// ── Outbound Messages (iMessage sends) ──────────────────────────────────────

export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    recipientName: text("recipient_name"),
    messageText: text("message_text").notNull(),
    sourceType: text("source_type"), // "message_reply" | "follow_up_nudge"
    sourceId: uuid("source_id"),
    status: text("status").notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_outbound_messages_status").on(table.userId, table.status),
  ],
);

// ── Follow-Up Queue ─────────────────────────────────────────────────────────

export const followUpQueue = pgTable(
  "follow_up_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    networkContactId: uuid("network_contact_id")
      .notNull()
      .references(() => networkContacts.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(), // "ball_in_your_court" | "went_cold" | "date_coming_up"
    surfacedAt: timestamp("surfaced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull().default("pending"), // "pending" | "acted" | "snoozed" | "dismissed"
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    suggestedAction: text("suggested_action"), // "reply" | "compose_new" | "check_in"
    aiDraft: text("ai_draft"),
    contextSnapshot: text("context_snapshot"),
  },
  (table) => [
    index("idx_follow_up_queue_contact").on(table.networkContactId),
    index("idx_follow_up_queue_status").on(table.status),
  ],
);
