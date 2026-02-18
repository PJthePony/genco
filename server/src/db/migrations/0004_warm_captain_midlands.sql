CREATE TABLE "message_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"message_hash" text NOT NULL,
	"sender_phone" text NOT NULL,
	"sender_name" text,
	"message_text" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"is_from_me" boolean DEFAULT false NOT NULL,
	"ai_summary" text,
	"ai_recommended_action" text,
	"ai_priority" text,
	"ai_reply_draft" text,
	"is_urgent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"chosen_action" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"recipient_name" text,
	"message_text" text NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "network_contacts" ADD COLUMN "phone_number" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_message_queue_hash" ON "message_queue" USING btree ("user_id","message_hash");--> statement-breakpoint
CREATE INDEX "idx_message_queue_user_status" ON "message_queue" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_message_queue_user_urgent" ON "message_queue" USING btree ("user_id","is_urgent");--> statement-breakpoint
CREATE INDEX "idx_outbound_messages_status" ON "outbound_messages" USING btree ("user_id","status");