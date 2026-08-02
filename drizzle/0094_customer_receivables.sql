DO $$ BEGIN
  CREATE TYPE "customer_receivable_receipt_status" AS ENUM ('confirmed', 'pending_qr', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "customer_receivable_entry_type" AS ENUM ('adjustment_debit', 'adjustment_credit', 'settlement_discount');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_receivable_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(40) NOT NULL,
  "customer_id" uuid NOT NULL,
  "status" "customer_receivable_receipt_status" DEFAULT 'confirmed' NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "method" "payment_method" NOT NULL,
  "reference" text,
  "note" text,
  "client_request_id" varchar(80) NOT NULL,
  "created_by" uuid,
  "confirmed_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_receivable_receipts_code_unique" UNIQUE("code"),
  CONSTRAINT "customer_receivable_receipts_client_request_id_unique" UNIQUE("client_request_id"),
  CONSTRAINT "customer_receivable_receipts_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "customer_receivable_receipts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
  CONSTRAINT "customer_receivable_receipts_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "profiles"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_receivable_receipts_customer_idx" ON "customer_receivable_receipts" USING btree ("customer_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_receivable_receipts_status_idx" ON "customer_receivable_receipts" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_receivable_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "receipt_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "payment_id" uuid,
  "amount" numeric(14, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_receivable_allocations_receipt_order_idx" UNIQUE("receipt_id", "order_id"),
  CONSTRAINT "customer_receivable_allocations_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "customer_receivable_allocations_receipt_id_customer_receivable_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "customer_receivable_receipts"("id") ON DELETE cascade,
  CONSTRAINT "customer_receivable_allocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
  CONSTRAINT "customer_receivable_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_receivable_allocations_order_idx" ON "customer_receivable_allocations" USING btree ("order_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_receivable_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(40) NOT NULL,
  "customer_id" uuid NOT NULL,
  "order_id" uuid,
  "type" "customer_receivable_entry_type" NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "reason" text NOT NULL,
  "reference" text,
  "note" text,
  "client_request_id" varchar(80) NOT NULL,
  "created_by" uuid,
  "approved_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_receivable_entries_code_unique" UNIQUE("code"),
  CONSTRAINT "customer_receivable_entries_client_request_id_unique" UNIQUE("client_request_id"),
  CONSTRAINT "customer_receivable_entries_amount_nonzero" CHECK ("amount" <> 0),
  CONSTRAINT "customer_receivable_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
  CONSTRAINT "customer_receivable_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
  CONSTRAINT "customer_receivable_entries_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "profiles"("id"),
  CONSTRAINT "customer_receivable_entries_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "profiles"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_receivable_entries_customer_idx" ON "customer_receivable_entries" USING btree ("customer_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_receivable_entries_order_idx" ON "customer_receivable_entries" USING btree ("order_id");
