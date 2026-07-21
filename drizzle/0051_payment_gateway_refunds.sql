ALTER TYPE "public"."refund_method" ADD VALUE IF NOT EXISTS 'momo';--> statement-breakpoint
ALTER TYPE "public"."refund_method" ADD VALUE IF NOT EXISTS 'zalopay';--> statement-breakpoint
ALTER TYPE "public"."refund_method" ADD VALUE IF NOT EXISTS 'vnpay';--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "client_id" varchar(80);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "returns_client_id_idx" ON "returns" USING btree ("client_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"reference" varchar(100) NOT NULL,
	"client_request_id" varchar(80) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"provider_refund_transaction_id" text,
	"provider_status" text,
	"provider_error" text,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"last_provider_checked_at" timestamp with time zone,
	"provider_query_attempts" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_refunds_return_idx" ON "payment_refunds" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_refunds_client_request_idx" ON "payment_refunds" USING btree ("client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_refunds_provider_reference_idx" ON "payment_refunds" USING btree ("provider", "reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_refunds_provider_transaction_idx" ON "payment_refunds" USING btree ("provider", "provider_refund_transaction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_refunds_payment_idx" ON "payment_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_refunds_status_query_idx" ON "payment_refunds" USING btree ("status", "last_provider_checked_at");
