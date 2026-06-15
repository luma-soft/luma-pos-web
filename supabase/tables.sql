-- F&B: bàn ăn (dining_tables). Idempotent, áp dụng thủ công.
CREATE TABLE IF NOT EXISTS dining_tables (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  zone         text NOT NULL DEFAULT '',
  sort_order   int NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'free',
  current_cart jsonb NOT NULL DEFAULT '[]',
  opened_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dining_tables_zone_idx ON dining_tables(zone, sort_order);
