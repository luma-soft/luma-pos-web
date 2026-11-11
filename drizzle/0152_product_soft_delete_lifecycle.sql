-- Existing installations restrict product lifecycle to draft/active/archived.
-- Soft deletion preserves historical document references by marking the row deleted.
-- One ALTER TABLE statement replaces the check atomically; safe to re-run manually.
ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_lifecycle_status_check",
  ADD CONSTRAINT "products_lifecycle_status_check"
    CHECK ("lifecycle_status" IN ('draft', 'active', 'archived', 'deleted'));
