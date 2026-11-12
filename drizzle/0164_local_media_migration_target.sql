ALTER TABLE public.media_migration_items
  ADD COLUMN target_provider text NOT NULL DEFAULT 'r2';
--> statement-breakpoint
ALTER TABLE public.media_migration_items
  ADD CONSTRAINT media_migration_items_target_provider_check
  CHECK (target_provider IN ('local', 'r2'));
