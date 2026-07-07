CREATE TABLE "outreach_campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"stage" text DEFAULT 'properties' NOT NULL,
	"property_ids" jsonb DEFAULT '[]'::jsonb,
	"price_cents" integer DEFAULT 7900 NOT NULL,
	"exclusive_price_cents" integer DEFAULT 19900 NOT NULL,
	"auto_advance" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"email" text,
	"website" text,
	"contact_form_url" text,
	"city" text,
	"lat" double precision,
	"lng" double precision,
	"property_id" uuid,
	"distance_mi" double precision,
	"subject" text,
	"body" text,
	"claim_token" text,
	"included" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_recipient" ADD CONSTRAINT "outreach_recipient_campaign_id_outreach_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_recipient" ADD CONSTRAINT "outreach_recipient_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;