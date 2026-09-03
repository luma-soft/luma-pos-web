-- Additive group metadata. Products, KiotViet links and stock history are not rewritten.
CREATE TABLE public.product_variant_groups (
  store_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('native', 'related')),
  attributes jsonb NOT NULL DEFAULT '[]',
  excluded_combination_keys jsonb NOT NULL DEFAULT '[]',
  requires_review boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, id),
  FOREIGN KEY (store_id, id) REFERENCES public.products(store_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(attributes) = 'array'),
  CHECK (jsonb_typeof(excluded_combination_keys) = 'array')
);
--> statement-breakpoint
CREATE TABLE public.product_variant_members (
  store_id uuid NOT NULL,
  group_id uuid NOT NULL,
  product_id uuid NOT NULL,
  combination_key text,
  option_value_ids jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (store_id, product_id),
  FOREIGN KEY (store_id, group_id) REFERENCES public.product_variant_groups(store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, product_id) REFERENCES public.products(store_id, id) ON DELETE CASCADE,
  UNIQUE (store_id, group_id, combination_key)
);
--> statement-breakpoint
CREATE TABLE public.product_variant_group_attributes (
  store_id uuid NOT NULL,
  group_id uuid NOT NULL,
  attribute_id uuid NOT NULL,
  PRIMARY KEY (store_id, group_id, attribute_id),
  FOREIGN KEY (store_id, group_id) REFERENCES public.product_variant_groups(store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, attribute_id) REFERENCES public.product_attributes(store_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX product_variant_group_attributes_usage_idx ON public.product_variant_group_attributes(store_id, attribute_id);
--> statement-breakpoint
CREATE TABLE public.product_variant_requests (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  group_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, request_id),
  FOREIGN KEY (store_id, group_id) REFERENCES public.product_variant_groups(store_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX product_variant_requests_group_idx ON public.product_variant_requests(store_id, group_id);
--> statement-breakpoint
INSERT INTO public.product_variant_groups(store_id, id, kind)
SELECT p.store_id, p.id, CASE WHEN p.is_variant_parent THEN 'native' ELSE 'related' END
FROM public.products p
WHERE p.is_variant_parent OR EXISTS (
  SELECT 1 FROM public.products c WHERE c.store_id = p.store_id AND c.related_product_id = p.id
);
--> statement-breakpoint
INSERT INTO public.product_variant_members(store_id, group_id, product_id)
SELECT g.store_id, g.id, p.id
FROM public.product_variant_groups g
JOIN public.products p ON p.store_id = g.store_id AND
  ((g.kind = 'native' AND p.parent_product_id = g.id)
   OR (g.kind = 'related' AND (p.related_product_id = g.id OR p.id = g.id)));
--> statement-breakpoint
-- Stable value IDs derive from the catalog ID and the existing value. Display
-- names can subsequently change without modifying these identities.
WITH entries AS (
  SELECT m.store_id, m.group_id, a.attribute_id, c.name, val.value,
    md5(a.attribute_id::text || ':' || val.value)::uuid::text AS value_id
  FROM public.product_variant_members m
  JOIN public.products p ON p.store_id = m.store_id AND p.id = m.product_id
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(p.specs) = 'object' THEN p.specs ELSE '{}'::jsonb END) e
  JOIN public.product_attribute_aliases a ON a.store_id = p.store_id AND a.name_key = public.product_attribute_name_key(e.key)
  JOIN public.product_attributes c ON c.store_id = a.store_id AND c.id = a.attribute_id
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.value) = 'array' THEN e.value ELSE '[]'::jsonb END) val(value)
), axes AS (
  SELECT store_id, group_id, attribute_id, name,
    jsonb_agg(value ORDER BY value) AS values,
    jsonb_agg(value_id ORDER BY value) AS value_ids
  FROM (SELECT DISTINCT * FROM entries) e GROUP BY store_id, group_id, attribute_id, name
), definitions AS (
  SELECT store_id, group_id, jsonb_agg(jsonb_build_object(
    'attributeId', attribute_id::text, 'name', name, 'values', values,
    'valueIds', value_ids, 'createsVariants', true) ORDER BY attribute_id) AS attributes
  FROM axes GROUP BY store_id, group_id
)
UPDATE public.product_variant_groups g SET attributes = d.attributes
FROM definitions d WHERE g.store_id = d.store_id AND g.id = d.group_id;
--> statement-breakpoint
INSERT INTO public.product_variant_group_attributes(store_id, group_id, attribute_id)
SELECT g.store_id, g.id, (a->>'attributeId')::uuid
FROM public.product_variant_groups g CROSS JOIN LATERAL jsonb_array_elements(g.attributes) a;
--> statement-breakpoint
-- Incomplete/multivalued imported selections stay visible but require explicit
-- assignment before group editing. Never synthesize missing product rows.
WITH selections AS (
  SELECT m.store_id, m.group_id, m.product_id, a.attribute_id::text AS aid,
    md5(a.attribute_id::text || ':' || (e.value->>0))::uuid::text AS vid
  FROM public.product_variant_members m
  JOIN public.products p ON p.store_id=m.store_id AND p.id=m.product_id
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(p.specs)='object' THEN p.specs ELSE '{}'::jsonb END) e
  JOIN public.product_attribute_aliases a ON a.store_id=p.store_id AND a.name_key=public.product_attribute_name_key(e.key)
  WHERE jsonb_typeof(e.value)='array' AND jsonb_array_length(e.value)=1
), signatures AS (
  SELECT store_id, group_id, product_id,
    replace(jsonb_agg(jsonb_build_array(aid,vid) ORDER BY aid)::text, ' ', '') AS key,
    jsonb_agg(vid ORDER BY aid) AS ids, count(*) AS axis_count
  FROM selections GROUP BY store_id, group_id, product_id
), unique_signatures AS (
  SELECT *, count(*) OVER (PARTITION BY store_id, group_id, key) AS duplicates FROM signatures
)
UPDATE public.product_variant_members m SET combination_key=s.key, option_value_ids=s.ids
FROM unique_signatures s JOIN public.product_variant_groups g ON g.store_id=s.store_id AND g.id=s.group_id
WHERE m.store_id=s.store_id AND m.product_id=s.product_id
  AND s.duplicates=1 AND s.axis_count=jsonb_array_length(g.attributes) AND s.axis_count>0;
--> statement-breakpoint
UPDATE public.product_variant_groups g SET requires_review = EXISTS (
  SELECT 1 FROM public.product_variant_members m WHERE m.store_id=g.store_id AND m.group_id=g.id AND m.combination_key IS NULL
) OR jsonb_array_length(g.attributes)=0;
--> statement-breakpoint
ALTER TABLE public.product_variant_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variant_group_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variant_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_variant_groups, public.product_variant_members, public.product_variant_group_attributes, public.product_variant_requests FROM anon, authenticated;
