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
WITH existing_max AS (
  SELECT store_id, order_id, max(line_order) AS max_line_order
  FROM order_items
  GROUP BY store_id, order_id
), ranked_items AS (
  SELECT item.id,
         coalesce(existing_max.max_line_order, -1)
           + row_number() OVER (PARTITION BY item.store_id, item.order_id ORDER BY item.ctid) AS line_order
  FROM order_items AS item
  LEFT JOIN existing_max
    ON existing_max.store_id = item.store_id
   AND existing_max.order_id = item.order_id
  WHERE item.line_order IS NULL
)
UPDATE order_items AS item
SET line_order = ranked_items.line_order
FROM ranked_items
WHERE item.id = ranked_items.id
  AND item.line_order IS NULL;
--> statement-breakpoint
ALTER TABLE order_items ENABLE TRIGGER order_items_catalog_revision;
--> statement-breakpoint
WITH existing_max AS (
  SELECT store_id, return_id, max(line_order) AS max_line_order
  FROM return_items
  GROUP BY store_id, return_id
), ranked_items AS (
  SELECT item.id,
         coalesce(existing_max.max_line_order, -1)
           + row_number() OVER (PARTITION BY item.store_id, item.return_id ORDER BY item.ctid) AS line_order
  FROM return_items AS item
  LEFT JOIN existing_max
    ON existing_max.store_id = item.store_id
   AND existing_max.return_id = item.return_id
  WHERE item.line_order IS NULL
)
UPDATE return_items AS item
SET line_order = ranked_items.line_order
FROM ranked_items
WHERE item.id = ranked_items.id
  AND item.line_order IS NULL;
--> statement-breakpoint
WITH existing_max AS (
  SELECT store_id, purchase_return_id, max(line_order) AS max_line_order
  FROM purchase_return_items
  GROUP BY store_id, purchase_return_id
), ranked_items AS (
  SELECT item.id,
         coalesce(existing_max.max_line_order, -1)
           + row_number() OVER (
             PARTITION BY item.store_id, item.purchase_return_id ORDER BY item.ctid
           ) AS line_order
  FROM purchase_return_items AS item
  LEFT JOIN existing_max
    ON existing_max.store_id = item.store_id
   AND existing_max.purchase_return_id = item.purchase_return_id
  WHERE item.line_order IS NULL
)
UPDATE purchase_return_items AS item
SET line_order = ranked_items.line_order
FROM ranked_items
WHERE item.id = ranked_items.id
  AND item.line_order IS NULL;
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
