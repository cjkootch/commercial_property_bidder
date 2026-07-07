CREATE TABLE "lead_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unlock_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_unlock" ADD COLUMN "outreach_status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_unlock_id_lead_unlock_id_fk" FOREIGN KEY ("unlock_id") REFERENCES "public"."lead_unlock"("id") ON DELETE cascade ON UPDATE no action;