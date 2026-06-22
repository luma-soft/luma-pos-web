ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "parent_product_id" uuid;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "variant_name" text;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_variant_parent" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_parent_product_id_products_id_fk" FOREIGN KEY ("parent_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_parent_idx" ON "products" USING btree ("parent_product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_variant_parent_idx" ON "products" USING btree ("is_variant_parent","parent_product_id");
