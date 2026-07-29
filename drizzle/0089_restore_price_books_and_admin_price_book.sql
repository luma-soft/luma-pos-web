ALTER TABLE "price_books" ADD COLUMN "manager_only" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO "price_books" ("name", "is_default", "manager_only", "sort_order")
SELECT 'Giá sỉ', false, false, 1
WHERE NOT EXISTS (SELECT 1 FROM "price_books" WHERE "name" = 'Giá sỉ');
--> statement-breakpoint
INSERT INTO "price_books" ("name", "is_default", "manager_only", "sort_order")
SELECT 'Giá thợ', false, false, 2
WHERE NOT EXISTS (SELECT 1 FROM "price_books" WHERE "name" = 'Giá thợ');
--> statement-breakpoint
INSERT INTO "price_books" ("name", "is_default", "manager_only", "sort_order")
SELECT 'Giá Chưa Chiết Khấu', false, true, 3
WHERE NOT EXISTS (SELECT 1 FROM "price_books" WHERE "name" = 'Giá Chưa Chiết Khấu');
--> statement-breakpoint
INSERT INTO "product_prices" ("price_book_id", "product_id", "price")
SELECT book."id", product."id", product."wholesale_price"
FROM "products" AS product
CROSS JOIN LATERAL (
  SELECT "id" FROM "price_books" WHERE "name" = 'Giá sỉ' ORDER BY "sort_order", "created_at" LIMIT 1
) AS book
WHERE product."wholesale_price" IS NOT NULL
ON CONFLICT ("price_book_id", "product_id") DO UPDATE SET "price" = EXCLUDED."price";
--> statement-breakpoint
INSERT INTO "product_prices" ("price_book_id", "product_id", "price")
SELECT book."id", product."id", product."contractor_price"
FROM "products" AS product
CROSS JOIN LATERAL (
  SELECT "id" FROM "price_books" WHERE "name" = 'Giá thợ' ORDER BY "sort_order", "created_at" LIMIT 1
) AS book
WHERE product."contractor_price" IS NOT NULL
ON CONFLICT ("price_book_id", "product_id") DO UPDATE SET "price" = EXCLUDED."price";
