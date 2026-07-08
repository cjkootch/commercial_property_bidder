CREATE TYPE "public"."mail_campaign_status" AS ENUM('draft', 'proof_ready', 'approved', 'lob_test_ready', 'submitted', 'in_production', 'mailed', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."mail_format" AS ENUM('postcard_6x9', 'postcard_6x11', 'letter');--> statement-breakpoint
CREATE TYPE "public"."mail_provider" AS ENUM('lob', 'manual');--> statement-breakpoint
CREATE TYPE "public"."mail_recipient_status" AS ENUM('pending', 'validated', 'invalid_address', 'test_submitted', 'submitted', 'mailed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."residential_lead_status" AS ENUM('sourced', 'qualified', 'packaged', 'unlocked', 'archived');--> statement-breakpoint
CREATE TYPE "public"."residential_package_status" AS ENUM('draft', 'published', 'sold_out', 'archived');--> statement-breakpoint
CREATE TYPE "public"."residential_signal_type" AS ENUM('recently_sold', 'new_construction', 'permit_completed', 'certificate_of_occupancy', 'newly_listed', 'stale_listing', 'price_reduction', 'withdrawn_listing', 'subdivision_phase', 'manual');--> statement-breakpoint
CREATE TYPE "public"."residential_source" AS ENUM('manual', 'public_permit', 'public_deed', 'builder_site', 'partner_feed', 'import_csv');--> statement-breakpoint
CREATE TABLE "residential_lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"lat" double precision,
	"lng" double precision,
	"subdivision_name" text,
	"builder_name" text,
	"signal_type" "residential_signal_type" NOT NULL,
	"signal_date" timestamp with time zone,
	"source" "residential_source" DEFAULT 'manual' NOT NULL,
	"estimated_home_value" integer,
	"lot_size_sqft" double precision,
	"year_built" integer,
	"confidence" "confidence" DEFAULT 'Med' NOT NULL,
	"status" "residential_lead_status" DEFAULT 'sourced' NOT NULL,
	"notes" text,
	"raw_source" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "residential_mail_campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"buyer_id" uuid,
	"residential_package_id" uuid NOT NULL,
	"provider" "mail_provider" DEFAULT 'lob' NOT NULL,
	"mail_format" "mail_format" NOT NULL,
	"status" "mail_campaign_status" DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"offer_headline" text,
	"proof_front_html" text,
	"proof_back_html" text,
	"proof_front_copy" text,
	"proof_back_copy" text,
	"mailpiece_count" integer DEFAULT 0 NOT NULL,
	"estimated_print_postage_cost_cents" integer,
	"client_price_cents" integer,
	"lob_campaign_id" text,
	"lob_metadata" jsonb,
	"tracking_summary" jsonb,
	"approved_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"mailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "residential_mail_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"residential_mail_campaign_id" uuid NOT NULL,
	"residential_lead_id" uuid NOT NULL,
	"address" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"recipient_name" text,
	"lob_address_id" text,
	"lob_postcard_id" text,
	"lob_letter_id" text,
	"status" "mail_recipient_status" DEFAULT 'pending' NOT NULL,
	"lob_status" text,
	"mailed_at" timestamp with time zone,
	"raw_lob_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "res_mail_campaign_lead" UNIQUE("residential_mail_campaign_id","residential_lead_id")
);
--> statement-breakpoint
CREATE TABLE "residential_package" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"geography_label" text,
	"zip" text,
	"lead_count" integer DEFAULT 0 NOT NULL,
	"signal_summary" jsonb,
	"exclusive_until" timestamp with time zone,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"status" "residential_package_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "residential_package_membership" (
	"package_id" uuid NOT NULL,
	"residential_lead_id" uuid NOT NULL,
	CONSTRAINT "residential_package_membership_package_id_residential_lead_id_pk" PRIMARY KEY("package_id","residential_lead_id")
);
--> statement-breakpoint
CREATE TABLE "residential_unlock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"residential_package_id" uuid NOT NULL,
	"kind" text DEFAULT 'paid' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"stripe_session_id" text,
	"dossier" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "residential_unlock_buyer_package" UNIQUE("buyer_id","residential_package_id")
);
--> statement-breakpoint
ALTER TABLE "residential_lead" ADD CONSTRAINT "residential_lead_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residential_mail_campaign" ADD CONSTRAINT "residential_mail_campaign_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residential_mail_campaign" ADD CONSTRAINT "residential_mail_campaign_buyer_id_buyer_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residential_mail_campaign" ADD CONSTRAINT "residential_mail_campaign_residential_package_id_residential_package_id_fk" FOREIGN KEY ("residential_package_id") REFERENCES "public"."residential_package"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residential_mail_recipient" ADD CONSTRAINT "residential_mail_recipient_residential_mail_campaign_id_residential_mail_campaign_id_fk" FOREIGN KEY ("residential_mail_campaign_id") REFERENCES "public"."residential_mail_campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residential_mail_recipient" ADD CONSTRAINT "residential_mail_recipient_residential_lead_id_residential_lead_id_fk" FOREIGN KEY ("residential_lead_id") REFERENCES "public"."residential_lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residential_package" ADD CONSTRAINT "residential_package_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residential_package_membership" ADD CONSTRAINT "residential_package_membership_package_id_residential_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."residential_package"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residential_package_membership" ADD CONSTRAINT "residential_package_membership_residential_lead_id_residential_lead_id_fk" FOREIGN KEY ("residential_lead_id") REFERENCES "public"."residential_lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residential_unlock" ADD CONSTRAINT "residential_unlock_buyer_id_buyer_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residential_unlock" ADD CONSTRAINT "residential_unlock_residential_package_id_residential_package_id_fk" FOREIGN KEY ("residential_package_id") REFERENCES "public"."residential_package"("id") ON DELETE no action ON UPDATE no action;