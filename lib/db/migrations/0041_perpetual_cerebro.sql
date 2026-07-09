ALTER TABLE "prospect_company" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospect_company" ADD COLUMN "blocked_reason" text;