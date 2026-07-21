ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "vat_rate" decimal(5,2),
  ADD COLUMN IF NOT EXISTS "price_by_weight" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "track_batches" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "shelf_life_days" integer,
  ADD COLUMN IF NOT EXISTS "lifecycle_status" varchar(20) DEFAULT 'active' NOT NULL;

CREATE INDEX IF NOT EXISTS "products_lifecycle_status_idx"
  ON "products" ("lifecycle_status");

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_lifecycle_status_check";
ALTER TABLE "products"
  ADD CONSTRAINT "products_lifecycle_status_check"
  CHECK ("lifecycle_status" IN ('draft', 'active', 'archived'));

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_vat_rate_check";
ALTER TABLE "products"
  ADD CONSTRAINT "products_vat_rate_check"
  CHECK ("vat_rate" >= 0 AND "vat_rate" <= 100);

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_shelf_life_days_check";
ALTER TABLE "products"
  ADD CONSTRAINT "products_shelf_life_days_check"
  CHECK ("shelf_life_days" IS NULL OR "shelf_life_days" > 0);
