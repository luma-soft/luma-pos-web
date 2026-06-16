-- F&B deep (Part 18.2): modifiers + kitchen tickets (KDS). Idempotent, áp dụng thủ công.

-- Nhóm tùy chọn món (đường/đá/size/topping). Toàn cục, lọc theo nhóm hàng (category_ids rỗng = mọi món).
CREATE TABLE IF NOT EXISTS modifier_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  multi        boolean NOT NULL DEFAULT false,   -- cho chọn nhiều option?
  required     boolean NOT NULL DEFAULT false,
  options      jsonb NOT NULL DEFAULT '[]',       -- [{ id, label, priceDelta }]
  category_ids jsonb NOT NULL DEFAULT '[]',       -- uuid[]; rỗng = áp cho mọi món
  sort_order   int NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Phiếu bếp — mỗi lần "gửi bếp" tạo 1 phiếu (1 round) cho 1 bàn.
CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id   uuid REFERENCES dining_tables(id) ON DELETE SET NULL,
  table_name text NOT NULL DEFAULT '',
  round      int NOT NULL DEFAULT 1,
  status     text NOT NULL DEFAULT 'active',       -- active | done
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kitchen_tickets_status_idx ON kitchen_tickets(status, created_at);

CREATE TABLE IF NOT EXISTS kitchen_ticket_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES kitchen_tickets(id) ON DELETE CASCADE,
  product_id   uuid,
  product_name text NOT NULL,
  quantity     numeric(14,3) NOT NULL DEFAULT 1,
  modifiers    jsonb NOT NULL DEFAULT '[]',        -- [{ label, priceDelta }]
  note         text,
  status       text NOT NULL DEFAULT 'pending',    -- pending | preparing | ready | served
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kitchen_ticket_items_ticket_idx ON kitchen_ticket_items(ticket_id);
