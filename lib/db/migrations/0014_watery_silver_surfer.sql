ALTER TABLE "company" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_slug_unique" UNIQUE("slug");