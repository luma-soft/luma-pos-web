-- Wire Settings (Part 15): cấu hình vận hành (Thuế/Thanh toán/Thông báo/Phần cứng).
-- Lưu gộp trong 1 cột jsonb. Idempotent, áp dụng thủ công.

ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL DEFAULT '{}';
