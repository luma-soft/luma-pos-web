CREATE TYPE "public"."supplier_payable_receipt_status" AS ENUM('confirmed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."supplier_payable_entry_type" AS ENUM('adjustment_debit', 'adjustment_credit');
--> statement-breakpoint
CREATE TABLE "supplier_payable_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(40) NOT NULL,
  "supplier_id" uuid NOT NULL,
  "status" "supplier_payable_receipt_status" DEFAULT 'confirmed' NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "method" "payment_method" NOT NULL,
  "reference" text,
  "note" text,
  "client_request_id" varchar(80) NOT NULL,
  "created_by" uuid,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "supplier_payable_receipts_code_unique" UNIQUE("code"),
  CONSTRAINT "supplier_payable_receipts_client_request_id_unique" UNIQUE("client_request_id"),
  CONSTRAINT "supplier_payable_receipts_amount_check" CHECK ("supplier_payable_receipts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_payable_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "receipt_id" uuid NOT NULL,
  "purchase_order_id" uuid NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "supplier_payable_allocations_amount_check" CHECK ("supplier_payable_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_payable_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(40) NOT NULL,
  "supplier_id" uuid NOT NULL,
  "purchase_order_id" uuid,
  "type" "supplier_payable_entry_type" NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "reason" text NOT NULL,
  "reference" text,
  "note" text,
  "client_request_id" varchar(80) NOT NULL,
  "created_by" uuid,
  "approved_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "supplier_payable_entries_code_unique" UNIQUE("code"),
  CONSTRAINT "supplier_payable_entries_client_request_id_unique" UNIQUE("client_request_id"),
  CONSTRAINT "supplier_payable_entries_amount_check" CHECK ("supplier_payable_entries"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_payable_receipts" ADD CONSTRAINT "supplier_payable_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_payable_receipts" ADD CONSTRAINT "supplier_payable_receipts_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_payable_allocations" ADD CONSTRAINT "supplier_payable_allocations_receipt_id_supplier_payable_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."supplier_payable_receipts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_payable_allocations" ADD CONSTRAINT "supplier_payable_allocations_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_payable_entries" ADD CONSTRAINT "supplier_payable_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_payable_entries" ADD CONSTRAINT "supplier_payable_entries_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_payable_entries" ADD CONSTRAINT "supplier_payable_entries_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_payable_entries" ADD CONSTRAINT "supplier_payable_entries_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "supplier_payable_receipts_supplier_idx" ON "supplier_payable_receipts" USING btree ("supplier_id", "created_at");
--> statement-breakpoint
CREATE INDEX "supplier_payable_receipts_status_idx" ON "supplier_payable_receipts" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_payable_allocations_receipt_purchase_idx" ON "supplier_payable_allocations" USING btree ("receipt_id", "purchase_order_id");
--> statement-breakpoint
CREATE INDEX "supplier_payable_allocations_purchase_idx" ON "supplier_payable_allocations" USING btree ("purchase_order_id");
--> statement-breakpoint
CREATE INDEX "supplier_payable_entries_supplier_idx" ON "supplier_payable_entries" USING btree ("supplier_id", "created_at");
--> statement-breakpoint
CREATE INDEX "supplier_payable_entries_purchase_idx" ON "supplier_payable_entries" USING btree ("purchase_order_id");
