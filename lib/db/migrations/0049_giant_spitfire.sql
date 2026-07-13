ALTER TABLE "buyer" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buyer" ADD COLUMN "banned_reason" text;