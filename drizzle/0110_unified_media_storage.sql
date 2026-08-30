CREATE TABLE "media_objects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "provider" text DEFAULT 'r2' NOT NULL,
  "visibility" text NOT NULL,
  "domain" text NOT NULL,
  "bucket" text NOT NULL,
  "object_key" text NOT NULL,
  "original_file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" varchar(64),
  "width" integer,
  "height" integer,
  "thumbnail_object_key" text,
  "thumbnail_size_bytes" bigint,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "ready_at" timestamptz,
  "verified_at" timestamptz,
  "deleted_at" timestamptz,
  "legacy_bucket" text,
  "legacy_path" text,
  "legacy_url" text,
  CONSTRAINT "media_objects_provider_check" CHECK ("provider" IN ('r2','supabase')),
  CONSTRAINT "media_objects_visibility_check" CHECK ("visibility" IN ('public','private')),
  CONSTRAINT "media_objects_status_check" CHECK ("status" IN ('pending','ready','quarantined','deleted')),
  CONSTRAINT "media_objects_size_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "media_objects_location_unique" UNIQUE ("provider","bucket","object_key"),
  CONSTRAINT "media_objects_store_id_id_unique" UNIQUE ("store_id","id")
);--> statement-breakpoint

CREATE TABLE "product_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL,
  "media_object_id" uuid NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "product_media_product_unique" UNIQUE ("product_id","media_object_id"),
  CONSTRAINT "product_media_sort_order_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "product_media_product_tenant_fk" FOREIGN KEY ("store_id","product_id")
    REFERENCES "products"("store_id","id") ON DELETE CASCADE,
  CONSTRAINT "product_media_object_tenant_fk" FOREIGN KEY ("store_id","media_object_id")
    REFERENCES "media_objects"("store_id","id") ON DELETE NO ACTION
);--> statement-breakpoint

CREATE UNIQUE INDEX "product_media_active_primary_unique"
  ON "product_media" ("product_id")
  WHERE "is_primary" = true AND "deleted_at" IS NULL;--> statement-breakpoint

CREATE INDEX "product_media_store_product_order_idx"
  ON "product_media" ("store_id","product_id","sort_order")
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

CREATE TABLE "service_handover_document_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL,
  "media_object_id" uuid NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "service_handover_document_media_unique" UNIQUE ("document_id","media_object_id"),
  CONSTRAINT "service_handover_document_media_sort_order_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "service_handover_document_media_document_tenant_fk" FOREIGN KEY ("store_id","document_id")
    REFERENCES "service_handover_documents"("store_id","id") ON DELETE CASCADE,
  CONSTRAINT "service_handover_document_media_object_tenant_fk" FOREIGN KEY ("store_id","media_object_id")
    REFERENCES "media_objects"("store_id","id") ON DELETE NO ACTION
);--> statement-breakpoint

CREATE INDEX "service_handover_document_media_store_document_order_idx"
  ON "service_handover_document_media" ("store_id","document_id","sort_order");--> statement-breakpoint

CREATE TABLE "media_migration_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'pending' NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "last_error" text,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "media_migration_runs_status_check" CHECK ("status" IN ('pending','running','completed','failed','rolled_back')),
  CONSTRAINT "media_migration_runs_store_id_id_unique" UNIQUE ("store_id","id")
);--> statement-breakpoint

CREATE INDEX "media_migration_runs_store_status_idx"
  ON "media_migration_runs" ("store_id","status","created_at");--> statement-breakpoint

CREATE TABLE "media_migration_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "run_id" uuid NOT NULL,
  "source_provider" text NOT NULL,
  "source_bucket" text NOT NULL,
  "source_key" text NOT NULL,
  "media_object_id" uuid,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "media_migration_items_source_provider_check" CHECK ("source_provider" IN ('r2','supabase')),
  CONSTRAINT "media_migration_items_status_check" CHECK ("status" IN ('pending','copied','verified','failed','rolled_back')),
  CONSTRAINT "media_migration_items_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "media_migration_items_source_unique" UNIQUE ("run_id","source_provider","source_bucket","source_key"),
  CONSTRAINT "media_migration_items_run_tenant_fk" FOREIGN KEY ("store_id","run_id")
    REFERENCES "media_migration_runs"("store_id","id") ON DELETE CASCADE,
  CONSTRAINT "media_migration_items_object_tenant_fk" FOREIGN KEY ("store_id","media_object_id")
    REFERENCES "media_objects"("store_id","id") ON DELETE NO ACTION
);--> statement-breakpoint

CREATE INDEX "media_migration_items_store_status_idx"
  ON "media_migration_items" ("store_id","status","updated_at");--> statement-breakpoint

ALTER TABLE "brands"
  ADD COLUMN "logo_media_object_id" uuid;--> statement-breakpoint

ALTER TABLE "brands"
  ADD CONSTRAINT "brands_logo_media_object_tenant_fk"
  FOREIGN KEY ("store_id","logo_media_object_id")
  REFERENCES "media_objects"("store_id","id") ON DELETE NO ACTION;--> statement-breakpoint

ALTER TABLE "service_attachments"
  ADD COLUMN "media_object_id" uuid,
  ADD COLUMN "project_phase" text;--> statement-breakpoint

ALTER TABLE "service_attachments"
  ADD CONSTRAINT "service_attachments_project_phase_check"
  CHECK ("project_phase" IS NULL OR "project_phase" IN ('survey','construction','after_installation','acceptance','handover','other')),
  ADD CONSTRAINT "service_attachments_media_object_tenant_fk"
  FOREIGN KEY ("store_id","media_object_id")
  REFERENCES "media_objects"("store_id","id") ON DELETE NO ACTION;--> statement-breakpoint

ALTER TABLE "service_customer_request_attachments"
  ADD COLUMN "media_object_id" uuid;--> statement-breakpoint

ALTER TABLE "service_customer_request_attachments"
  ADD CONSTRAINT "service_customer_request_attachments_media_object_tenant_fk"
  FOREIGN KEY ("store_id","media_object_id")
  REFERENCES "media_objects"("store_id","id") ON DELETE NO ACTION;--> statement-breakpoint

CREATE INDEX "media_objects_store_status_domain_idx"
  ON "media_objects" ("store_id","status","domain","created_at");--> statement-breakpoint

CREATE INDEX "brands_logo_media_object_idx"
  ON "brands" ("logo_media_object_id")
  WHERE "logo_media_object_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "service_attachments_media_object_idx"
  ON "service_attachments" ("media_object_id")
  WHERE "media_object_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "service_customer_request_attachments_media_object_idx"
  ON "service_customer_request_attachments" ("media_object_id")
  WHERE "media_object_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "media_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_handover_document_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_migration_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_migration_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE "media_objects", "product_media", "service_handover_document_media", "media_migration_runs", "media_migration_items" FROM anon;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE "media_objects", "product_media", "service_handover_document_media", "media_migration_runs", "media_migration_items" FROM authenticated;--> statement-breakpoint
GRANT SELECT ON TABLE "media_objects", "product_media", "service_handover_document_media", "media_migration_runs", "media_migration_items" TO authenticated;--> statement-breakpoint

CREATE POLICY "store_member_select" ON "media_objects" FOR SELECT TO authenticated
USING (store_id = public.current_active_store_id());--> statement-breakpoint

CREATE POLICY "store_member_select" ON "product_media" FOR SELECT TO authenticated
USING (store_id = public.current_active_store_id());--> statement-breakpoint

CREATE POLICY "store_member_select" ON "service_handover_document_media" FOR SELECT TO authenticated
USING (store_id = public.current_active_store_id());--> statement-breakpoint

CREATE POLICY "store_member_select" ON "media_migration_runs" FOR SELECT TO authenticated
USING (store_id = public.current_active_store_id());--> statement-breakpoint

CREATE POLICY "store_member_select" ON "media_migration_items" FOR SELECT TO authenticated
USING (store_id = public.current_active_store_id());
