ALTER TYPE "public"."measurement_source" ADD VALUE 'map_draw';--> statement-breakpoint
ALTER TABLE "measurement" ADD COLUMN "service_areas" jsonb;--> statement-breakpoint
ALTER TABLE "measurement" ADD COLUMN "map_view" jsonb;