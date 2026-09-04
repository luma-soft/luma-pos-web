-- Price-book options and active promotion tiers are part of the POS catalog.
-- Reuse the existing tenant-local revision function; no new privileges or RLS.
CREATE TRIGGER price_books_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON public.price_books
FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER promotions_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
--> statement-breakpoint
-- Existing snapshots may already contain stale names/options. Invalidate once;
-- do not alter any product price, promotion, book or historical document.
UPDATE public.catalog_sync_state
SET revision = revision + 1, updated_at = now();
