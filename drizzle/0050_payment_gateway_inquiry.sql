ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "last_provider_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider_query_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_provider_query_idx" ON "payments" USING btree ("provider", "status", "last_provider_checked_at");
