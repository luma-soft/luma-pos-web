-- 0169's trigger tested `TG_TABLE_NAME = 'return_items' AND NEW.order_item_id
-- IS NOT NULL` in one condition. PL/pgSQL resolves every NEW field in an
-- expression before evaluating it, so on order_items (no order_item_id) every
-- sale failed with "record \"new\" has no field \"order_item_id\"". Read the
-- field only inside the return_items branch.

CREATE OR REPLACE FUNCTION public.fill_line_unit_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.unit_cost IS NULL THEN
    IF TG_TABLE_NAME = 'return_items' THEN
      IF NEW.order_item_id IS NOT NULL THEN
        SELECT oi.unit_cost INTO NEW.unit_cost
        FROM public.order_items oi
        WHERE oi.id = NEW.order_item_id;
      END IF;
    END IF;
    IF NEW.unit_cost IS NULL THEN
      SELECT p.cost_price INTO NEW.unit_cost
      FROM public.products p
      WHERE p.id = NEW.product_id;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fill_line_unit_cost() FROM PUBLIC;
