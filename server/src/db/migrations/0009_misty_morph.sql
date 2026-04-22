CREATE TABLE "voice_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"formality_score" text,
	"greeting_habits" text,
	"sign_off_habits" text,
	"sentence_style" text,
	"sample_phrases" jsonb DEFAULT '[]' NOT NULL,
	"sample_recipients" jsonb DEFAULT '[]' NOT NULL,
	"match_signals" jsonb DEFAULT '{}' NOT NULL,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_voice_profiles_user" ON "voice_profiles" USING btree ("user_id");