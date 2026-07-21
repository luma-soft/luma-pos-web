ALTER TYPE "payment_method" ADD VALUE IF NOT EXISTS 'exchange_credit';
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "exchange_order_id" uuid;
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "exchange_difference" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "exchange_settlement_method" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "returns" ADD CONSTRAINT "returns_exchange_order_id_orders_id_fk" FOREIGN KEY ("exchange_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "returns_exchange_order_idx" ON "returns" USING btree ("exchange_order_id");
