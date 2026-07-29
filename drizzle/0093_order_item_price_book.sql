ALTER TABLE "order_items" ADD COLUMN "price_book_id" uuid REFERENCES "price_books"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "order_items_price_book_idx" ON "order_items" USING btree ("price_book_id");
