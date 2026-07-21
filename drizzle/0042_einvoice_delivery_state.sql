ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "buyer_address" text;
--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "buyer_email" text;
--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "provider" varchar(40);
--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "request_id" varchar(80);
--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "einvoices" ADD COLUMN IF NOT EXISTS "last_error" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "einvoices_request_id_unique" ON "einvoices" USING btree ("request_id");
