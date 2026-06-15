-- Internal-Use Issue (Xuất dùng nội bộ — spec Part 8.1)
-- Áp dụng thủ công (ngoài drizzle) như denormalize-stock.sql. Idempotent.

-- 1) Thêm loại biến động kho 'internal_use'
ALTER TYPE "stock_movement_type" ADD VALUE IF NOT EXISTS 'internal_use';

-- 2) Phiếu xuất dùng nội bộ
CREATE TABLE IF NOT EXISTS internal_use_issues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        varchar(30) NOT NULL UNIQUE,
  warehouse_id uuid REFERENCES warehouses(id),
  department  text,
  reason      text,
  status      text NOT NULL DEFAULT 'approved',
  total_cost  numeric(14,2) NOT NULL DEFAULT 0,
  note        text,
  created_by  uuid REFERENCES profiles(id),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3) Dòng hàng của phiếu
CREATE TABLE IF NOT EXISTS internal_use_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id        uuid NOT NULL REFERENCES internal_use_issues(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES products(id),
  product_name    text NOT NULL,
  unit_name       varchar(30) NOT NULL,
  unit_multiplier numeric(14,4) NOT NULL,
  quantity        numeric(14,4) NOT NULL,
  unit_cost       numeric(14,2) NOT NULL,
  total           numeric(14,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS internal_use_items_issue_idx ON internal_use_items(issue_id);
