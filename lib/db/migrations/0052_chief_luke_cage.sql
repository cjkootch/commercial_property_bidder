CREATE TABLE "claim_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" text,
	"property_id" uuid,
	"trade" text,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "claim_event_created_idx" ON "claim_event" USING btree ("created_at");