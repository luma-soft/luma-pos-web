-- Forward-only V2 journal additions. Migration 0142 may already be deployed;
-- preserve its V1 columns and API behavior for older mobile clients.
ALTER TABLE public.catalog_delta_events
  ADD COLUMN IF NOT EXISTS change_kind text,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS affected_product_ids uuid[],
  ADD COLUMN IF NOT EXISTS requires_full_v2 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata_payload jsonb;
--> statement-breakpoint
ALTER TABLE public.catalog_delta_events
  ADD CONSTRAINT catalog_delta_events_change_kind_check
  CHECK (change_kind IS NULL OR change_kind IN (
    'product', 'stock', 'price', 'unit', 'relationship', 'media',
    'sale', 'purchase-price', 'metadata', 'checkout', 'reset', 'noop'
  ));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS catalog_delta_events_v2_entity_idx
  ON public.catalog_delta_events (store_id, entity_type, entity_id, revision);
--> statement-breakpoint
-- Existing rows have only the V1 shape. Start V2 at the committed state so a
-- V2 client receives a full snapshot once, then replays only structured rows.
INSERT INTO public.catalog_delta_floors (store_id, floor_revision)
SELECT store_id, revision FROM public.catalog_sync_state
ON CONFLICT (store_id) DO UPDATE
  SET floor_revision = greatest(public.catalog_delta_floors.floor_revision, excluded.floor_revision);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bump_product_catalog_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_store_id uuid;
  entity_id_value uuid;
  changed_product_id uuid;
  changed_product_ids uuid[] := ARRAY[]::uuid[];
  next_revision bigint;
  full_refresh boolean;
  full_refresh_v2 boolean := false;
  change_kind_value text := 'noop';
  entity_type_value text := TG_TABLE_NAME;
  metadata_value jsonb;
BEGIN
  target_store_id := COALESCE(NEW.store_id, OLD.store_id);
  full_refresh := TG_TABLE_NAME NOT IN (
    'products', 'product_units', 'product_prices', 'stock_levels',
    'product_combo_items', 'product_suppliers'
  );

  IF TG_TABLE_NAME = 'products' THEN
    changed_product_id := COALESCE(NEW.id, OLD.id);
    entity_id_value := changed_product_id;
    changed_product_ids := ARRAY[changed_product_id];
    change_kind_value := 'product';
  ELSIF TG_TABLE_NAME IN ('product_units', 'product_prices', 'stock_levels', 'product_suppliers') THEN
    changed_product_id := COALESCE(NEW.product_id, OLD.product_id);
    entity_id_value := changed_product_id;
    changed_product_ids := ARRAY[changed_product_id];
    change_kind_value := CASE TG_TABLE_NAME
      WHEN 'product_units' THEN 'unit'
      WHEN 'product_prices' THEN 'price'
      WHEN 'stock_levels' THEN 'stock'
      ELSE 'relationship'
    END;
  ELSIF TG_TABLE_NAME = 'product_combo_items' THEN
    changed_product_id := COALESCE(NEW.combo_product_id, OLD.combo_product_id);
    entity_id_value := changed_product_id;
    changed_product_ids := ARRAY[changed_product_id];
    change_kind_value := 'relationship';
  ELSIF TG_TABLE_NAME = 'product_media' THEN
    changed_product_id := COALESCE(NEW.product_id, OLD.product_id);
    entity_id_value := COALESCE(NEW.media_object_id, OLD.media_object_id);
    changed_product_ids := ARRAY[changed_product_id];
    change_kind_value := 'media';
    full_refresh := true;
  ELSIF TG_TABLE_NAME = 'media_objects' THEN
    entity_id_value := COALESCE(NEW.id, OLD.id);
    change_kind_value := 'media';
    full_refresh := true;
    SELECT coalesce(array_agg(DISTINCT affected.product_id), ARRAY[]::uuid[])
      INTO changed_product_ids
    FROM (
      SELECT pm.product_id
      FROM public.product_media pm
      WHERE pm.store_id = target_store_id AND pm.media_object_id = entity_id_value
      UNION
      SELECT mo.target_id AS product_id
      FROM public.media_objects mo
      WHERE mo.store_id = target_store_id AND mo.id = entity_id_value
        AND mo.purpose = 'product-image'
    ) affected;
  ELSIF TG_TABLE_NAME IN ('categories', 'brands', 'suppliers', 'warehouses') THEN
    entity_id_value := COALESCE(NEW.id, OLD.id);
    entity_type_value := TG_TABLE_NAME;
    change_kind_value := 'metadata';
    full_refresh := true;
    IF TG_OP <> 'DELETE' THEN
      metadata_value := jsonb_build_object('id', NEW.id, 'name', NEW.name);
      IF TG_TABLE_NAME = 'warehouses' THEN
        metadata_value := metadata_value || jsonb_build_object('isDefault', NEW.is_default);
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'product_variant_members' THEN
    entity_id_value := COALESCE(NEW.product_id, OLD.product_id);
    change_kind_value := 'relationship';
    full_refresh := true;
    SELECT coalesce(array_agg(DISTINCT affected.product_id), ARRAY[]::uuid[])
      INTO changed_product_ids
    FROM (
      SELECT unnest(ARRAY[NEW.product_id, OLD.product_id]) AS product_id
      UNION
      SELECT pm.product_id
      FROM public.product_variant_members pm
      WHERE pm.store_id = target_store_id
        AND pm.group_id = ANY(ARRAY[NEW.group_id, OLD.group_id])
    ) affected
    WHERE affected.product_id IS NOT NULL;
  ELSIF TG_TABLE_NAME = 'product_variant_groups' THEN
    entity_id_value := COALESCE(NEW.id, OLD.id);
    change_kind_value := 'relationship';
    full_refresh := true;
    SELECT coalesce(array_agg(DISTINCT pm.product_id), ARRAY[]::uuid[])
      INTO changed_product_ids
    FROM public.product_variant_members pm
    WHERE pm.store_id = target_store_id AND pm.group_id = entity_id_value;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    entity_id_value := COALESCE(NEW.id, OLD.id);
    changed_product_ids := ARRAY_REMOVE(ARRAY[NEW.product_id, OLD.product_id], NULL);
    changed_product_id := COALESCE(NEW.product_id, OLD.product_id);
    change_kind_value := 'sale';
    full_refresh := true;
  ELSIF TG_TABLE_NAME = 'orders' THEN
    entity_id_value := COALESCE(NEW.id, OLD.id);
    change_kind_value := 'sale';
    full_refresh := true;
    SELECT coalesce(array_agg(DISTINCT oi.product_id), ARRAY[]::uuid[])
      INTO changed_product_ids
    FROM public.order_items oi
    WHERE oi.store_id = target_store_id AND oi.order_id = entity_id_value;
  ELSIF TG_TABLE_NAME = 'purchase_order_items' THEN
    entity_id_value := COALESCE(NEW.id, OLD.id);
    changed_product_ids := ARRAY_REMOVE(ARRAY[NEW.product_id, OLD.product_id], NULL);
    changed_product_id := COALESCE(NEW.product_id, OLD.product_id);
    change_kind_value := 'purchase-price';
    full_refresh := true;
  ELSIF TG_TABLE_NAME = 'purchase_orders' THEN
    entity_id_value := COALESCE(NEW.id, OLD.id);
    change_kind_value := 'purchase-price';
    full_refresh := true;
    SELECT coalesce(array_agg(DISTINCT poi.product_id), ARRAY[]::uuid[])
      INTO changed_product_ids
    FROM public.purchase_order_items poi
    WHERE poi.store_id = target_store_id AND poi.purchase_order_id = entity_id_value;
  ELSIF TG_TABLE_NAME = 'price_books' THEN
    entity_id_value := COALESCE(NEW.id, OLD.id);
    change_kind_value := 'price';
    full_refresh := true;
    SELECT coalesce(array_agg(DISTINCT pp.product_id), ARRAY[]::uuid[])
      INTO changed_product_ids
    FROM public.product_prices pp
    WHERE pp.store_id = target_store_id AND pp.price_book_id = entity_id_value;
    full_refresh_v2 := true;
  ELSIF TG_TABLE_NAME = 'promotions' THEN
    entity_id_value := COALESCE(NEW.id, OLD.id);
    entity_type_value := 'promotions';
    change_kind_value := 'checkout';
    full_refresh := true;
  ELSE
    entity_id_value := COALESCE(NEW.id, OLD.id);
    change_kind_value := 'reset';
    full_refresh := true;
    full_refresh_v2 := true;
  END IF;

  -- Preserve one transactional store revision and the V1 journal contract.
  INSERT INTO public.catalog_sync_state (store_id, id, revision, updated_at)
  VALUES (target_store_id, 1, 2, clock_timestamp())
  ON CONFLICT (store_id, id) DO UPDATE
    SET revision = public.catalog_sync_state.revision + 1,
        updated_at = clock_timestamp()
  RETURNING revision INTO next_revision;

  INSERT INTO public.catalog_delta_events (
    store_id, revision, product_id, requires_full, change_kind, entity_type,
    entity_id, affected_product_ids, requires_full_v2, metadata_payload
  ) VALUES (
    target_store_id,
    next_revision,
    CASE WHEN full_refresh THEN NULL ELSE changed_product_id END,
    full_refresh,
    change_kind_value,
    entity_type_value,
    entity_id_value,
    coalesce(changed_product_ids, ARRAY[]::uuid[]),
    full_refresh_v2,
    metadata_value
  );

  INSERT INTO public.catalog_delta_floors (store_id, floor_revision)
  VALUES (target_store_id, next_revision - 1)
  ON CONFLICT (store_id) DO NOTHING;

  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
-- Sales and purchase document headers only affect catalog sale/purchase
-- projections when their status/date changes. Avoid revision writes for notes,
-- payment metadata, and unrelated header edits.
DROP TRIGGER IF EXISTS orders_catalog_revision ON public.orders;
CREATE TRIGGER orders_catalog_revision
AFTER INSERT OR DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER orders_catalog_revision_status
AFTER UPDATE OF status, created_at ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
--> statement-breakpoint
DROP TRIGGER IF EXISTS purchase_orders_catalog_revision ON public.purchase_orders;
CREATE TRIGGER purchase_orders_catalog_revision
AFTER INSERT OR DELETE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER purchase_orders_catalog_revision_status
AFTER UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
