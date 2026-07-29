DROP INDEX IF EXISTS "service_visits_profile_active_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "service_visits_job_profile_active_idx"
  ON "service_visits" ("job_id", "profile_id")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "service_time_entries_visit_open_idx"
  ON "service_time_entries" ("visit_id")
  WHERE "visit_id" IS NOT NULL AND "ended_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_service_field_job_mutable"(target_job_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  job_status service_job_status;
BEGIN
  IF target_job_id IS NULL THEN
    RETURN;
  END IF;

  SELECT "status"
  INTO job_status
  FROM "service_jobs"
  WHERE "id" = target_job_id
  FOR UPDATE;

  IF FOUND AND job_status = 'completed' THEN
    RAISE EXCEPTION 'SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED';
  END IF;
  IF FOUND AND job_status = 'cancelled' THEN
    RAISE EXCEPTION 'SERVICE_FIELD_JOB_TERMINAL';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_service_job_checklist_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."checklist" IS DISTINCT FROM NEW."checklist"
    AND OLD."status" IN ('completed', 'cancelled')
  THEN
    RAISE EXCEPTION 'SERVICE_FIELD_JOB_TERMINAL';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_jobs_guard_terminal_checklist"
  BEFORE UPDATE ON "service_jobs"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_service_job_checklist_mutation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_service_asset_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_job_id uuid;
  business_changed boolean := true;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    business_changed := (
      OLD."project_id" IS DISTINCT FROM NEW."project_id"
      OR OLD."job_id" IS DISTINCT FROM NEW."job_id"
      OR OLD."product_id" IS DISTINCT FROM NEW."product_id"
      OR OLD."asset_kind" IS DISTINCT FROM NEW."asset_kind"
      OR OLD."name" IS DISTINCT FROM NEW."name"
      OR OLD."brand" IS DISTINCT FROM NEW."brand"
      OR OLD."model" IS DISTINCT FROM NEW."model"
      OR OLD."serial_number" IS DISTINCT FROM NEW."serial_number"
      OR OLD."mac_address" IS DISTINCT FROM NEW."mac_address"
      OR OLD."ip_address" IS DISTINCT FROM NEW."ip_address"
      OR OLD."location_label" IS DISTINCT FROM NEW."location_label"
      OR OLD."installed_at" IS DISTINCT FROM NEW."installed_at"
      OR OLD."customer_warranty_ends_on" IS DISTINCT FROM NEW."customer_warranty_ends_on"
      OR OLD."supplier_warranty_ends_on" IS DISTINCT FROM NEW."supplier_warranty_ends_on"
      OR OLD."status" IS DISTINCT FROM NEW."status"
      OR OLD."note" IS DISTINCT FROM NEW."note"
      OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
    );
  END IF;

  IF business_changed THEN
    target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."job_id" ELSE NEW."job_id" END;
    PERFORM "assert_service_field_job_mutable"(target_job_id);
    IF TG_OP = 'UPDATE' AND OLD."job_id" IS DISTINCT FROM NEW."job_id" THEN
      PERFORM "assert_service_field_job_mutable"(OLD."job_id");
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "installed_assets_guard_terminal_job"
  BEFORE INSERT OR UPDATE OR DELETE ON "installed_assets"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_service_asset_mutation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_service_material_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_job_id uuid;
BEGIN
  target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."job_id" ELSE NEW."job_id" END;
  PERFORM "assert_service_field_job_mutable"(target_job_id);
  IF TG_OP = 'UPDATE' AND OLD."job_id" IS DISTINCT FROM NEW."job_id" THEN
    PERFORM "assert_service_field_job_mutable"(OLD."job_id");
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_job_materials_guard_terminal_job"
  BEFORE INSERT OR UPDATE OR DELETE ON "service_job_materials"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_service_material_mutation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_service_attachment_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_job_id uuid;
  business_changed boolean := true;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    business_changed := (
      OLD."project_id" IS DISTINCT FROM NEW."project_id"
      OR OLD."job_id" IS DISTINCT FROM NEW."job_id"
      OR OLD."request_id" IS DISTINCT FROM NEW."request_id"
      OR OLD."category" IS DISTINCT FROM NEW."category"
      OR OLD."bucket" IS DISTINCT FROM NEW."bucket"
      OR OLD."path" IS DISTINCT FROM NEW."path"
      OR OLD."file_name" IS DISTINCT FROM NEW."file_name"
      OR OLD."mime_type" IS DISTINCT FROM NEW."mime_type"
      OR OLD."size_bytes" IS DISTINCT FROM NEW."size_bytes"
      OR OLD."sha256" IS DISTINCT FROM NEW."sha256"
      OR OLD."caption" IS DISTINCT FROM NEW."caption"
      OR OLD."created_by" IS DISTINCT FROM NEW."created_by"
      OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
      OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
      OR OLD."deleted_by" IS DISTINCT FROM NEW."deleted_by"
    );
  END IF;

  IF business_changed THEN
    target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."job_id" ELSE NEW."job_id" END;
    PERFORM "assert_service_field_job_mutable"(target_job_id);
    IF TG_OP = 'UPDATE' AND OLD."job_id" IS DISTINCT FROM NEW."job_id" THEN
      PERFORM "assert_service_field_job_mutable"(OLD."job_id");
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_attachments_guard_terminal_job"
  BEFORE INSERT OR UPDATE OR DELETE ON "service_attachments"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_service_attachment_mutation"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_service_field_job_mutable"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_job_checklist_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_asset_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_material_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_attachment_mutation"() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "assert_service_field_job_mutable"(uuid) FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_job_checklist_mutation"() FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_asset_mutation"() FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_material_mutation"() FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_attachment_mutation"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "assert_service_field_job_mutable"(uuid) FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_job_checklist_mutation"() FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_asset_mutation"() FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_material_mutation"() FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_attachment_mutation"() FROM authenticated;
  END IF;
END $$;
