ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_store_name_unique"
  ON "categories" ("store_id", "name");
