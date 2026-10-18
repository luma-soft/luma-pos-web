ALTER TABLE products
  ADD COLUMN IF NOT EXISTS base_unit_direct_sale boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE product_units
  ADD COLUMN IF NOT EXISTS direct_sale boolean NOT NULL DEFAULT true;
