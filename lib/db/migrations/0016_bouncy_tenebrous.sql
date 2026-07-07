CREATE TABLE "buyer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"email" text NOT NULL,
	"city" text,
	"lat" double precision,
	"lng" double precision,
	"notify" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "lead_unlock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" text DEFAULT 'free' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"stripe_session_id" text,
	"dossier" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_unlock_property_id_unique" UNIQUE("property_id")
);
--> statement-breakpoint
ALTER TABLE "lead_unlock" ADD CONSTRAINT "lead_unlock_buyer_id_buyer_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_unlock" ADD CONSTRAINT "lead_unlock_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;