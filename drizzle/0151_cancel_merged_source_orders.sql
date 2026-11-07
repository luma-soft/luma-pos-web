-- Historical merge sources must be cancelled (not active receivables/sales).
-- Preserve original totals, payment snapshots, and stock history for audit.
-- The merge already moved payments/items to the consolidated order, so do NOT
-- call normal cancellation logic or reverse stock, customer debt, or revenue.
--
-- Backfill the target link from the merge note only when the target belongs to
-- the same store. Some legacy rows may not have a resolvable target; their note
-- remains available for audit.
UPDATE orders AS source
SET replaced_by_order_id = target.id
FROM orders AS target
WHERE source.status = 'merged'
  AND source.replaced_by_order_id IS NULL
  AND target.store_id = source.store_id
  AND target.id <> source.id
  AND source.note IS NOT NULL
  AND right(source.note, length('Đã gộp vào ' || target.code)) = 'Đã gộp vào ' || target.code;

UPDATE orders
SET status = 'cancelled', updated_at = now()
WHERE status = 'merged';
