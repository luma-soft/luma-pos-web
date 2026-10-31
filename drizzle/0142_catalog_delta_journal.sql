-- Revision-bound, tenant-isolated catalog mutation journal. Each event is
-- committed in the SAME transaction as its catalog_sync_state revision bump.
-- Never infer deletions from updated_at (hard-deleted rows have no timestamp).
CREATE TABLE public.catalog_delta_floors (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  floor_revision bigint NOT NULL CHECK (floor_revision >= 0)
);
--> statement-breakpoint
CREATE TABLE public.catalog_delta_events (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  product_id uuid,
  requires_full boolean NOT NULL DEFAULT false,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (store_id, revision),
  CONSTRAINT catalog_delta_event_kind CHECK (
    (requires_full AND product_id IS NULL)
    OR (NOT requires_full AND product_id IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX catalog_delta_events_retention_idx
ON public.catalog_delta_events (changed_at);
--> statement-breakpoint
INSERT INTO public.catalog_delta_floors (store_id, floor_revision)
SELECT store_id, revision FROM public.catalog_sync_state
ON CONFLICT (store_id) DO NOTHING;
--> statement-breakpoint
-- All existing catalog revision triggers call this same function. Preserve
-- their names and semantics, but journal the exact changed product ID (even
-- on DELETE) or a full-refresh marker for cross-product dependencies.
CREATE OR REPLACE FUNCTION public.bump_product_catalog_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_store_id uuid;
  changed_product_id uuid;
  next_revision bigint;
  full_refresh boolean;
BEGIN
  target_store_id := COALESCE(NEW.store_id, OLD.store_id);
  full_refresh := TG_TABLE_NAME NOT IN (
    'products', 'product_units', 'product_prices', 'stock_levels',
    'product_combo_items', 'product_suppliers'
  );
  IF NOT full_refresh THEN
    IF TG_TABLE_NAME = 'products' THEN
      changed_product_id := COALESCE(NEW.id, OLD.id);
    ELSIF TG_TABLE_NAME = 'product_combo_items' THEN
      changed_product_id := COALESCE(NEW.combo_product_id, OLD.combo_product_id);
    ELSE
      changed_product_id := COALESCE(NEW.product_id, OLD.product_id);
    END IF;
  END IF;

  INSERT INTO public.catalog_sync_state (store_id, id, revision, updated_at)
  VALUES (target_store_id, 1, 2, clock_timestamp())
  ON CONFLICT (store_id, id) DO UPDATE
    SET revision = public.catalog_sync_state.revision + 1,
        updated_at = clock_timestamp()
  RETURNING revision INTO next_revision;

  INSERT INTO public.catalog_delta_floors (store_id, floor_revision)
  VALUES (target_store_id, next_revision - 1)
  ON CONFLICT (store_id) DO NOTHING;

  INSERT INTO public.catalog_delta_events (
    store_id, revision, product_id, requires_full
  ) VALUES (
    target_store_id, next_revision,
    CASE WHEN full_refresh THEN NULL ELSE changed_product_id END,
    full_refresh
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
-- Supplier assignments affect the product filter projection. These edits
-- previously did not advance catalog_sync_state at all.
DROP TRIGGER IF EXISTS product_suppliers_catalog_revision ON public.product_suppliers;
CREATE TRIGGER product_suppliers_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON public.product_suppliers
FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
--> statement-breakpoint
-- Variant membership and media changes can alter multiple displayed product
-- rows (e.g. inherited parent images). Conservatively force a full snapshot.
DROP TRIGGER IF EXISTS product_variant_members_catalog_revision ON public.product_variant_members;
CREATE TRIGGER product_variant_members_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON public.product_variant_members
FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_media_catalog_revision ON public.product_media;
CREATE TRIGGER product_media_catalog_revision
AFTER INSERT OR UPDATE OR DELETE ON public.product_media
FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
--> statement-breakpoint
-- Restrict direct client reads/writes of the journal. Only server-side DB
-- credentials may read it; authenticated users access the gated API instead.
ALTER TABLE public.catalog_delta_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_delta_floors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_delta_events, public.catalog_delta_floors
FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Maintenance is intentionally NOT scheduled automatically. Before pruning,
-- advance the replay floor in the same transaction as the deletion. An older
-- client then receives a full snapshot, never a truncated delta.
CREATE OR REPLACE FUNCTION public.prune_catalog_delta_events(
  retain interval DEFAULT interval '14 days'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  removed bigint;
BEGIN
  IF retain < interval '1 day' THEN
    RAISE EXCEPTION 'catalog delta retention must be at least one day';
  END IF;
  WITH old_rows AS (
    DELETE FROM public.catalog_delta_events
    WHERE changed_at < clock_timestamp() - retain
    RETURNING store_id, revision
  ), floors AS (
    SELECT store_id, max(revision) AS revision
    FROM old_rows GROUP BY store_id
  )
  INSERT INTO public.catalog_delta_floors (store_id, floor_revision)
  SELECT store_id, revision FROM floors
  ON CONFLICT (store_id) DO UPDATE SET floor_revision =
    greatest(public.catalog_delta_floors.floor_revision, excluded.floor_revision);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_catalog_delta_events(interval)
FROM PUBLIC, anon, authenticated;
