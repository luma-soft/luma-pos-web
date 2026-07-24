CREATE TABLE "catalog_sync_state" (
  "id" integer PRIMARY KEY NOT NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "catalog_sync_state_singleton_check" CHECK ("id" = 1)
);
--> statement-breakpoint
INSERT INTO "catalog_sync_state" ("id", "revision")
VALUES (1, 1)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bump_product_catalog_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE catalog_sync_state
  SET revision = revision + 1,
      updated_at = clock_timestamp()
  WHERE id = 1;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH STATEMENT EXECUTE FUNCTION bump_product_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER product_units_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON product_units
FOR EACH STATEMENT EXECUTE FUNCTION bump_product_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER product_prices_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON product_prices
FOR EACH STATEMENT EXECUTE FUNCTION bump_product_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER stock_levels_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON stock_levels
FOR EACH STATEMENT EXECUTE FUNCTION bump_product_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER warehouses_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON warehouses
FOR EACH STATEMENT EXECUTE FUNCTION bump_product_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER categories_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON categories
FOR EACH STATEMENT EXECUTE FUNCTION bump_product_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER brands_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON brands
FOR EACH STATEMENT EXECUTE FUNCTION bump_product_catalog_revision();
