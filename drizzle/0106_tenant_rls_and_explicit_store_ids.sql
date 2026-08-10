CREATE OR REPLACE FUNCTION public.current_active_store_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.store_id
  FROM public.profiles p
  JOIN public.stores s ON s.id = p.store_id
  WHERE p.id = auth.uid()
    AND p.is_active = true
    AND s.status = 'active'
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_active_store_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_active_store_id() TO authenticated;
--> statement-breakpoint
ALTER TABLE public.store_settings DROP CONSTRAINT IF EXISTS store_settings_pkey;
DROP INDEX IF EXISTS public.store_settings_store_idx;
ALTER TABLE public.store_settings ADD CONSTRAINT store_settings_pkey PRIMARY KEY (store_id);
--> statement-breakpoint
DO $$
DECLARE
  tenant_table text;
BEGIN
  FOR tenant_table IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'store_id'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN store_id DROP DEFAULT', tenant_table);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN store_id SET NOT NULL', tenant_table);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table);
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  tenant_table text;
  old_policy text;
BEGIN
  FOR tenant_table, old_policy IN
    SELECT * FROM (VALUES
      ('cash_transactions', 'cash_transactions_auth_select'),
      ('categories', 'categories_auth_select'),
      ('customers', 'customers_auth_select'),
      ('order_items', 'order_items_auth_select'),
      ('orders', 'orders_auth_select'),
      ('price_books', 'price_books_auth_select'),
      ('print_templates', 'print_templates_auth_select'),
      ('product_prices', 'product_prices_auth_select'),
      ('products', 'products_auth_select'),
      ('suppliers', 'suppliers_auth_select'),
      ('warehouses', 'warehouses_auth_select')
    ) AS policies(table_name, policy_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', old_policy, tenant_table);
    EXECUTE format('DROP POLICY IF EXISTS store_member_select ON public.%I', tenant_table);
    EXECUTE format(
      'CREATE POLICY store_member_select ON public.%I FOR SELECT TO authenticated USING (store_id = public.current_active_store_id())',
      tenant_table
    );
  END LOOP;
END $$;
