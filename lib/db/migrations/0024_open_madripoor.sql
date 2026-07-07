CREATE TABLE "postcard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unlock_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"lob_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"stripe_session_id" text,
	"to_name" text,
	"to_address" text,
	"expected_delivery" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postcard_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
ALTER TABLE "buyer" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "postcard" ADD CONSTRAINT "postcard_unlock_id_lead_unlock_id_fk" FOREIGN KEY ("unlock_id") REFERENCES "public"."lead_unlock"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcard" ADD CONSTRAINT "postcard_buyer_id_buyer_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyer"("id") ON DELETE no action ON UPDATE no action;