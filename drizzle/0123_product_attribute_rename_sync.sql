-- Incremental product readers use updated_at; renaming an attribute must also
-- make its products visible to clients requesting changes since their last sync.
CREATE OR REPLACE FUNCTION public.rename_product_attribute(target_store uuid, target_id uuid, next_name text) RETURNS boolean
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;
  UPDATE public.product_attributes SET name = next_name WHERE store_id = target_store AND id = target_id;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.products p SET specs = p.specs, updated_at = clock_timestamp()
    WHERE p.store_id = target_store AND EXISTS (
      SELECT 1 FROM public.product_attribute_products u
      WHERE u.store_id = target_store AND u.attribute_id = target_id AND u.product_id = p.id
    );
  RETURN true;
END $$;
