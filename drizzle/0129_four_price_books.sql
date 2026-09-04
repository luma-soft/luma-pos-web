-- Separate company catalogue prices from internal receipt prices. No internal
-- acquisition price is copied into the public company catalogue.
ALTER TABLE public.order_items ADD COLUMN price_book_name text;
ALTER TABLE public.order_items ADD COLUMN pre_discount_unit_price numeric(14,2);
ALTER TABLE public.order_items ADD COLUMN line_discount_mode text;
ALTER TABLE public.order_items ADD COLUMN line_discount_value numeric(14,2);
ALTER TABLE public.order_items ADD CONSTRAINT order_items_discount_snapshot_check CHECK (
  (pre_discount_unit_price IS NULL OR pre_discount_unit_price >= 0)
  AND (line_discount_mode IS NULL OR line_discount_mode IN ('pct','vnd'))
  AND (line_discount_value IS NULL OR line_discount_value >= 0)
);
-- Preserve the label actually referenced by historical invoices before rename.
UPDATE public.order_items i SET price_book_name = b.name
FROM public.price_books b WHERE i.price_book_id = b.id AND i.store_id = b.store_id;
--> statement-breakpoint
ALTER TABLE public.price_books DISABLE TRIGGER protect_system_price_book;
ALTER TABLE public.price_books DROP CONSTRAINT price_books_system_type_check;
UPDATE public.price_books SET
  name = CASE system_type WHEN 'cost' THEN 'Giá vốn' WHEN 'purchase' THEN 'Giá nhập cuối' ELSE 'Giá chung' END,
  sort_order = CASE system_type WHEN 'cost' THEN 0 WHEN 'purchase' THEN 1 ELSE 3 END
WHERE system_type IS NOT NULL;
INSERT INTO public.price_books(store_id,name,is_default,manager_only,cost_based,system_type,sort_order)
SELECT id,'Giá chưa chiết khấu',false,false,false,'list',2 FROM public.stores;
ALTER TABLE public.price_books ADD CONSTRAINT price_books_system_type_check CHECK (
  CASE WHEN system_type IS NULL THEN NOT is_default AND NOT cost_based ELSE
  (system_type = 'retail' AND is_default AND NOT manager_only AND NOT cost_based AND name = 'Giá chung')
  OR (system_type = 'cost' AND NOT is_default AND manager_only AND cost_based AND name = 'Giá vốn')
  OR (system_type = 'purchase' AND NOT is_default AND manager_only AND NOT cost_based AND name = 'Giá nhập cuối')
  OR (system_type = 'list' AND NOT is_default AND NOT manager_only AND NOT cost_based AND name = 'Giá chưa chiết khấu') END
);
ALTER TABLE public.price_books ENABLE TRIGGER protect_system_price_book;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.protect_system_price_book() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.system_type IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_PRICE_BOOK_READ_ONLY' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.system_type IS NOT NULL AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    RAISE EXCEPTION 'SYSTEM_PRICE_BOOK_READ_ONLY' USING ERRCODE = '23514';
  END IF;
  IF NEW.system_type IS NULL AND lower(regexp_replace(btrim(NEW.name), '\s+', ' ', 'g')) IN
    (lower('Giá chung'),lower('Giá vốn'),lower('Giá nhập cuối'),lower('Giá chưa chiết khấu')) THEN
    RAISE EXCEPTION 'SYSTEM_PRICE_BOOK_NAME_RESERVED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_system_price_book() FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.protect_system_product_price() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.price_books WHERE id = NEW.price_book_id AND store_id = NEW.store_id
    AND system_type IN ('cost','purchase','retail')) THEN
    RAISE EXCEPTION 'SYSTEM_PRICE_BOOK_READ_ONLY' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_system_product_price() FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.create_store_system_price_books() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.price_books(store_id,name,is_default,manager_only,cost_based,system_type,sort_order)
  VALUES (NEW.id,'Giá vốn',false,true,true,'cost',0),
    (NEW.id,'Giá nhập cuối',false,true,false,'purchase',1),
    (NEW.id,'Giá chưa chiết khấu',false,false,false,'list',2),
    (NEW.id,'Giá chung',true,false,false,'retail',3);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.create_store_system_price_books() FROM PUBLIC;
--> statement-breakpoint
DROP POLICY IF EXISTS store_member_select ON public.product_prices;
CREATE POLICY store_member_select ON public.product_prices FOR SELECT TO authenticated USING (
  store_id = public.current_active_store_id() AND EXISTS (
    SELECT 1 FROM public.price_books b WHERE b.id = product_prices.price_book_id AND b.store_id = product_prices.store_id
      AND (b.system_type IS NULL OR b.system_type = 'list')
  )
);
--> statement-breakpoint
CREATE INDEX purchase_order_items_store_product_receipt_idx ON public.purchase_order_items(store_id,product_id,purchase_order_id);
