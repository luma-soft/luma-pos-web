ALTER TABLE "products" ADD COLUMN "image_updated_at" timestamptz;
--> statement-breakpoint
UPDATE "products"
SET "image_updated_at" = "updated_at"
WHERE "image_updated_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "image_updated_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "image_updated_at" SET NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_product_image_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."image_urls" IS DISTINCT FROM NEW."image_urls" THEN
    NEW."image_updated_at" = clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_image_updated_at
BEFORE UPDATE OF "image_urls" ON "products"
FOR EACH ROW EXECUTE FUNCTION set_product_image_updated_at();
