DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM orders original
    LEFT JOIN orders replacement ON replacement.id = original.replaced_by_order_id
    WHERE original.status = 'cancelled'
      AND original.code NOT LIKE 'BG%'
      AND NOT EXISTS (
        SELECT 1
        FROM stock_movements movement
        WHERE movement.ref_id = original.id
          AND movement.ref_type = 'order_cancel'
      )
      AND NOT (
        replacement.id IS NOT NULL
        AND replacement.source_order_id = original.id
        AND replacement.source_mode = 'edit'
        AND (
          replacement.status IN ('quote', 'confirmed', 'draft', 'delivering', 'completed', 'returned', 'merged')
          OR replacement.code LIKE 'BG%'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Cannot deterministically backfill orders.document_type for one or more cancelled documents';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE order_document_type AS ENUM ('sale', 'quote', 'booking');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN IF NOT EXISTS document_type order_document_type;
--> statement-breakpoint
UPDATE orders original
SET document_type = CASE
  WHEN original.status = 'quote' OR original.code LIKE 'BG%' THEN 'quote'::order_document_type
  WHEN original.status = 'confirmed' THEN 'booking'::order_document_type
  WHEN original.status = 'cancelled' AND EXISTS (
    SELECT 1
    FROM orders replacement
    WHERE replacement.id = original.replaced_by_order_id
      AND replacement.source_order_id = original.id
      AND replacement.source_mode = 'edit'
      AND replacement.status = 'confirmed'
  ) THEN 'booking'::order_document_type
  WHEN original.status = 'cancelled' AND EXISTS (
    SELECT 1
    FROM orders replacement
    WHERE replacement.id = original.replaced_by_order_id
      AND replacement.source_order_id = original.id
      AND replacement.source_mode = 'edit'
      AND (replacement.status = 'quote' OR replacement.code LIKE 'BG%')
  ) THEN 'quote'::order_document_type
  ELSE 'sale'::order_document_type
END
WHERE original.document_type IS NULL;
--> statement-breakpoint
ALTER TABLE orders ALTER COLUMN document_type SET DEFAULT 'sale';
--> statement-breakpoint
ALTER TABLE orders ALTER COLUMN document_type SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_document_type_status_idx ON orders (document_type, status);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_order_document_type_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.document_type IS DISTINCT FROM NEW.document_type
    AND NOT (
      OLD.document_type IN ('quote', 'booking')
      AND NEW.document_type = 'sale'
      AND OLD.status IN ('quote', 'confirmed')
      AND NEW.status = 'completed'
    )
  THEN
    RAISE EXCEPTION 'orders.document_type is immutable outside quote/booking conversion';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS orders_document_type_transition_guard ON orders;
--> statement-breakpoint
CREATE TRIGGER orders_document_type_transition_guard
BEFORE UPDATE OF document_type ON orders
FOR EACH ROW
EXECUTE FUNCTION enforce_order_document_type_transition();
