ALTER TABLE public.media_migration_items
  DROP CONSTRAINT media_migration_items_purpose_check;
--> statement-breakpoint

ALTER TABLE public.media_migration_items
  ADD CONSTRAINT media_migration_items_purpose_check
  CHECK (purpose IN (
    'product-image',
    'project-document',
    'service-evidence',
    'ai-attachment',
    'library-asset'
  ));
