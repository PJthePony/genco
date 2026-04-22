CREATE TABLE "voice_bucket_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"contact_email" text NOT NULL,
	"voice_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_bucket_assignments" ADD CONSTRAINT "voice_bucket_assignments_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_voice_assignments_user_email" ON "voice_bucket_assignments" USING btree ("user_id","contact_email");--> statement-breakpoint
CREATE INDEX "idx_voice_assignments_profile" ON "voice_bucket_assignments" USING btree ("voice_profile_id");