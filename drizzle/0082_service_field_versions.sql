ALTER TABLE "service_jobs"
  ADD COLUMN "version" integer NOT NULL DEFAULT 1,
  ADD COLUMN "checklist_version" integer NOT NULL DEFAULT 1,
  ADD COLUMN "assets_version" integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT "service_jobs_version_check"
    CHECK ("version" > 0 AND "checklist_version" > 0 AND "assets_version" > 0);--> statement-breakpoint

ALTER TABLE "service_job_materials"
  ADD COLUMN "version" integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT "service_job_materials_version_check" CHECK ("version" > 0);--> statement-breakpoint

ALTER TABLE "installed_assets"
  ADD COLUMN "version" integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT "installed_assets_version_check" CHECK ("version" > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bump_service_job_versions"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW."version" := OLD."version" + 1;
  IF OLD."checklist" IS DISTINCT FROM NEW."checklist" THEN
    NEW."checklist_version" := OLD."checklist_version" + 1;
  ELSE
    NEW."checklist_version" := OLD."checklist_version";
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "service_jobs_bump_versions"
BEFORE UPDATE ON "service_jobs"
FOR EACH ROW
EXECUTE FUNCTION "bump_service_job_versions"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bump_service_material_version"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW."version" := OLD."version" + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "service_job_materials_bump_version"
BEFORE UPDATE ON "service_job_materials"
FOR EACH ROW
EXECUTE FUNCTION "bump_service_material_version"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bump_installed_asset_version"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW."version" := OLD."version" + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "installed_assets_bump_version"
BEFORE UPDATE ON "installed_assets"
FOR EACH ROW
EXECUTE FUNCTION "bump_installed_asset_version"();--> statement-breakpoint

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
    SET "assets_version" = "assets_version" + 1
    WHERE "id" = old_job_id;
  END IF;
  IF new_job_id IS NOT NULL THEN
    UPDATE "service_jobs"
    SET "assets_version" = "assets_version" + 1
    WHERE "id" = new_job_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE TRIGGER "installed_assets_bump_job_assets_version"
AFTER INSERT OR UPDATE OR DELETE ON "installed_assets"
FOR EACH ROW
EXECUTE FUNCTION "bump_service_job_assets_version"();--> statement-breakpoint

REVOKE ALL ON FUNCTION "bump_service_job_versions"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "bump_service_material_version"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "bump_installed_asset_version"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "bump_service_job_assets_version"() FROM PUBLIC;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "bump_service_job_versions"() FROM anon;
    REVOKE ALL ON FUNCTION "bump_service_material_version"() FROM anon;
    REVOKE ALL ON FUNCTION "bump_installed_asset_version"() FROM anon;
    REVOKE ALL ON FUNCTION "bump_service_job_assets_version"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "bump_service_job_versions"() FROM authenticated;
    REVOKE ALL ON FUNCTION "bump_service_material_version"() FROM authenticated;
    REVOKE ALL ON FUNCTION "bump_installed_asset_version"() FROM authenticated;
    REVOKE ALL ON FUNCTION "bump_service_job_assets_version"() FROM authenticated;
  END IF;
END;
$$;
