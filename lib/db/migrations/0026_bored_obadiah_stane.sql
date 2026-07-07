CREATE TYPE "public"."prospect_status" AS ENUM('added', 'scanned', 'mailed', 'viewed', 'archived');--> statement-breakpoint
CREATE TABLE "prospect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"name" text,
	"address" text NOT NULL,
	"city" text,
	"zip" text,
	"lat" double precision,
	"lng" double precision,
	"status" "prospect_status" DEFAULT 'added' NOT NULL,
	"parcel_geojson" jsonb,
	"service_areas" jsonb,
	"map_view" jsonb,
	"aerial" jsonb,
	"turf_sqft" double precision,
	"bed_sqft" double precision,
	"complexity" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"confidence" "confidence" DEFAULT 'Med' NOT NULL,
	"price_per_visit" double precision,
	"monthly_price" double precision,
	"annual_price" double precision,
	"estimate_lo" double precision,
	"estimate_hi" double precision,
	"price_override_cents" integer,
	"proposal_slug" text NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_proposal_slug_unique" UNIQUE("proposal_slug")
);
--> statement-breakpoint
CREATE TABLE "prospect_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"user_agent" text,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "postcard" ALTER COLUMN "unlock_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "postcard" ADD COLUMN "prospect_id" uuid;--> statement-breakpoint
ALTER TABLE "prospect" ADD CONSTRAINT "prospect_buyer_id_buyer_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_view" ADD CONSTRAINT "prospect_view_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcard" ADD CONSTRAINT "postcard_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcard" ADD CONSTRAINT "postcard_target_xor" CHECK (("postcard"."unlock_id" IS NOT NULL) <> ("postcard"."prospect_id" IS NOT NULL));