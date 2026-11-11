-- Preserve historical invoice/purchase/stock references while removing a product
-- from active catalogs. The original lifecycle check admitted only draft/active/archived.
-- This migration is safe to re-run manually, because the constraint is replaced atomically.
ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_lifecycle_status_check";

ALTER TABLE "products"
  ADD CONSTRAINT "products_lifecycle_status_check"
  CHECK ("lifecycle_status" IN ('draft', 'active', 'archived', 'deleted'));
