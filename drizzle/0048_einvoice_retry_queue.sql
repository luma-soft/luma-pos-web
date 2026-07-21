ALTER TYPE "public"."einvoice_status" ADD VALUE IF NOT EXISTS 'queued';--> statement-breakpoint
ALTER TYPE "public"."einvoice_status" ADD VALUE IF NOT EXISTS 'processing';--> statement-breakpoint
ALTER TABLE "einvoices" ALTER COLUMN "serial" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "einvoices" ALTER COLUMN "serial" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "provider_reference" text;--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "lock_token" varchar(80);--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "einvoices" SET "serial" = NULL WHERE "status" <> 'issued' AND "number" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "einvoices_retry_idx" ON "einvoices" USING btree ("status", "next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "einvoices_lock_idx" ON "einvoices" USING btree ("locked_at");
