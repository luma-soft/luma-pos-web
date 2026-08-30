ALTER TABLE "products"
  ADD COLUMN "related_product_id" uuid;
--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_related_product_id_products_id_fk"
  FOREIGN KEY ("related_product_id") REFERENCES "public"."products"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "products_related_idx"
  ON "products" USING btree ("related_product_id");
