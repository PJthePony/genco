CREATE TABLE "contact_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_contact_id" uuid NOT NULL,
	"fact" text NOT NULL,
	"date_relevant" timestamp with time zone,
	"source_subject" text,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expired" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_contact_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"surfaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"suggested_action" text,
	"ai_draft" text,
	"context_snapshot" text
);
--> statement-breakpoint
CREATE TABLE "network_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"company" text,
	"title" text,
	"last_contact_at" timestamp with time zone,
	"last_direction" text,
	"thread_status" text,
	"gmail_thread_id" text,
	"last_subject" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "contact_context" ADD CONSTRAINT "contact_context_network_contact_id_network_contacts_id_fk" FOREIGN KEY ("network_contact_id") REFERENCES "public"."network_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_queue" ADD CONSTRAINT "follow_up_queue_network_contact_id_network_contacts_id_fk" FOREIGN KEY ("network_contact_id") REFERENCES "public"."network_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contact_context_contact" ON "contact_context" USING btree ("network_contact_id");--> statement-breakpoint
CREATE INDEX "idx_contact_context_date" ON "contact_context" USING btree ("date_relevant");--> statement-breakpoint
CREATE INDEX "idx_follow_up_queue_contact" ON "follow_up_queue" USING btree ("network_contact_id");--> statement-breakpoint
CREATE INDEX "idx_follow_up_queue_status" ON "follow_up_queue" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_network_contacts_user_email" ON "network_contacts" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "idx_network_contacts_user" ON "network_contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_network_contacts_thread_status" ON "network_contacts" USING btree ("user_id","thread_status");