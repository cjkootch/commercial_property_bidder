ALTER TABLE "buyer" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "buyer" ADD COLUMN "service_radius_mi" integer DEFAULT 25 NOT NULL;