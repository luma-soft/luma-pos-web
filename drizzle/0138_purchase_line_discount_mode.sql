ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS discount_mode text NOT NULL DEFAULT 'vnd',
  ADD COLUMN IF NOT EXISTS discount_input numeric(14, 2);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchase_order_items_discount_mode_check'
      AND conrelid = 'purchase_order_items'::regclass
  ) THEN
    ALTER TABLE purchase_order_items
      ADD CONSTRAINT purchase_order_items_discount_mode_check
      CHECK (discount_mode IN ('vnd', 'pct') AND (discount_mode <> 'pct' OR discount_input IS NOT NULL));
  END IF;
END $$;
