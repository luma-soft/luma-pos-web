ALTER TABLE "media_migration_items"
  DROP CONSTRAINT "media_migration_items_source_provider_check",
  DROP CONSTRAINT "media_migration_items_status_check";--> statement-breakpoint

UPDATE "media_migration_items"
SET "status" = 'inventoried'
WHERE "status" = 'pending';--> statement-breakpoint

ALTER TABLE "media_migration_items"
  ALTER COLUMN "status" SET DEFAULT 'inventoried',
  ADD COLUMN "target_bucket" text,
  ADD COLUMN "target_key" text,
  ADD COLUMN "purpose" text NOT NULL DEFAULT 'project-document',
  ADD COLUMN "target_id" uuid,
  ADD COLUMN "domain" text NOT NULL DEFAULT 'legacy',
  ADD COLUMN "visibility" text NOT NULL DEFAULT 'private',
  ADD COLUMN "original_file_name" text NOT NULL DEFAULT 'legacy-media',
  ADD COLUMN "mime_type" text NOT NULL DEFAULT 'application/octet-stream',
  ADD COLUMN "reference_documents" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "source_size_bytes" bigint,
  ADD COLUMN "source_sha256" varchar(64),
  ADD COLUMN "target_size_bytes" bigint,
  ADD COLUMN "target_sha256" varchar(64),
  ADD COLUMN "verified_at" timestamptz,
  ADD COLUMN "cutover_at" timestamptz,
  ADD COLUMN "source_deleted_at" timestamptz,
  ADD COLUMN "fallback_read_count" integer NOT NULL DEFAULT 0;--> statement-breakpoint

UPDATE "media_migration_items"
SET "target_id" = "store_id"
WHERE "target_id" IS NULL;--> statement-breakpoint

ALTER TABLE "media_migration_items"
  ADD CONSTRAINT "media_migration_items_source_provider_check"
    CHECK ("source_provider" IN ('r2','supabase','external')),
  ADD CONSTRAINT "media_migration_items_status_check"
    CHECK ("status" IN ('inventoried','copied','verified','cutover','source_deleted','quarantined','skipped','failed','rolled_back')),
  ADD CONSTRAINT "media_migration_items_visibility_check"
    CHECK ("visibility" IN ('public','private')),
  ADD CONSTRAINT "media_migration_items_purpose_check"
    CHECK ("purpose" IN ('product-image','project-document','service-evidence','ai-attachment')),
  ADD CONSTRAINT "media_migration_items_reference_documents_check"
    CHECK (jsonb_typeof("reference_documents") = 'array'),
  ADD CONSTRAINT "media_migration_items_source_size_check"
    CHECK ("source_size_bytes" IS NULL OR "source_size_bytes" > 0),
  ADD CONSTRAINT "media_migration_items_target_size_check"
    CHECK ("target_size_bytes" IS NULL OR "target_size_bytes" > 0),
  ADD CONSTRAINT "media_migration_items_source_sha_check"
    CHECK ("source_sha256" IS NULL OR "source_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "media_migration_items_target_sha_check"
    CHECK ("target_sha256" IS NULL OR "target_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "media_migration_items_fallback_reads_check"
    CHECK ("fallback_read_count" >= 0);--> statement-breakpoint

CREATE UNIQUE INDEX "media_migration_items_run_target_unique"
  ON "media_migration_items" ("run_id","target_bucket","target_key")
  WHERE "target_bucket" IS NOT NULL AND "target_key" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "media_migration_items_run_status_idx"
  ON "media_migration_items" ("run_id","status","updated_at");

CREATE INDEX "media_migration_items_store_purpose_target_idx"
  ON "media_migration_items" ("store_id","purpose","target_id");
