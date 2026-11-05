ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS line_order integer;
--> statement-breakpoint
ALTER TABLE return_items
  ADD COLUMN IF NOT EXISTS line_order integer;
--> statement-breakpoint
ALTER TABLE purchase_return_items
  ADD COLUMN IF NOT EXISTS line_order integer;
--> statement-breakpoint
-- The order-item catalog trigger treats every update as a catalog change. This
-- backfill only records existing row order, so suppress that trigger while the
-- position column is populated.
ALTER TABLE order_items DISABLE TRIGGER order_items_catalog_revision;
--> statement-breakpoint
WITH ranked_items AS (
  SELECT id,
         row_number() OVER (PARTITION BY store_id, order_id ORDER BY ctid) - 1 AS line_order
  FROM order_items
)
UPDATE order_items AS item
SET line_order = ranked_items.line_order
FROM ranked_items
WHERE item.id = ranked_items.id;
--> statement-breakpoint
ALTER TABLE order_items ENABLE TRIGGER order_items_catalog_revision;
--> statement-breakpoint
WITH ranked_items AS (
  SELECT id,
         row_number() OVER (PARTITION BY store_id, return_id ORDER BY ctid) - 1 AS line_order
  FROM return_items
)
UPDATE return_items AS item
SET line_order = ranked_items.line_order
FROM ranked_items
WHERE item.id = ranked_items.id;
--> statement-breakpoint
WITH ranked_items AS (
  SELECT id,
         row_number() OVER (PARTITION BY store_id, purchase_return_id ORDER BY ctid) - 1 AS line_order
  FROM purchase_return_items
)
UPDATE purchase_return_items AS item
SET line_order = ranked_items.line_order
FROM ranked_items
WHERE item.id = ranked_items.id;
--> statement-breakpoint
ALTER TABLE order_items
  ALTER COLUMN line_order SET DEFAULT 0,
  ALTER COLUMN line_order SET NOT NULL;
--> statement-breakpoint
ALTER TABLE return_items
  ALTER COLUMN line_order SET DEFAULT 0,
  ALTER COLUMN line_order SET NOT NULL;
--> statement-breakpoint
ALTER TABLE purchase_return_items
  ALTER COLUMN line_order SET DEFAULT 0,
  ALTER COLUMN line_order SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS order_items_store_order_line_idx
  ON order_items (store_id, order_id, line_order, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS return_items_store_return_line_idx
  ON return_items (store_id, return_id, line_order, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchase_return_items_store_return_line_idx
  ON purchase_return_items (store_id, purchase_return_id, line_order, id);
