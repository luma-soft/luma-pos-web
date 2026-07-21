ALTER TYPE "public"."payment_method" ADD VALUE IF NOT EXISTS 'zalopay';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "client_request_id" varchar(80);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "checkout_url" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "deep_link" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "qr_payload" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "last_provider_status" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "last_provider_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_client_request_idx" ON "payments" USING btree ("provider", "client_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_provider_expiry_idx" ON "payments" USING btree ("provider", "status", "expires_at");
