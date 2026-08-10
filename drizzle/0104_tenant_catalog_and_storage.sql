-- Make catalog invalidation tenant-local. The legacy statement trigger bumped
-- every store because it could not identify which tenant changed.
CREATE OR REPLACE FUNCTION public.bump_product_catalog_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_store_id uuid;
BEGIN
  target_store_id := COALESCE(NEW.store_id, OLD.store_id);
  INSERT INTO public.catalog_sync_state (store_id, id, revision, updated_at)
  VALUES (target_store_id, 1, 2, now())
  ON CONFLICT (store_id, id) DO UPDATE
    SET revision = public.catalog_sync_state.revision + 1,
        updated_at = now();
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'products', 'product_units', 'product_prices', 'stock_levels',
    'warehouses', 'categories', 'brands', 'product_combo_items'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_catalog_revision ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision()',
      table_name,
      table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint
DROP POLICY IF EXISTS "authenticated_read_catalog_sync_state" ON public.catalog_sync_state;
--> statement-breakpoint
CREATE POLICY "store_members_read_catalog_sync_state"
ON public.catalog_sync_state
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.stores s ON s.id = p.store_id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND s.status = 'active'
      AND p.store_id = catalog_sync_state.store_id
  )
);
--> statement-breakpoint
-- Storage writes are tenant-prefixed. Public product reads remain compatible;
-- private service/AI reads still require signed URLs or an active membership.
DROP POLICY IF EXISTS "tenant_members_insert_store_objects" ON storage.objects;
DROP POLICY IF EXISTS "tenant_members_select_store_objects" ON storage.objects;
DROP POLICY IF EXISTS "tenant_members_update_store_objects" ON storage.objects;
DROP POLICY IF EXISTS "tenant_members_delete_store_objects" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "tenant_members_insert_store_objects"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  (storage.foldername(name))[1] = 'stores'
  AND EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.stores s ON s.id = p.store_id
    WHERE p.id = auth.uid() AND p.is_active = true AND s.status = 'active'
      AND p.store_id::text = (storage.foldername(name))[2]
  )
);
--> statement-breakpoint
CREATE POLICY "tenant_members_select_store_objects"
ON storage.objects FOR SELECT TO authenticated
USING (
  (storage.foldername(name))[1] = 'stores'
  AND EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.stores s ON s.id = p.store_id
    WHERE p.id = auth.uid() AND p.is_active = true AND s.status = 'active'
      AND p.store_id::text = (storage.foldername(name))[2]
  )
);
--> statement-breakpoint
CREATE POLICY "tenant_members_update_store_objects"
ON storage.objects FOR UPDATE TO authenticated
USING (
  (storage.foldername(name))[1] = 'stores'
  AND EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.stores s ON s.id = p.store_id
    WHERE p.id = auth.uid() AND p.is_active = true AND s.status = 'active'
      AND p.store_id::text = (storage.foldername(name))[2]
  )
)
WITH CHECK (
  (storage.foldername(name))[1] = 'stores'
  AND EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.stores s ON s.id = p.store_id
    WHERE p.id = auth.uid() AND p.is_active = true AND s.status = 'active'
      AND p.store_id::text = (storage.foldername(name))[2]
  )
);
--> statement-breakpoint
CREATE POLICY "tenant_members_delete_store_objects"
ON storage.objects FOR DELETE TO authenticated
USING (
  (storage.foldername(name))[1] = 'stores'
  AND EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.stores s ON s.id = p.store_id
    WHERE p.id = auth.uid() AND p.is_active = true AND s.status = 'active'
      AND p.store_id::text = (storage.foldername(name))[2]
  )
);
