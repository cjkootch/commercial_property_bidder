ALTER TABLE "lead_unlock" DROP CONSTRAINT "lead_unlock_property_buyer";--> statement-breakpoint
CREATE INDEX "lead_activity_unlock_idx" ON "lead_activity" USING btree ("unlock_id");--> statement-breakpoint
CREATE INDEX "lead_unlock_buyer_idx" ON "lead_unlock" USING btree ("buyer_id");--> statement-breakpoint
ALTER TABLE "lead_unlock" ADD CONSTRAINT "lead_unlock_property_buyer_trade_cycle" UNIQUE("property_id","buyer_id","trade","cycle");