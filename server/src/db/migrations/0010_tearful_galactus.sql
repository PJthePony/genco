CREATE TABLE "voice_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"to_email" text NOT NULL,
	"to_name" text,
	"subject" text,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_voice_samples_user_msg" ON "voice_samples" USING btree ("user_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "idx_voice_samples_user" ON "voice_samples" USING btree ("user_id");