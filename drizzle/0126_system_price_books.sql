ALTER TABLE public.price_books ADD COLUMN system_type text;
--> statement-breakpoint
UPDATE public.price_books SET system_type = 'retail' WHERE is_default;
UPDATE public.price_books SET system_type = 'cost' WHERE cost_based AND system_type IS NULL;
UPDATE public.price_books SET system_type = 'purchase'
WHERE lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = lower('Giá Chưa Chiết Khấu')
  AND system_type IS NULL;
--> statement-breakpoint
-- Keep existing IDs, so draft selections and historical references remain valid.
INSERT INTO public.price_books(store_id, name, is_default, manager_only, cost_based, system_type, sort_order)
SELECT s.id, seed.name, seed.kind = 'retail', seed.kind <> 'retail', seed.kind = 'cost', seed.kind, seed.position
FROM public.stores s CROSS JOIN (VALUES
  ('retail', 'Giá Chung', 0), ('cost', 'Giá vốn', 1), ('purchase', 'Giá Chưa Chiết Khấu', 2)
) seed(kind, name, position)
WHERE NOT EXISTS (SELECT 1 FROM public.price_books b WHERE b.store_id = s.id AND b.system_type = seed.kind);
UPDATE public.price_books SET
  name = CASE system_type WHEN 'retail' THEN 'Giá Chung' WHEN 'cost' THEN 'Giá vốn' ELSE 'Giá Chưa Chiết Khấu' END,
  is_default = system_type = 'retail', manager_only = system_type <> 'retail', cost_based = system_type = 'cost',
  sort_order = CASE system_type WHEN 'retail' THEN 0 WHEN 'cost' THEN 1 ELSE 2 END
WHERE system_type IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX price_books_store_system_unique ON public.price_books(store_id, system_type) WHERE system_type IS NOT NULL;
ALTER TABLE public.price_books ADD CONSTRAINT price_books_system_type_check CHECK (
  CASE WHEN system_type IS NULL THEN NOT is_default AND NOT cost_based ELSE
  (system_type = 'retail' AND is_default AND NOT manager_only AND NOT cost_based AND name = 'Giá Chung')
  OR (system_type = 'cost' AND NOT is_default AND manager_only AND cost_based AND name = 'Giá vốn')
  OR (system_type = 'purchase' AND NOT is_default AND manager_only AND NOT cost_based AND name = 'Giá Chưa Chiết Khấu') END
);
--> statement-breakpoint
CREATE FUNCTION public.protect_system_price_book() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.system_type IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_PRICE_BOOK_READ_ONLY' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.system_type IS NOT NULL AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    RAISE EXCEPTION 'SYSTEM_PRICE_BOOK_READ_ONLY' USING ERRCODE = '23514';
  END IF;
  IF NEW.system_type IS NULL AND lower(regexp_replace(btrim(NEW.name), '\s+', ' ', 'g')) IN (lower('Giá Chung'), lower('Giá vốn'), lower('Giá Chưa Chiết Khấu')) THEN
    RAISE EXCEPTION 'SYSTEM_PRICE_BOOK_NAME_RESERVED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_system_price_book() FROM PUBLIC;
CREATE TRIGGER protect_system_price_book BEFORE INSERT OR UPDATE OR DELETE ON public.price_books FOR EACH ROW EXECUTE FUNCTION public.protect_system_price_book();
--> statement-breakpoint
CREATE FUNCTION public.protect_system_product_price() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.price_books WHERE id = NEW.price_book_id AND store_id = NEW.store_id AND system_type IS NOT NULL) THEN
    RAISE EXCEPTION 'SYSTEM_PRICE_BOOK_READ_ONLY' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_system_product_price() FROM PUBLIC;
CREATE TRIGGER protect_system_product_price BEFORE INSERT OR UPDATE ON public.product_prices FOR EACH ROW EXECUTE FUNCTION public.protect_system_product_price();
--> statement-breakpoint
CREATE FUNCTION public.create_store_system_price_books() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.price_books(store_id, name, is_default, manager_only, cost_based, system_type, sort_order)
  VALUES (NEW.id, 'Giá Chung', true, false, false, 'retail', 0),
    (NEW.id, 'Giá vốn', false, true, true, 'cost', 1),
    (NEW.id, 'Giá Chưa Chiết Khấu', false, true, false, 'purchase', 2);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.create_store_system_price_books() FROM PUBLIC;
CREATE TRIGGER create_store_system_price_books AFTER INSERT ON public.stores FOR EACH ROW EXECUTE FUNCTION public.create_store_system_price_books();
--> statement-breakpoint
-- Direct mobile catalog reads obey the same visibility rule as the server API.
DROP POLICY IF EXISTS store_member_select ON public.price_books;
CREATE POLICY store_member_select ON public.price_books FOR SELECT TO authenticated USING (
  store_id = public.current_active_store_id() AND (NOT manager_only OR EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.store_id = price_books.store_id AND p.is_active AND p.role IN ('owner', 'manager')
  ))
);
DROP POLICY IF EXISTS store_member_select ON public.product_prices;
CREATE POLICY store_member_select ON public.product_prices FOR SELECT TO authenticated USING (
  store_id = public.current_active_store_id() AND EXISTS (
    SELECT 1 FROM public.price_books b WHERE b.id = product_prices.price_book_id AND b.store_id = product_prices.store_id AND b.system_type IS NULL
  )
);
