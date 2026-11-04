ALTER TABLE orders
  ADD COLUMN pos_draft_id text,
  ADD COLUMN pos_draft_payload jsonb;

CREATE UNIQUE INDEX orders_store_pos_draft_id_unique
  ON orders (store_id, pos_draft_id)
  WHERE pos_draft_id IS NOT NULL;
