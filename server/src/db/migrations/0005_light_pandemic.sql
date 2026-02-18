CREATE TABLE "user_noise_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_noise_user_email" ON "user_noise_list" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "idx_user_noise_user" ON "user_noise_list" USING btree ("user_id");