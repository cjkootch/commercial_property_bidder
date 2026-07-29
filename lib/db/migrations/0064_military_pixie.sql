CREATE TABLE "prospect_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_company_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"notes" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospect_contact" ADD CONSTRAINT "prospect_contact_prospect_company_id_prospect_company_id_fk" FOREIGN KEY ("prospect_company_id") REFERENCES "public"."prospect_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospect_contact_company_idx" ON "prospect_contact" USING btree ("prospect_company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_contact_company_email_uniq" ON "prospect_contact" USING btree ("prospect_company_id","email") WHERE email is not null;