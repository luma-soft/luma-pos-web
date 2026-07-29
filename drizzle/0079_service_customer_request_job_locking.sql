CREATE OR REPLACE FUNCTION "validate_service_customer_request_job"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  job_project_id uuid;
BEGIN
  IF NEW."linked_job_id" IS NOT NULL THEN
    SELECT "project_id" INTO job_project_id
    FROM "service_jobs"
    WHERE "id" = NEW."linked_job_id"
    FOR UPDATE;
    IF job_project_id IS NULL OR job_project_id <> NEW."project_id" THEN
      RAISE EXCEPTION 'CUSTOMER_REQUEST_JOB_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_linked_service_job_project_move"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."project_id" IS DISTINCT FROM NEW."project_id"
    AND EXISTS (
      SELECT 1
      FROM "service_customer_requests"
      WHERE "linked_job_id" = OLD."id"
        AND "project_id" <> NEW."project_id"
    )
  THEN
    RAISE EXCEPTION 'CUSTOMER_REQUEST_JOB_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "service_jobs_customer_request_project_guard"
BEFORE UPDATE OF "project_id"
ON "service_jobs"
FOR EACH ROW
EXECUTE FUNCTION "prevent_linked_service_job_project_move"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "validate_service_customer_request_job"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "prevent_linked_service_job_project_move"() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "validate_service_customer_request_job"() FROM anon;
    REVOKE ALL ON FUNCTION "prevent_linked_service_job_project_move"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "validate_service_customer_request_job"() FROM authenticated;
    REVOKE ALL ON FUNCTION "prevent_linked_service_job_project_move"() FROM authenticated;
  END IF;
END $$;
