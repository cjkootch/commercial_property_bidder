ALTER TABLE "email_send" ADD COLUMN "direction" text DEFAULT 'out' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_send" ADD COLUMN "company_key" text;--> statement-breakpoint
ALTER TABLE "email_send" ADD COLUMN "from_email" text;--> statement-breakpoint
ALTER TABLE "email_send" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "email_send" ADD COLUMN "verified" boolean;