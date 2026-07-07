ALTER TABLE "lead_unlock" DROP CONSTRAINT "lead_unlock_property_id_unique";--> statement-breakpoint
ALTER TABLE "buyer" ADD COLUMN "credit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_unlock" ADD CONSTRAINT "lead_unlock_property_buyer" UNIQUE("property_id","buyer_id");