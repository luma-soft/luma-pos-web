-- Every store runs a single default warehouse. Documents that move stock must
-- name it: an order or return without a warehouse made stock reversals
-- (edit, cancel, return, exchange) skip the stock change. KiotViet imports
-- created such rows. POS cart drafts keep a null warehouse on purpose.

CREATE OR REPLACE FUNCTION public.fill_document_default_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.warehouse_id IS NULL AND (TG_TABLE_NAME = 'returns' OR NEW.status::text <> 'draft') THEN
    SELECT w.id INTO NEW.warehouse_id
    FROM public.warehouses w
    WHERE w.store_id = NEW.store_id AND w.is_default
    LIMIT 1;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fill_document_default_warehouse() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS orders_fill_default_warehouse ON public.orders;
--> statement-breakpoint
CREATE TRIGGER orders_fill_default_warehouse
  BEFORE INSERT OR UPDATE OF warehouse_id, status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fill_document_default_warehouse();
--> statement-breakpoint
DROP TRIGGER IF EXISTS returns_fill_default_warehouse ON public.returns;
--> statement-breakpoint
CREATE TRIGGER returns_fill_default_warehouse
  BEFORE INSERT OR UPDATE OF warehouse_id ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public.fill_document_default_warehouse();
--> statement-breakpoint
UPDATE public.orders o
SET warehouse_id = w.id
FROM public.warehouses w
WHERE o.warehouse_id IS NULL AND o.status::text <> 'draft'
  AND w.store_id = o.store_id AND w.is_default;
--> statement-breakpoint
UPDATE public.returns r
SET warehouse_id = coalesce(
  (SELECT o.warehouse_id FROM public.orders o WHERE o.id = r.order_id),
  (SELECT w.id FROM public.warehouses w WHERE w.store_id = r.store_id AND w.is_default LIMIT 1)
)
WHERE r.warehouse_id IS NULL;
--> statement-breakpoint
ALTER TABLE public.orders
  ADD CONSTRAINT orders_warehouse_required_check
  CHECK (status::text = 'draft' OR warehouse_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE public.returns ALTER COLUMN warehouse_id SET NOT NULL;
