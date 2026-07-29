CREATE OR REPLACE FUNCTION "bump_service_job_assets_version"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  old_job_id uuid;
  new_job_id uuid;
BEGIN
  old_job_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."job_id" END;
  new_job_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."job_id" END;

  IF old_job_id IS NOT NULL AND old_job_id IS DISTINCT FROM new_job_id THEN
    UPDATE "service_jobs"
    SET
      "assets_version" = "assets_version" + 1,
      "updated_at" = clock_timestamp()
    WHERE "id" = old_job_id;
  END IF;
  IF new_job_id IS NOT NULL THEN
    UPDATE "service_jobs"
    SET
      "assets_version" = "assets_version" + 1,
      "updated_at" = clock_timestamp()
    WHERE "id" = new_job_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "bump_service_job_assets_version"() FROM PUBLIC;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "bump_service_job_assets_version"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "bump_service_job_assets_version"() FROM authenticated;
  END IF;
END;
$$;
