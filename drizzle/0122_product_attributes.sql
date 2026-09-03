-- Attribute names have stable identities. Legacy specs writers (including
-- KiotViet imports and mobile) keep working through the product triggers.
CREATE FUNCTION public.product_attribute_name_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT lower(btrim(regexp_replace(value, '[[:space:]]+', ' ', 'g')))
$$;
--> statement-breakpoint
CREATE TABLE public.product_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_key text GENERATED ALWAYS AS (public.product_attribute_name_key(name)) STORED,
  CONSTRAINT product_attributes_name_check CHECK (name_key <> '' AND left(name_key, 2) <> '__'),
  CONSTRAINT product_attributes_store_name_unique UNIQUE (store_id, name_key),
  CONSTRAINT product_attributes_store_id_unique UNIQUE (store_id, id)
);
--> statement-breakpoint
CREATE TABLE public.product_attribute_aliases (
  store_id uuid NOT NULL,
  name_key text NOT NULL,
  attribute_id uuid NOT NULL,
  PRIMARY KEY (store_id, name_key),
  CONSTRAINT product_attribute_aliases_attribute_fk FOREIGN KEY (store_id, attribute_id)
    REFERENCES public.product_attributes(store_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX product_attribute_aliases_attribute_idx ON public.product_attribute_aliases(store_id, attribute_id);
--> statement-breakpoint
CREATE TABLE public.product_attribute_products (
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  attribute_id uuid NOT NULL,
  PRIMARY KEY (store_id, product_id, attribute_id),
  CONSTRAINT product_attribute_products_product_fk FOREIGN KEY (store_id, product_id)
    REFERENCES public.products(store_id, id) ON DELETE CASCADE,
  CONSTRAINT product_attribute_products_attribute_fk FOREIGN KEY (store_id, attribute_id)
    REFERENCES public.product_attributes(store_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX product_attribute_products_usage_idx ON public.product_attribute_products(store_id, attribute_id);
--> statement-breakpoint
CREATE FUNCTION public.register_product_attribute_alias() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE existing_id uuid;
BEGIN
  INSERT INTO public.product_attribute_aliases(store_id, name_key, attribute_id)
    VALUES (NEW.store_id, NEW.name_key, NEW.id)
    ON CONFLICT (store_id, name_key) DO NOTHING;
  SELECT attribute_id INTO existing_id FROM public.product_attribute_aliases
    WHERE store_id = NEW.store_id AND name_key = NEW.name_key;
  IF existing_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Attribute name already exists' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER product_attribute_alias_insert AFTER INSERT ON public.product_attributes
FOR EACH ROW EXECUTE FUNCTION public.register_product_attribute_alias();
--> statement-breakpoint
CREATE TRIGGER product_attribute_alias_rename AFTER UPDATE OF name ON public.product_attributes
FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION public.register_product_attribute_alias();
--> statement-breakpoint
-- Backfill the catalog and references only: do not rewrite imported products.
INSERT INTO public.product_attributes(store_id, name)
SELECT DISTINCT ON (p.store_id, public.product_attribute_name_key(k.name)) p.store_id, k.name
FROM public.products p
CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(p.specs) = 'object' THEN p.specs ELSE '{}'::jsonb END) k(name)
WHERE public.product_attribute_name_key(k.name) <> '' AND left(k.name, 2) <> '__'
ORDER BY p.store_id, public.product_attribute_name_key(k.name), k.name;
--> statement-breakpoint
INSERT INTO public.product_attribute_products(store_id, product_id, attribute_id)
SELECT DISTINCT p.store_id, p.id, a.attribute_id
FROM public.products p
CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(p.specs) = 'object' THEN p.specs ELSE '{}'::jsonb END) k(name)
JOIN public.product_attribute_aliases a ON a.store_id = p.store_id
  AND a.name_key = public.product_attribute_name_key(k.name);
--> statement-breakpoint
CREATE FUNCTION public.normalize_product_attribute_specs() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE item record; attr_id uuid; canonical_name text; normalized jsonb := '{}'::jsonb; key_name text;
BEGIN
  IF NEW.specs IS NULL OR jsonb_typeof(NEW.specs) <> 'object' THEN RETURN NEW; END IF;
  FOR item IN SELECT key, value FROM jsonb_each(NEW.specs) ORDER BY key LOOP
    IF left(item.key, 2) = '__' THEN
      normalized := normalized || jsonb_build_object(item.key, item.value);
      CONTINUE;
    END IF;
    key_name := public.product_attribute_name_key(item.key);
    SELECT attribute_id INTO attr_id FROM public.product_attribute_aliases
      WHERE store_id = NEW.store_id AND name_key = key_name;
    IF attr_id IS NULL THEN
      INSERT INTO public.product_attributes(store_id, name)
        VALUES (NEW.store_id, btrim(regexp_replace(item.key, '[[:space:]]+', ' ', 'g')))
        ON CONFLICT (store_id, name_key) DO UPDATE SET name = product_attributes.name
        RETURNING id INTO attr_id;
    END IF;
    SELECT name INTO canonical_name FROM public.product_attributes
      WHERE store_id = NEW.store_id AND id = attr_id;
    IF normalized ? canonical_name AND normalized -> canonical_name IS DISTINCT FROM item.value THEN
      RAISE EXCEPTION 'Duplicate attribute has conflicting values' USING ERRCODE = '23514';
    END IF;
    normalized := normalized || jsonb_build_object(canonical_name, item.value);
  END LOOP;
  NEW.specs := normalized;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.sync_product_attribute_usage() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  DELETE FROM public.product_attribute_products WHERE store_id = NEW.store_id AND product_id = NEW.id;
  INSERT INTO public.product_attribute_products(store_id, product_id, attribute_id)
    SELECT DISTINCT NEW.store_id, NEW.id, a.attribute_id
    FROM jsonb_object_keys(CASE WHEN jsonb_typeof(NEW.specs) = 'object' THEN NEW.specs ELSE '{}'::jsonb END) k(name)
    JOIN public.product_attribute_aliases a ON a.store_id = NEW.store_id
      AND a.name_key = public.product_attribute_name_key(k.name);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER product_attribute_specs_insert BEFORE INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.normalize_product_attribute_specs();
--> statement-breakpoint
CREATE TRIGGER product_attribute_specs_update BEFORE UPDATE OF specs ON public.products
FOR EACH ROW EXECUTE FUNCTION public.normalize_product_attribute_specs();
--> statement-breakpoint
CREATE TRIGGER product_attribute_usage_insert AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.sync_product_attribute_usage();
--> statement-breakpoint
CREATE TRIGGER product_attribute_usage_update AFTER UPDATE OF specs ON public.products
FOR EACH ROW WHEN (OLD.specs IS DISTINCT FROM NEW.specs) EXECUTE FUNCTION public.sync_product_attribute_usage();
--> statement-breakpoint
CREATE FUNCTION public.rename_product_attribute(target_store uuid, target_id uuid, next_name text) RETURNS boolean
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- A rare catalog rename must finish together with all product keys. Acquire
  -- the table lock before catalog row locks to serialize against legacy writers.
  LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;
  UPDATE public.product_attributes SET name = next_name WHERE store_id = target_store AND id = target_id;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.products p SET specs = p.specs
    WHERE p.store_id = target_store AND EXISTS (
      SELECT 1 FROM public.product_attribute_products u
      WHERE u.store_id = target_store AND u.attribute_id = target_id AND u.product_id = p.id
    );
  RETURN true;
END $$;
--> statement-breakpoint
ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attribute_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attribute_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_attributes, public.product_attribute_aliases, public.product_attribute_products FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.rename_product_attribute(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_product_attribute_alias(), public.normalize_product_attribute_specs(), public.sync_product_attribute_usage() FROM PUBLIC, anon, authenticated;
