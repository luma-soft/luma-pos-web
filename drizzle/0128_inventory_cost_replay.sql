-- Source reconciliation/backfill is a separate reviewed data operation. This
-- migration does not invent balances or change any existing product valuation.
CREATE TABLE public.inventory_cost_baselines (
  store_id uuid NOT NULL REFERENCES public.stores(id),
  product_id uuid NOT NULL,
  quantity numeric(14,4) NOT NULL,
  unit_cost numeric(14,2) NOT NULL,
  gross_unit_cost numeric(14,2),
  effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (store_id, product_id),
  FOREIGN KEY (store_id, product_id) REFERENCES public.products(store_id,id) ON DELETE CASCADE,
  CONSTRAINT inventory_cost_baselines_nonnegative CHECK (unit_cost >= 0 AND (gross_unit_cost IS NULL OR gross_unit_cost >= 0))
);
--> statement-breakpoint
CREATE TABLE public.inventory_cost_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  product_id uuid NOT NULL,
  unit_cost numeric(14,2) NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL,
  FOREIGN KEY (store_id, product_id) REFERENCES public.products(store_id,id) ON DELETE CASCADE,
  CONSTRAINT inventory_cost_adjustments_nonnegative CHECK (unit_cost >= 0)
);
CREATE INDEX inventory_cost_adjustments_product_time_idx ON public.inventory_cost_adjustments(store_id,product_id,effective_at);
--> statement-breakpoint
-- Internal accounting state is accessed through authenticated application
-- services with explicit tenant checks, never through the client Data API.
ALTER TABLE public.inventory_cost_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cost_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_cost_baselines, public.inventory_cost_adjustments FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
ALTER TABLE public.purchase_orders ADD COLUMN cost_effective_at timestamptz;
-- now() is transaction-start time. A transaction waiting for a product lock
-- must not insert a stock event dated before an already-committed cost basis.
ALTER TABLE public.stock_movements ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE INDEX stock_movements_store_product_time_idx ON public.stock_movements(store_id,product_id,created_at);
