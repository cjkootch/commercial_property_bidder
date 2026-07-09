CREATE TABLE "prospect_company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"trade" text DEFAULT 'landscaping' NOT NULL,
	"website" text,
	"email" text,
	"phone" text,
	"contact_form_url" text,
	"office_city" text,
	"office_lat" double precision,
	"office_lng" double precision,
	"commercial_signal" boolean,
	"claim_views" integer DEFAULT 0 NOT NULL,
	"last_claim_view_at" timestamp with time zone,
	"buyer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_company_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "prospect_company" ADD CONSTRAINT "prospect_company_buyer_id_buyer_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyer"("id") ON DELETE set null ON UPDATE no action;