CREATE TABLE IF NOT EXISTS "sepay_payment_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE set null,
  "bank_account_id" uuid NOT NULL REFERENCES "payment_bank_accounts"("id") ON DELETE restrict,
  "status" text NOT NULL DEFAULT 'pending',
  "amount" numeric(14, 2) NOT NULL,
  "reference" text NOT NULL,
  "client_request_id" varchar(80),
  "provider_transaction_id" text,
  "raw_matched_event_id" uuid,
  "confirmed_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "note" text,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sepay_payment_sessions_store_client_unique"
  ON "sepay_payment_sessions" USING btree ("store_id", "client_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sepay_payment_sessions_store_reference_unique"
  ON "sepay_payment_sessions" USING btree ("store_id", "reference");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sepay_payment_sessions_status_idx"
  ON "sepay_payment_sessions" USING btree ("status", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sepay_payment_sessions_bank_account_idx"
  ON "sepay_payment_sessions" USING btree ("bank_account_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sepay_payment_sessions_order_idx"
  ON "sepay_payment_sessions" USING btree ("order_id");
