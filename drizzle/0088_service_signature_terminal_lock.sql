CREATE OR REPLACE FUNCTION "guard_service_signature_terminal_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_job_id uuid;
  target_status service_job_status;
BEGIN
  target_job_id := CASE WHEN TG_OP = 'INSERT' THEN NEW."job_id" ELSE OLD."job_id" END;

  SELECT "status"
  INTO target_status
  FROM "service_jobs"
  WHERE "id" = target_job_id
  FOR UPDATE;

  IF FOUND AND target_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED';
  END IF;

  IF
    TG_OP = 'UPDATE'
    AND OLD."job_id" IS DISTINCT FROM NEW."job_id"
  THEN
    SELECT "status"
    INTO target_status
    FROM "service_jobs"
    WHERE "id" = NEW."job_id"
    FOR UPDATE;

    IF FOUND AND target_status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "guard_service_signature_terminal_mutation_trigger"
  ON "service_signatures";
--> statement-breakpoint
CREATE TRIGGER "guard_service_signature_terminal_mutation_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "service_signatures"
FOR EACH ROW
EXECUTE FUNCTION "guard_service_signature_terminal_mutation"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "guard_service_signature_terminal_mutation"() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "guard_service_signature_terminal_mutation"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "guard_service_signature_terminal_mutation"() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION "guard_service_signature_terminal_mutation"() FROM service_role;
  END IF;
END $$;
