-- Journal one catalog event per store and SQL statement for high-volume
-- product and document-line tables. The transition tables retain exact V2
-- product IDs while avoiding a revision/journal insert for every changed row.
CREATE OR REPLACE FUNCTION public.bump_product_catalog_revision_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  product_column text;
  change_kind_value text;
  legacy_full_refresh boolean := false;
  statement_sql text;
  changed record;
  product_id_value uuid;
  full_refresh_value boolean;
  next_revision bigint;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'products' THEN
      product_column := 'id';
      change_kind_value := 'product';
    WHEN 'product_units' THEN
      product_column := 'product_id';
      change_kind_value := 'unit';
    WHEN 'product_prices' THEN
      product_column := 'product_id';
      change_kind_value := 'price';
    WHEN 'stock_levels' THEN
      product_column := 'product_id';
      change_kind_value := 'stock';
    WHEN 'product_suppliers' THEN
      product_column := 'product_id';
      change_kind_value := 'relationship';
    WHEN 'product_combo_items' THEN
      product_column := 'combo_product_id';
      change_kind_value := 'relationship';
    WHEN 'order_items' THEN
      product_column := 'product_id';
      change_kind_value := 'sale';
      legacy_full_refresh := true;
    WHEN 'purchase_order_items' THEN
      product_column := 'product_id';
      change_kind_value := 'purchase-price';
      legacy_full_refresh := true;
    ELSE
      RAISE EXCEPTION 'unsupported catalog statement trigger table: %', TG_TABLE_NAME;
  END CASE;

  IF TG_OP = 'INSERT' THEN
    statement_sql := format(
      'SELECT store_id, array_agg(DISTINCT %1$I ORDER BY %1$I) AS product_ids FROM new_rows WHERE %1$I IS NOT NULL GROUP BY store_id',
      product_column
    );
  ELSIF TG_OP = 'DELETE' THEN
    statement_sql := format(
      'SELECT store_id, array_agg(DISTINCT %1$I ORDER BY %1$I) AS product_ids FROM old_rows WHERE %1$I IS NOT NULL GROUP BY store_id',
      product_column
    );
  ELSE
    statement_sql := format(
      'SELECT store_id, array_agg(DISTINCT product_id ORDER BY product_id) AS product_ids FROM (
         SELECT store_id, %1$I AS product_id FROM new_rows
         UNION
         SELECT store_id, %1$I AS product_id FROM old_rows
       ) changed WHERE product_id IS NOT NULL GROUP BY store_id',
      product_column
    );
  END IF;

  FOR changed IN EXECUTE statement_sql LOOP
    IF coalesce(cardinality(changed.product_ids), 0) = 0 THEN
      CONTINUE;
    END IF;

    full_refresh_value := legacy_full_refresh OR cardinality(changed.product_ids) > 1;
    product_id_value := CASE
      WHEN full_refresh_value THEN NULL
      ELSE changed.product_ids[1]
    END;

    INSERT INTO public.catalog_sync_state (store_id, id, revision, updated_at)
    VALUES (changed.store_id, 1, 2, clock_timestamp())
    ON CONFLICT (store_id, id) DO UPDATE
      SET revision = public.catalog_sync_state.revision + 1,
          updated_at = clock_timestamp()
    RETURNING revision INTO next_revision;

    INSERT INTO public.catalog_delta_events (
      store_id,
      revision,
      product_id,
      requires_full,
      change_kind,
      entity_type,
      entity_id,
      affected_product_ids,
      requires_full_v2
    ) VALUES (
      changed.store_id,
      next_revision,
      product_id_value,
      full_refresh_value,
      change_kind_value,
      TG_TABLE_NAME,
      product_id_value,
      changed.product_ids,
      false
    );

    INSERT INTO public.catalog_delta_floors (store_id, floor_revision)
    VALUES (changed.store_id, next_revision - 1)
    ON CONFLICT (store_id) DO NOTHING;
  END LOOP;

  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $catalog_statement_triggers$
DECLARE
  table_name text;
  trigger_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'products', 'product_units', 'product_prices', 'stock_levels',
    'product_suppliers', 'product_combo_items', 'order_items',
    'purchase_order_items'
  ] LOOP
    trigger_name := format('%s_catalog_revision', table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name || '_insert', table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name || '_update', table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name || '_delete', table_name);

    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_product_catalog_revision_statement()',
      trigger_name || '_insert', table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_product_catalog_revision_statement()',
      trigger_name || '_update', table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_product_catalog_revision_statement()',
      trigger_name || '_delete', table_name
    );
  END LOOP;
END;
$catalog_statement_triggers$;
