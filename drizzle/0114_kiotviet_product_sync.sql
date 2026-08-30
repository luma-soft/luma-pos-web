ALTER TABLE "product_units"
  ADD COLUMN "sku" varchar(50);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_units_store_sku_idx"
  ON "product_units" USING btree ("store_id", "sku")
  WHERE "sku" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "product_source_mappings" (
  "store_id" uuid NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "provider" varchar(30) NOT NULL,
  "external_id" varchar(100) NOT NULL,
  "last_seen_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_source_mappings"
  ADD CONSTRAINT "product_source_mappings_store_id_stores_id_fk"
  FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_source_mappings"
  ADD CONSTRAINT "product_source_mappings_product_tenant_fk"
  FOREIGN KEY ("store_id", "product_id")
  REFERENCES "public"."products"("store_id", "id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "product_source_mappings_store_external_idx"
  ON "product_source_mappings" USING btree ("store_id", "provider", "external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_source_mappings_store_product_idx"
  ON "product_source_mappings" USING btree ("store_id", "provider", "product_id");
--> statement-breakpoint
ALTER TABLE "product_source_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "product_source_mappings" FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "product_source_mappings" FROM authenticated;
