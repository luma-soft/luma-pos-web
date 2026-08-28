ALTER TABLE "installed_assets"
  ADD COLUMN "client_request_id" varchar(200);
--> statement-breakpoint
DROP INDEX IF EXISTS "installed_assets_serial_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "installed_assets_store_serial_idx"
  ON "installed_assets" ("store_id", "serial_number")
  WHERE "serial_number" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "installed_assets_store_request_idx"
  ON "installed_assets" ("store_id", "client_request_id")
  WHERE "client_request_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "installed_assets_product_idx"
  ON "installed_assets" ("product_id")
  WHERE "product_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_attachments"
  ADD COLUMN "client_request_id" varchar(200),
  ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_attachments"
  DROP CONSTRAINT IF EXISTS "service_attachments_category_check";
--> statement-breakpoint
ALTER TABLE "service_attachments"
  ADD CONSTRAINT "service_attachments_category_check"
    CHECK ("category" IN ('before', 'after', 'issue', 'document', 'signature', 'asset')),
  ADD CONSTRAINT "service_attachments_sort_order_check"
    CHECK ("sort_order" >= 0),
  ADD CONSTRAINT "service_attachments_primary_asset_check"
    CHECK (NOT "is_primary" OR ("asset_id" IS NOT NULL AND "category" = 'asset'));
--> statement-breakpoint
CREATE INDEX "service_attachments_asset_idx"
  ON "service_attachments" ("asset_id", "sort_order", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "service_attachments_asset_request_idx"
  ON "service_attachments" ("store_id", "asset_id", "client_request_id")
  WHERE "asset_id" IS NOT NULL AND "client_request_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "service_attachments_asset_primary_idx"
  ON "service_attachments" ("asset_id")
  WHERE "asset_id" IS NOT NULL AND "is_primary" AND "deleted_at" IS NULL;
