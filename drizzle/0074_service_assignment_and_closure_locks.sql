CREATE OR REPLACE FUNCTION "guard_service_job_assignment_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_job_id uuid;
  new_job_id uuid;
BEGIN
  old_job_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."job_id" END;
  new_job_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."job_id" END;

  PERFORM 1
  FROM "service_jobs"
  WHERE "id" = old_job_id OR "id" = new_job_id
  ORDER BY "id"
  FOR UPDATE;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_job_assignments_lock_job"
  BEFORE INSERT OR UPDATE OR DELETE ON "service_job_assignments"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_service_job_assignment_mutation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_service_job_primary_assignment_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."assigned_to" IS DISTINCT FROM NEW."assigned_to" THEN
    PERFORM 1
    FROM "service_jobs"
    WHERE "id" = OLD."id"
    FOR UPDATE;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_jobs_lock_primary_assignment"
  BEFORE UPDATE OF "assigned_to" ON "service_jobs"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_service_job_primary_assignment_mutation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_service_visit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  is_checkout boolean;
  has_other_change boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "assert_service_visit_jobs_actionable"(NEW."job_id", NULL);
    RETURN NEW;
  END IF;

  IF
    OLD."job_id" IS DISTINCT FROM NEW."job_id"
    OR OLD."profile_id" IS DISTINCT FROM NEW."profile_id"
    OR OLD."checked_in_at" IS DISTINCT FROM NEW."checked_in_at"
    OR OLD."check_in_latitude" IS DISTINCT FROM NEW."check_in_latitude"
    OR OLD."check_in_longitude" IS DISTINCT FROM NEW."check_in_longitude"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
  THEN
    RAISE EXCEPTION 'SERVICE_VISIT_IDENTITY_IMMUTABLE';
  END IF;

  IF
    (OLD."status" <> 'active' AND NEW."status" = 'active')
    OR (OLD."checked_out_at" IS NOT NULL AND NEW."checked_out_at" IS NULL)
  THEN
    RAISE EXCEPTION 'SERVICE_VISIT_REOPEN_FORBIDDEN';
  END IF;

  is_checkout := (
    OLD."status" = 'active'
    AND NEW."status" IN ('completed', 'cancelled')
    AND OLD."checked_out_at" IS NULL
    AND NEW."checked_out_at" IS NOT NULL
  );
  has_other_change := (
    OLD."status" IS DISTINCT FROM NEW."status"
    OR OLD."checked_out_at" IS DISTINCT FROM NEW."checked_out_at"
    OR OLD."check_out_latitude" IS DISTINCT FROM NEW."check_out_latitude"
    OR OLD."check_out_longitude" IS DISTINCT FROM NEW."check_out_longitude"
    OR OLD."note" IS DISTINCT FROM NEW."note"
    OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at"
  );

  IF has_other_change AND NOT is_checkout THEN
    RAISE EXCEPTION 'SERVICE_VISIT_UPDATE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_service_time_entry_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  visit_job_id uuid;
  visit_profile_id uuid;
  visit_status text;
  has_other_change boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "assert_service_visit_jobs_actionable"(NEW."job_id", NULL);
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
    RETURN NEW;
  END IF;

  IF
    OLD."job_id" IS DISTINCT FROM NEW."job_id"
    OR OLD."visit_id" IS DISTINCT FROM NEW."visit_id"
    OR OLD."profile_id" IS DISTINCT FROM NEW."profile_id"
    OR OLD."entry_type" IS DISTINCT FROM NEW."entry_type"
    OR OLD."started_at" IS DISTINCT FROM NEW."started_at"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
  THEN
    RAISE EXCEPTION 'SERVICE_TIME_ENTRY_IDENTITY_IMMUTABLE';
  END IF;

  IF OLD."ended_at" IS NOT NULL AND NEW."ended_at" IS NULL THEN
    RAISE EXCEPTION 'SERVICE_TIME_ENTRY_REOPEN_FORBIDDEN';
  END IF;

  has_other_change := (
    OLD."ended_at" IS DISTINCT FROM NEW."ended_at"
    OR OLD."note" IS DISTINCT FROM NEW."note"
  );
  IF has_other_change AND NOT (
    OLD."ended_at" IS NULL
    AND NEW."ended_at" IS NOT NULL
    AND OLD."note" IS NOT DISTINCT FROM NEW."note"
  ) THEN
    RAISE EXCEPTION 'SERVICE_TIME_ENTRY_UPDATE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "guard_service_job_assignment_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_job_primary_assignment_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_visit_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "guard_service_time_entry_mutation"() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "guard_service_job_assignment_mutation"() FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_job_primary_assignment_mutation"() FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_visit_mutation"() FROM anon;
    REVOKE ALL ON FUNCTION "guard_service_time_entry_mutation"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "guard_service_job_assignment_mutation"() FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_job_primary_assignment_mutation"() FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_visit_mutation"() FROM authenticated;
    REVOKE ALL ON FUNCTION "guard_service_time_entry_mutation"() FROM authenticated;
  END IF;
END $$;
