CREATE TYPE "public"."buyer_outreach_status" AS ENUM('queued', 'sent', 'skipped');--> statement-breakpoint
CREATE TABLE "buyer_outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"company_key" text NOT NULL,
	"company_name" text NOT NULL,
	"website" text,
	"email" text,
	"phone" text,
	"contact_form_url" text,
	"office_city" text,
	"office_lat" double precision,
	"office_lng" double precision,
	"distance_mi" double precision,
	"commercial_signal" boolean,
	"claim_url" text,
	"message" text,
	"status" "buyer_outreach_status" DEFAULT 'queued' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buyer_outreach" ADD CONSTRAINT "buyer_outreach_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE set null ON UPDATE no action;