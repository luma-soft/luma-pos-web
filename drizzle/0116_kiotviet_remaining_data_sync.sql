ALTER TABLE "suppliers"
  ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "returns"
  ADD COLUMN "refund_amount" numeric(14, 2),
  ADD COLUMN "settlement_status" text,
  ADD COLUMN "source_invoice_code" varchar(30),
  ADD COLUMN "source_subtotal" numeric(14, 2),
  ADD COLUMN "source_discount" numeric(14, 2),
  ADD COLUMN "source_tax" numeric(14, 2),
  ADD COLUMN "source_other_refund" numeric(14, 2),
  ADD COLUMN "source_return_fee" numeric(14, 2),
  ADD COLUMN "source_payment_snapshots" jsonb;
--> statement-breakpoint
ALTER TABLE "returns"
  ADD CONSTRAINT "returns_refund_amount_check"
  CHECK ("refund_amount" IS NULL OR "refund_amount" >= 0),
  ADD CONSTRAINT "returns_settlement_status_check"
  CHECK ("settlement_status" IS NULL OR "settlement_status" IN ('unsettled', 'partial', 'settled'));
--> statement-breakpoint
ALTER TABLE "purchase_order_items"
  ADD COLUMN "product_name" text,
  ADD COLUMN "sku" varchar(50),
  ADD COLUMN "unit_name" varchar(30),
  ADD COLUMN "unit_multiplier" numeric(14, 4) DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_items"
  ADD COLUMN "source_sku" varchar(50);
--> statement-breakpoint
ALTER TABLE "return_items"
  ADD COLUMN "source_sku" varchar(50);
--> statement-breakpoint
ALTER TABLE "purchase_return_items"
  ADD COLUMN "unit_multiplier" numeric(14, 4) DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE "kiotviet_sync_runs" (
  "store_id" uuid NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" varchar(30) DEFAULT 'kiotviet' NOT NULL,
  "phase" varchar(30) NOT NULL,
  "source_file_name" text NOT NULL,
  "source_sha256" varchar(64) NOT NULL,
  "bundle_sha256" varchar(64),
  "source_rows" integer DEFAULT 0 NOT NULL,
  "source_documents" integer DEFAULT 0 NOT NULL,
  "status" varchar(20) DEFAULT 'running' NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_details" jsonb,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  CONSTRAINT "kiotviet_sync_runs_store_id_id_unique" UNIQUE ("store_id", "id"),
  CONSTRAINT "kiotviet_sync_runs_source_sha256_check" CHECK ("source_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "kiotviet_sync_runs_counts_check" CHECK ("source_rows" >= 0 AND "source_documents" >= 0),
  CONSTRAINT "kiotviet_sync_runs_status_check" CHECK ("status" IN ('running', 'completed', 'failed', 'rolled_back'))
);
--> statement-breakpoint
ALTER TABLE "kiotviet_sync_runs"
  ADD CONSTRAINT "kiotviet_sync_runs_store_id_stores_id_fk"
  FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "kiotviet_sync_runs_store_status_idx"
  ON "kiotviet_sync_runs" USING btree ("store_id", "status", "started_at");
--> statement-breakpoint
CREATE TABLE "kiotviet_source_mappings" (
  "store_id" uuid NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" varchar(30) DEFAULT 'kiotviet' NOT NULL,
  "entity_type" varchar(40) NOT NULL,
  "external_id" varchar(160) NOT NULL,
  "local_id" uuid NOT NULL,
  "source_sha256" varchar(64) NOT NULL,
  "adoption_method" varchar(24) NOT NULL,
  "last_seen_run_id" uuid NOT NULL,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "kiotviet_source_mappings_source_sha256_check" CHECK ("source_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "kiotviet_source_mappings_adoption_method_check" CHECK ("adoption_method" IN ('mapped', 'created', 'legacy_adopted')),
  CONSTRAINT "kiotviet_source_mappings_entity_type_check" CHECK ("entity_type" IN ('customer', 'supplier', 'booking', 'booking_line', 'booking_payment', 'sale', 'sale_line', 'sale_payment', 'purchase', 'purchase_line', 'customer_return', 'customer_return_line', 'supplier_return', 'supplier_return_line'))
);
--> statement-breakpoint
ALTER TABLE "kiotviet_source_mappings"
  ADD CONSTRAINT "kiotviet_source_mappings_store_id_stores_id_fk"
  FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kiotviet_source_mappings"
  ADD CONSTRAINT "kiotviet_source_mappings_run_tenant_fk"
  FOREIGN KEY ("store_id", "last_seen_run_id")
  REFERENCES "public"."kiotviet_sync_runs"("store_id", "id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "kiotviet_source_mappings_store_external_idx"
  ON "kiotviet_source_mappings" USING btree ("store_id", "provider", "entity_type", "external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "kiotviet_source_mappings_store_local_idx"
  ON "kiotviet_source_mappings" USING btree ("store_id", "provider", "entity_type", "local_id");
--> statement-breakpoint
CREATE INDEX "kiotviet_source_mappings_store_run_idx"
  ON "kiotviet_source_mappings" USING btree ("store_id", "last_seen_run_id");
--> statement-breakpoint
ALTER TABLE "kiotviet_sync_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "kiotviet_source_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "kiotviet_sync_runs" FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "kiotviet_sync_runs" FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE "kiotviet_source_mappings" FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "kiotviet_source_mappings" FROM authenticated;
