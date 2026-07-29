CREATE OR REPLACE FUNCTION "bump_service_job_versions"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."version" := 1;
    NEW."checklist_version" := 1;
    NEW."assets_version" := 1;
    RETURN NEW;
  END IF;

  IF ROW(
    OLD."project_id", OLD."code", OLD."service_type", OLD."title",
    OLD."status", OLD."priority", OLD."assigned_to", OLD."scheduled_at",
    OLD."completed_at", OLD."description", OLD."checklist",
    OLD."quote_order_id", OLD."material_order_id", OLD."completion_note"
  ) IS DISTINCT FROM ROW(
    NEW."project_id", NEW."code", NEW."service_type", NEW."title",
    NEW."status", NEW."priority", NEW."assigned_to", NEW."scheduled_at",
    NEW."completed_at", NEW."description", NEW."checklist",
    NEW."quote_order_id", NEW."material_order_id", NEW."completion_note"
  ) THEN
    NEW."version" := OLD."version" + 1;
  ELSE
    NEW."version" := OLD."version";
  END IF;

  IF OLD."checklist" IS DISTINCT FROM NEW."checklist" THEN
    NEW."checklist_version" := OLD."checklist_version" + 1;
  ELSE
    NEW."checklist_version" := OLD."checklist_version";
  END IF;

  IF pg_trigger_depth() = 1 THEN
    NEW."assets_version" := OLD."assets_version";
  ELSIF NEW."assets_version" IS DISTINCT FROM OLD."assets_version"
        AND NEW."assets_version" IS DISTINCT FROM OLD."assets_version" + 1 THEN
    RAISE EXCEPTION 'SERVICE_ASSETS_VERSION_INVALID_DELTA'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER "service_jobs_bump_versions" ON "service_jobs";--> statement-breakpoint

CREATE TRIGGER "service_jobs_bump_versions"
BEFORE INSERT OR UPDATE ON "service_jobs"
FOR EACH ROW
EXECUTE FUNCTION "bump_service_job_versions"();--> statement-breakpoint

REVOKE ALL ON FUNCTION "bump_service_job_versions"() FROM PUBLIC;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "bump_service_job_versions"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "bump_service_job_versions"() FROM authenticated;
  END IF;
END;
$$;
