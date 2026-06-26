ALTER TYPE "public"."proposal_status" ADD VALUE 'accepted';--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "walkthrough_requested_at" timestamp with time zone;