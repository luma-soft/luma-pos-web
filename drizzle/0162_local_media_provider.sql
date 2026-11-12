ALTER TABLE public.media_objects
  DROP CONSTRAINT media_objects_provider_check,
  ADD CONSTRAINT media_objects_provider_check
    CHECK (provider IN ('local', 'r2', 'supabase'));
--> statement-breakpoint
ALTER TABLE public.media_migration_items
  DROP CONSTRAINT media_migration_items_source_provider_check,
  ADD CONSTRAINT media_migration_items_source_provider_check
    CHECK (source_provider IN ('local', 'r2', 'supabase', 'external'));
