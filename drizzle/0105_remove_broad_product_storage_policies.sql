-- These legacy policies OR-ed with tenant policies and therefore allowed any
-- authenticated account to mutate any object in the public products bucket.
-- Public reads remain available through the bucket's public setting; writes
-- now require the stores/{storeId}/ prefix and active membership from 0104.
DROP POLICY IF EXISTS "products_authenticated_write" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "products_bucket_insert" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "products_authenticated_update" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "products_authenticated_delete" ON storage.objects;
