CREATE TYPE "public"."confidence" AS ENUM('High', 'Med', 'Low');--> statement-breakpoint
CREATE TYPE "public"."contact_source" AS ENUM('apollo', 'manual');--> statement-breakpoint
CREATE TYPE "public"."icp_type" AS ENUM('self_storage', 'office_park', 'medical', 'church', 'daycare', 'retail_strip', 'industrial', 'other');--> statement-breakpoint
CREATE TYPE "public"."measurement_source" AS ENUM('manual', 'siterecon');--> statement-breakpoint
CREATE TYPE "public"."outreach_status" AS ENUM('draft', 'approved', 'sent', 'replied', 'bounced', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."property_source" AS ENUM('manual', 'places');--> statement-breakpoint
CREATE TYPE "public"."property_status" AS ENUM('sourced', 'priced', 'contacts_enriched', 'proposal_ready', 'outreach_drafted', 'sent', 'replied', 'walkthrough_booked', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'sent', 'viewed');--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"zip" text,
	"phone" text,
	"email" text,
	"logo_url" text,
	"brand_color" text,
	"gl_insurance_amount" integer,
	"coi_available" boolean DEFAULT false NOT NULL,
	"booking_url" text,
	"physical_mailing_address" text,
	"service_area_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"apollo_id" text,
	"priority_rank" integer,
	"source" "contact_source" DEFAULT 'apollo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"turf_sqft" double precision NOT NULL,
	"bed_sqft" double precision NOT NULL,
	"shrub_count" integer,
	"tree_count" integer,
	"edging_lf" double precision,
	"complexity" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"confidence" "confidence" DEFAULT 'Med' NOT NULL,
	"source" "measurement_source" DEFAULT 'manual' NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"proposal_id" uuid,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "outreach_status" DEFAULT 'draft' NOT NULL,
	"resend_message_id" text,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"crew_size" integer NOT NULL,
	"labor_cost_per_person_hour" double precision NOT NULL,
	"equipment_cost_per_crew_hour" double precision NOT NULL,
	"turf_min_per_acre" double precision NOT NULL,
	"bed_min_per_1000sqft" double precision NOT NULL,
	"fixed_min_per_stop" double precision NOT NULL,
	"drive_min_per_stop" double precision NOT NULL,
	"target_margin" double precision NOT NULL,
	"margin_floor" double precision NOT NULL,
	"min_price_per_visit" double precision NOT NULL,
	"visits_per_year" integer NOT NULL,
	"cole_profit_share" double precision NOT NULL,
	"max_turf_acres" double precision NOT NULL,
	"bed_turf_ratio_threshold" double precision NOT NULL,
	"monthly_review_threshold" double precision NOT NULL,
	"market_floor_per_acre_visit" double precision NOT NULL,
	"market_ceiling_per_acre_visit" double precision NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"measurement_id" uuid NOT NULL,
	"config_id" uuid NOT NULL,
	"cost_per_visit" double precision NOT NULL,
	"price_per_visit" double precision NOT NULL,
	"gross_profit_per_visit" double precision NOT NULL,
	"gross_margin_pct" double precision NOT NULL,
	"min_acceptable_price" double precision NOT NULL,
	"monthly_price" double precision NOT NULL,
	"annual_price" double precision NOT NULL,
	"annual_gross_profit" double precision NOT NULL,
	"cole_annual_cut" double precision NOT NULL,
	"implied_per_acre_visit" double precision,
	"crew_hours_per_visit" double precision NOT NULL,
	"flags" jsonb NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"zip" text,
	"lat" double precision,
	"lng" double precision,
	"icp_type" "icp_type" DEFAULT 'other' NOT NULL,
	"owner_org" text,
	"source" "property_source" DEFAULT 'manual' NOT NULL,
	"status" "property_status" DEFAULT 'sourced' NOT NULL,
	"acknowledged_review" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"pricing_result_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"frequency_options" jsonb NOT NULL,
	"scope_items" jsonb NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_config" ADD CONSTRAINT "pricing_config_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_result" ADD CONSTRAINT "pricing_result_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_result" ADD CONSTRAINT "pricing_result_measurement_id_measurement_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."measurement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_result" ADD CONSTRAINT "pricing_result_config_id_pricing_config_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."pricing_config"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_pricing_result_id_pricing_result_id_fk" FOREIGN KEY ("pricing_result_id") REFERENCES "public"."pricing_result"("id") ON DELETE no action ON UPDATE no action;