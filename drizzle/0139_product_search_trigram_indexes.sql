-- Use one immutable normalizer for both product lookup predicates and their
-- trigram indexes. NFD removes Vietnamese tone marks and preserves the same
-- accent-insensitive behavior as the client-side search normalizer.
CREATE OR REPLACE FUNCTION normalize_vietnamese_search_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT replace(
    regexp_replace(normalize(lower(input), NFD), U&'[\0300-\036F]', '', 'g'),
    'đ',
    'd'
  )
$function$;
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_search_name_trgm_idx"
  ON "products" USING gin (normalize_vietnamese_search_text("name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_search_sku_trgm_idx"
  ON "products" USING gin (normalize_vietnamese_search_text("sku") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_search_barcode_trgm_idx"
  ON "products" USING gin (normalize_vietnamese_search_text("barcode") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_search_base_unit_trgm_idx"
  ON "products" USING gin (normalize_vietnamese_search_text("base_unit") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_search_variant_name_trgm_idx"
  ON "products" USING gin (normalize_vietnamese_search_text("variant_name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_search_specs_trgm_idx"
  ON "products" USING gin (normalize_vietnamese_search_text("specs"::text) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "product_units_search_name_trgm_idx"
  ON "product_units" USING gin (normalize_vietnamese_search_text("unit_name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "product_units_search_sku_trgm_idx"
  ON "product_units" USING gin (normalize_vietnamese_search_text("sku") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "product_units_search_barcode_trgm_idx"
  ON "product_units" USING gin (normalize_vietnamese_search_text("barcode") gin_trgm_ops);
