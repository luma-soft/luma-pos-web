-- Gross profit used each product's current cost price, so every cost change
-- (purchases, KiotViet sync, manual edits) rewrote the profit of past months.
-- Sale and return lines now keep the unit cost (per base unit) at the time
-- they are written. Existing lines are frozen at today's cost price, which is
-- what every report showed until now.

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS unit_cost numeric(14, 2);
--> statement-breakpoint
ALTER TABLE public.return_items ADD COLUMN IF NOT EXISTS unit_cost numeric(14, 2);
--> statement-breakpoint
UPDATE public.order_items oi
SET unit_cost = p.cost_price
FROM public.products p
WHERE p.id = oi.product_id AND oi.unit_cost IS NULL;
--> statement-breakpoint
UPDATE public.return_items ri
SET unit_cost = oi.unit_cost
FROM public.order_items oi
WHERE oi.id = ri.order_item_id AND ri.unit_cost IS NULL;
--> statement-breakpoint
UPDATE public.return_items ri
SET unit_cost = p.cost_price
FROM public.products p
WHERE p.id = ri.product_id AND ri.unit_cost IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.fill_line_unit_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.unit_cost IS NULL THEN
    IF TG_TABLE_NAME = 'return_items' AND NEW.order_item_id IS NOT NULL THEN
      SELECT oi.unit_cost INTO NEW.unit_cost
      FROM public.order_items oi
      WHERE oi.id = NEW.order_item_id;
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
--> statement-breakpoint
DROP TRIGGER IF EXISTS order_items_fill_unit_cost ON public.order_items;
--> statement-breakpoint
CREATE TRIGGER order_items_fill_unit_cost
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.fill_line_unit_cost();
--> statement-breakpoint
DROP TRIGGER IF EXISTS return_items_fill_unit_cost ON public.return_items;
--> statement-breakpoint
CREATE TRIGGER return_items_fill_unit_cost
  BEFORE INSERT ON public.return_items
  FOR EACH ROW EXECUTE FUNCTION public.fill_line_unit_cost();
