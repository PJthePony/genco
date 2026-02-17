CREATE TABLE "briefing_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email_address" text NOT NULL,
	"display_name" text NOT NULL,
	"tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text,
	"from_email" text NOT NULL,
	"from_name" text,
	"subject" text NOT NULL,
	"body_text" text,
	"body_html" text,
	"received_at" timestamp with time zone NOT NULL,
	"ai_summary" text,
	"ai_recommended_action" text,
	"ai_priority" text,
	"ai_reply_draft" text,
	"ai_task_title" text,
	"is_urgent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"chosen_action" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email_queue_id" uuid,
	"sender" text,
	"original_action" text NOT NULL,
	"chosen_action" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"gmail_address" text NOT NULL,
	"google_tokens" jsonb NOT NULL,
	"last_history_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"scan_frequency" text DEFAULT 'hourly' NOT NULL,
	"urgent_sms_enabled" boolean DEFAULT false NOT NULL,
	"phone_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "feedback_log" ADD CONSTRAINT "feedback_log_email_queue_id_email_queue_id_fk" FOREIGN KEY ("email_queue_id") REFERENCES "public"."email_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_briefing_sources_user_email" ON "briefing_sources" USING btree ("user_id","email_address");--> statement-breakpoint
CREATE INDEX "idx_briefing_sources_user" ON "briefing_sources" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_email_queue_gmail_msg" ON "email_queue" USING btree ("user_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "idx_email_queue_user_status" ON "email_queue" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_email_queue_user_urgent" ON "email_queue" USING btree ("user_id","is_urgent");--> statement-breakpoint
CREATE INDEX "idx_feedback_log_user" ON "feedback_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_feedback_log_sender" ON "feedback_log" USING btree ("user_id","sender");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_gmail_connections_user" ON "gmail_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_gmail_connections_email" ON "gmail_connections" USING btree ("gmail_address");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_preferences_user" ON "user_preferences" USING btree ("user_id");