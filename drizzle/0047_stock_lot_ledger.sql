ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "batch_number" varchar(80),
  ADD COLUMN IF NOT EXISTS "expiry_date" date;

CREATE TABLE IF NOT EXISTS "stock_lots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "purchase_order_item_id" uuid REFERENCES "purchase_order_items"("id") ON DELETE SET NULL,
  "batch_number" varchar(80) NOT NULL,
  "expiry_date" date,
  "received_quantity" decimal(14,4) NOT NULL,
  "available_quantity" decimal(14,4) NOT NULL,
  "unit_cost" decimal(14,2),
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "profiles"("id")
);

CREATE INDEX IF NOT EXISTS "stock_lots_product_warehouse_idx"
  ON "stock_lots" ("product_id", "warehouse_id");
CREATE INDEX IF NOT EXISTS "stock_lots_expiry_idx"
  ON "stock_lots" ("expiry_date");
CREATE INDEX IF NOT EXISTS "stock_lots_purchase_item_idx"
  ON "stock_lots" ("purchase_order_item_id");

CREATE TABLE IF NOT EXISTS "stock_lot_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stock_lot_id" uuid NOT NULL REFERENCES "stock_lots"("id") ON DELETE CASCADE,
  "quantity" decimal(14,4) NOT NULL,
  "ref_type" text NOT NULL,
  "ref_id" uuid NOT NULL,
  "created_by" uuid REFERENCES "profiles"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "stock_lot_movements_lot_idx"
  ON "stock_lot_movements" ("stock_lot_id", "created_at");
CREATE INDEX IF NOT EXISTS "stock_lot_movements_ref_idx"
  ON "stock_lot_movements" ("ref_type", "ref_id");

ALTER TABLE "stock_lots"
  DROP CONSTRAINT IF EXISTS "stock_lots_quantities_check";
ALTER TABLE "stock_lots"
  ADD CONSTRAINT "stock_lots_quantities_check"
  CHECK (
    "received_quantity" > 0
    AND "available_quantity" >= 0
    AND "available_quantity" <= "received_quantity"
  );

-- Existing stock predates lot capture. Keep it usable and auditable as an
-- explicit legacy opening lot instead of silently inventing an expiry date.
INSERT INTO "stock_lots" (
  "product_id",
  "warehouse_id",
  "batch_number",
  "received_quantity",
  "available_quantity",
  "unit_cost"
)
SELECT
  sl."product_id",
  sl."warehouse_id",
  'LEGACY-' || left(sl."warehouse_id"::text, 8),
  sl."quantity",
  sl."quantity",
  p."cost_price"
FROM "stock_levels" sl
JOIN "products" p ON p."id" = sl."product_id"
WHERE p."track_batches" = true
  AND sl."quantity" > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "stock_lots" lot
    WHERE lot."product_id" = sl."product_id"
      AND lot."warehouse_id" = sl."warehouse_id"
  );

INSERT INTO "stock_lot_movements" (
  "stock_lot_id",
  "quantity",
  "ref_type",
  "ref_id"
)
SELECT
  lot."id",
  lot."received_quantity",
  'legacy_opening',
  lot."id"
FROM "stock_lots" lot
WHERE lot."batch_number" LIKE 'LEGACY-%'
  AND NOT EXISTS (
    SELECT 1 FROM "stock_lot_movements" movement
    WHERE movement."stock_lot_id" = lot."id"
  );
