ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS line_order integer;
--> statement-breakpoint
WITH existing_max AS (
  SELECT store_id, purchase_order_id, max(line_order) AS max_line_order
  FROM purchase_order_items
  GROUP BY store_id, purchase_order_id
), ranked_items AS (
  SELECT item.id,
         coalesce(existing_max.max_line_order, -1)
           + row_number() OVER (
             PARTITION BY item.store_id, item.purchase_order_id ORDER BY item.ctid
           ) AS line_order
  FROM purchase_order_items AS item
  LEFT JOIN existing_max
    ON existing_max.store_id = item.store_id
   AND existing_max.purchase_order_id = item.purchase_order_id
  WHERE item.line_order IS NULL
)
UPDATE purchase_order_items AS item
SET line_order = ranked_items.line_order
FROM ranked_items
WHERE item.id = ranked_items.id
  AND item.line_order IS NULL;
--> statement-breakpoint
ALTER TABLE purchase_order_items
  ALTER COLUMN line_order SET DEFAULT 0,
  ALTER COLUMN line_order SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchase_order_items_store_order_idx
  ON purchase_order_items (store_id, purchase_order_id, line_order, id);
