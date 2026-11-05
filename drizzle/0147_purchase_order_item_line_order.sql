ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS line_order integer;
--> statement-breakpoint
WITH ranked_items AS (
  SELECT id,
         row_number() OVER (PARTITION BY store_id, purchase_order_id ORDER BY ctid) - 1 AS line_order
  FROM purchase_order_items
)
UPDATE purchase_order_items AS item
SET line_order = ranked_items.line_order
FROM ranked_items
WHERE item.id = ranked_items.id;
--> statement-breakpoint
ALTER TABLE purchase_order_items
  ALTER COLUMN line_order SET DEFAULT 0,
  ALTER COLUMN line_order SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchase_order_items_store_order_idx
  ON purchase_order_items (store_id, purchase_order_id, line_order, id);
