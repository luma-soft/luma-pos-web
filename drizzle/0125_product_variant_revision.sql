-- Invalidate open group editors when a SKU is edited through legacy/mobile,
-- price lists or imports. Stock changes are intentionally independent.
CREATE FUNCTION public.bump_product_variant_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.product_variant_groups g SET revision = revision + 1
  WHERE g.store_id = NEW.store_id AND g.id IN (
    NEW.id, NEW.parent_product_id, NEW.related_product_id,
    OLD.parent_product_id, OLD.related_product_id
  );
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER product_variant_revision AFTER UPDATE OF
  sku, barcode, name, variant_name, specs, cost_price, retail_price, wholesale_price,
  contractor_price, agent_price, base_unit, description, image_urls, is_active,
  category_id, brand_id, supplier_id, lifecycle_status,
  parent_product_id, related_product_id ON public.products
FOR EACH ROW WHEN (
  (OLD.sku, OLD.barcode, OLD.name, OLD.variant_name, OLD.specs, OLD.cost_price, OLD.retail_price,
   OLD.wholesale_price, OLD.contractor_price, OLD.agent_price, OLD.base_unit,
   OLD.description, OLD.image_urls, OLD.is_active, OLD.category_id, OLD.brand_id, OLD.supplier_id,
   OLD.lifecycle_status, OLD.parent_product_id, OLD.related_product_id)
  IS DISTINCT FROM
  (NEW.sku, NEW.barcode, NEW.name, NEW.variant_name, NEW.specs, NEW.cost_price, NEW.retail_price,
   NEW.wholesale_price, NEW.contractor_price, NEW.agent_price, NEW.base_unit,
   NEW.description, NEW.image_urls, NEW.is_active, NEW.category_id, NEW.brand_id, NEW.supplier_id,
   NEW.lifecycle_status, NEW.parent_product_id, NEW.related_product_id)
) EXECUTE FUNCTION public.bump_product_variant_revision();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bump_product_variant_revision() FROM PUBLIC, anon, authenticated;
