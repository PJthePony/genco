CREATE TABLE "sender_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"sender_email" text NOT NULL,
	"sender_name" text,
	"summary" text NOT NULL,
	"email_count" text DEFAULT '1' NOT NULL,
	"last_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sender_summaries_user_email" ON "sender_summaries" USING btree ("user_id","sender_email");--> statement-breakpoint
CREATE INDEX "idx_sender_summaries_user" ON "sender_summaries" USING btree ("user_id");