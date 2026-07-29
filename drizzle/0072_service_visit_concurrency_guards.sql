CREATE OR REPLACE FUNCTION "assert_service_visit_jobs_actionable"(
  first_job_id uuid,
  second_job_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  expected_count integer;
  actual_count integer;
  all_actionable boolean;
BEGIN
  expected_count := CASE
    WHEN second_job_id IS NULL OR second_job_id = first_job_id THEN 1
    ELSE 2
  END;

  SELECT count(*)::integer,
         bool_and("status" IN ('new', 'scheduled', 'in_progress', 'warranty'))
  INTO actual_count, all_actionable
  FROM (
    SELECT "status"
    FROM "service_jobs"
    WHERE "id" = first_job_id
       OR (second_job_id IS NOT NULL AND "id" = second_job_id)
    ORDER BY "id"
    FOR UPDATE
  ) locked_jobs;

  IF actual_count <> expected_count OR NOT coalesce(all_actionable, false) THEN
    RAISE EXCEPTION 'SERVICE_VISIT_STATUS_INVALID';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_service_visit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "assert_service_visit_jobs_actionable"(NEW."job_id", NULL);
  ELSIF
    OLD."job_id" IS DISTINCT FROM NEW."job_id"
    OR OLD."profile_id" IS DISTINCT FROM NEW."profile_id"
    OR (OLD."status" IS DISTINCT FROM NEW."status" AND NEW."status" = 'active')
  THEN
    PERFORM "assert_service_visit_jobs_actionable"(OLD."job_id", NEW."job_id");
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_visits_guard_job_state"
  BEFORE INSERT OR UPDATE ON "service_visits"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_service_visit_mutation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_service_time_entry_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  visit_job_id uuid;
  visit_profile_id uuid;
  visit_status text;
  requires_guard boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    requires_guard := true;
  ELSIF
    OLD."job_id" IS DISTINCT FROM NEW."job_id"
    OR OLD."profile_id" IS DISTINCT FROM NEW."profile_id"
    OR OLD."visit_id" IS DISTINCT FROM NEW."visit_id"
    OR (OLD."ended_at" IS NOT NULL AND NEW."ended_at" IS NULL)
  THEN
    requires_guard := true;
  END IF;

  IF requires_guard THEN
    PERFORM "assert_service_visit_jobs_actionable"(
      CASE WHEN TG_OP = 'UPDATE' THEN OLD."job_id" ELSE NEW."job_id" END,
      NEW."job_id"
    );

    IF NEW."visit_id" IS NOT NULL THEN
      SELECT "job_id", "profile_id", "status"
      INTO visit_job_id, visit_profile_id, visit_status
      FROM "service_visits"
      WHERE "id" = NEW."visit_id"
      FOR UPDATE;

      IF NOT FOUND
        OR visit_job_id IS DISTINCT FROM NEW."job_id"
        OR visit_profile_id IS DISTINCT FROM NEW."profile_id"
        OR (NEW."ended_at" IS NULL AND visit_status <> 'active')
      THEN
        RAISE EXCEPTION 'SERVICE_TIME_ENTRY_VISIT_INVALID';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_time_entries_guard_job_state"
  BEFORE INSERT OR UPDATE ON "service_time_entries"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_service_time_entry_mutation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_service_job_checklist_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."checklist" IS DISTINCT FROM NEW."checklist" THEN
    IF OLD."status" = 'completed' OR NEW."status" = 'completed' THEN
      RAISE EXCEPTION 'SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED';
    END IF;
    IF OLD."status" = 'cancelled' OR NEW."status" = 'cancelled' THEN
      RAISE EXCEPTION 'SERVICE_FIELD_JOB_TERMINAL';
    END IF;
  END IF;

  IF OLD."status" IS DISTINCT FROM NEW."status" AND NEW."status" = 'completed' THEN
    IF EXISTS (
      SELECT 1 FROM "service_visits"
      WHERE "job_id" = NEW."id" AND "status" = 'active'
    ) OR EXISTS (
      SELECT 1 FROM "service_time_entries"
      WHERE "job_id" = NEW."id" AND "ended_at" IS NULL
    ) THEN
      RAISE EXCEPTION 'SERVICE_COMPLETION_OPEN_WORK';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
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
      OR OLD."created_by" IS DISTINCT FROM NEW."created_by"
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
REVOKE ALL ON FUNCTION "assert_service_visit_jobs_actionable"(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_visit_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_time_entry_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_job_checklist_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_asset_mutation"() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "assert_service_visit_jobs_actionable"(uuid, uuid) FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_visit_mutation"() FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_time_entry_mutation"() FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_job_checklist_mutation"() FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_asset_mutation"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "assert_service_visit_jobs_actionable"(uuid, uuid) FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_visit_mutation"() FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_time_entry_mutation"() FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_job_checklist_mutation"() FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_asset_mutation"() FROM authenticated;
  END IF;
END $$;
