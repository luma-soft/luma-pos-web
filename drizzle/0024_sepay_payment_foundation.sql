CREATE TABLE IF NOT EXISTS "payment_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'sepay' NOT NULL,
	"bank_code" varchar(40) NOT NULL,
	"gateway" varchar(80),
	"account_number" varchar(80) NOT NULL,
	"sub_account" varchar(80),
	"account_name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"webhook_enabled" boolean DEFAULT true NOT NULL,
	"webhook_secret" text,
	"api_key" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_bank_accounts" ADD CONSTRAINT "payment_bank_accounts_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_bank_accounts_provider_idx" ON "payment_bank_accounts" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_bank_accounts_enabled_idx" ON "payment_bank_accounts" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_bank_accounts_provider_account_idx" ON "payment_bank_accounts" USING btree ("provider","account_number","sub_account");--> statement-breakpoint

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'manual_confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider_transaction_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "gateway" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "account_number" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "raw_matched_event_id" uuid;--> statement-breakpoint
UPDATE "payments" SET "status" = 'manual_confirmed' WHERE "status" IS NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_id_payment_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."payment_bank_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_provider_reference_idx" ON "payments" USING btree ("provider","reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_bank_account_idx" ON "payments" USING btree ("bank_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_transaction_idx" ON "payments" USING btree ("provider","provider_transaction_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'sepay' NOT NULL,
	"provider_event_id" text NOT NULL,
	"bank_account_id" uuid,
	"matched_payment_id" uuid,
	"reference_code" text,
	"account_number" text,
	"sub_account" text,
	"gateway" text,
	"transfer_type" text,
	"transfer_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"transaction_date" timestamp with time zone,
	"content" text,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"match_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_bank_account_id_payment_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."payment_bank_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_matched_payment_id_payments_id_fk" FOREIGN KEY ("matched_payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_webhook_events_provider_event_idx" ON "payment_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_webhook_events_match_idx" ON "payment_webhook_events" USING btree ("match_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_webhook_events_payment_idx" ON "payment_webhook_events" USING btree ("matched_payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_webhook_events_account_idx" ON "payment_webhook_events" USING btree ("account_number","sub_account");
