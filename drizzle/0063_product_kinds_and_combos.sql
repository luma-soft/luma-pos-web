DO $$ BEGIN
  CREATE TYPE "product_kind" AS ENUM ('product', 'service', 'combo');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "product_kind" "product_kind" NOT NULL DEFAULT 'product';
--> statement-breakpoint
UPDATE "products"
SET "product_kind" = 'service'
WHERE "product_kind" = 'product'
  AND "category_id" IN (
    SELECT "id"
    FROM "categories"
    WHERE lower(trim("name")) = 'dịch vụ'
  );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_combo_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "combo_product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "component_product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "quantity" numeric(14,4) NOT NULL DEFAULT 1,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "product_combo_items_unique" UNIQUE ("combo_product_id", "component_product_id"),
  CONSTRAINT "product_combo_items_not_self" CHECK ("combo_product_id" <> "component_product_id"),
  CONSTRAINT "product_combo_items_quantity_positive" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_combo_items_combo_idx"
  ON "product_combo_items" ("combo_product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_combo_items_component_idx"
  ON "product_combo_items" ("component_product_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_product_combo_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  combo_kind product_kind;
  component_kind product_kind;
BEGIN
  SELECT product_kind INTO combo_kind FROM products WHERE id = NEW.combo_product_id;
  SELECT product_kind INTO component_kind FROM products WHERE id = NEW.component_product_id;
  IF combo_kind IS DISTINCT FROM 'combo' THEN
    RAISE EXCEPTION 'combo_product_id must reference a combo';
  END IF;
  IF component_kind = 'combo' THEN
    RAISE EXCEPTION 'nested combos are not supported';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_combo_items_validate ON "product_combo_items";
CREATE TRIGGER product_combo_items_validate
BEFORE INSERT OR UPDATE ON "product_combo_items"
FOR EACH ROW EXECUTE FUNCTION validate_product_combo_item();
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_combo_items_catalog_revision ON "product_combo_items";
CREATE TRIGGER product_combo_items_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON "product_combo_items"
FOR EACH STATEMENT EXECUTE FUNCTION bump_product_catalog_revision();
