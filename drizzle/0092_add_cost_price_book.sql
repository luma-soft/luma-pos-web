ALTER TABLE "price_books" ADD COLUMN "cost_based" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO "price_books" ("name", "is_default", "manager_only", "cost_based", "sort_order")
SELECT 'Giá vốn', false, true, true, 4
WHERE NOT EXISTS (SELECT 1 FROM "price_books" WHERE "cost_based" = true);
