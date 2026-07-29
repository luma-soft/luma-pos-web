CREATE TABLE "service_job_asset_revisions" (
  "job_id" uuid PRIMARY KEY
    REFERENCES "service_jobs"("id") ON DELETE CASCADE,
  "version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "service_job_asset_revisions_version_check" CHECK ("version" > 0)
);--> statement-breakpoint

INSERT INTO "service_job_asset_revisions" ("job_id", "version")
SELECT "id", "assets_version"
FROM "service_jobs";--> statement-breakpoint

ALTER TABLE "service_job_asset_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON TABLE "service_job_asset_revisions" FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bump_service_job_versions"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  authoritative_assets_version integer;
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

  SELECT "version"
  INTO authoritative_assets_version
  FROM public."service_job_asset_revisions"
  WHERE "job_id" = OLD."id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_ASSET_REVISION_MISSING'
      USING ERRCODE = '23514';
  END IF;
  NEW."assets_version" := authoritative_assets_version;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "create_service_job_asset_revision"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public."service_job_asset_revisions" ("job_id", "version")
  VALUES (NEW."id", 1)
  ON CONFLICT ("job_id") DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "service_jobs_create_asset_revision"
AFTER INSERT ON "service_jobs"
FOR EACH ROW
EXECUTE FUNCTION "create_service_job_asset_revision"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bump_service_material_version"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."version" := 1;
  ELSIF ROW(
    OLD."job_id", OLD."product_id", OLD."unit_name",
    OLD."planned_quantity", OLD."used_quantity", OLD."note"
  ) IS DISTINCT FROM ROW(
    NEW."job_id", NEW."product_id", NEW."unit_name",
    NEW."planned_quantity", NEW."used_quantity", NEW."note"
  ) THEN
    NEW."version" := OLD."version" + 1;
  ELSE
    NEW."version" := OLD."version";
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER "service_job_materials_bump_version"
ON "service_job_materials";--> statement-breakpoint

CREATE TRIGGER "service_job_materials_bump_version"
BEFORE INSERT OR UPDATE ON "service_job_materials"
FOR EACH ROW
EXECUTE FUNCTION "bump_service_material_version"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bump_installed_asset_version"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."version" := 1;
  ELSIF ROW(
    OLD."project_id", OLD."job_id", OLD."product_id", OLD."asset_kind",
    OLD."name", OLD."brand", OLD."model", OLD."serial_number",
    OLD."mac_address", OLD."ip_address", OLD."location_label",
    OLD."installed_at", OLD."customer_warranty_ends_on",
    OLD."supplier_warranty_ends_on", OLD."status", OLD."note"
  ) IS DISTINCT FROM ROW(
    NEW."project_id", NEW."job_id", NEW."product_id", NEW."asset_kind",
    NEW."name", NEW."brand", NEW."model", NEW."serial_number",
    NEW."mac_address", NEW."ip_address", NEW."location_label",
    NEW."installed_at", NEW."customer_warranty_ends_on",
    NEW."supplier_warranty_ends_on", NEW."status", NEW."note"
  ) THEN
    NEW."version" := OLD."version" + 1;
  ELSE
    NEW."version" := OLD."version";
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER "installed_assets_bump_version"
ON "installed_assets";--> statement-breakpoint

CREATE TRIGGER "installed_assets_bump_version"
BEFORE INSERT OR UPDATE ON "installed_assets"
FOR EACH ROW
EXECUTE FUNCTION "bump_installed_asset_version"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bump_service_job_assets_version"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_job_id uuid;
  new_job_id uuid;
  target_job_id uuid;
  next_version integer;
  asset_changed boolean;
BEGIN
  old_job_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."job_id" END;
  new_job_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."job_id" END;
  asset_changed := TG_OP <> 'UPDATE' OR ROW(
    OLD."project_id", OLD."job_id", OLD."product_id", OLD."asset_kind",
    OLD."name", OLD."brand", OLD."model", OLD."serial_number",
    OLD."mac_address", OLD."ip_address", OLD."location_label",
    OLD."installed_at", OLD."customer_warranty_ends_on",
    OLD."supplier_warranty_ends_on", OLD."status", OLD."note"
  ) IS DISTINCT FROM ROW(
    NEW."project_id", NEW."job_id", NEW."product_id", NEW."asset_kind",
    NEW."name", NEW."brand", NEW."model", NEW."serial_number",
    NEW."mac_address", NEW."ip_address", NEW."location_label",
    NEW."installed_at", NEW."customer_warranty_ends_on",
    NEW."supplier_warranty_ends_on", NEW."status", NEW."note"
  );
  IF NOT asset_changed OR (old_job_id IS NULL AND new_job_id IS NULL) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM 1
  FROM public."service_jobs"
  WHERE "id" IN (old_job_id, new_job_id)
  ORDER BY "id"
  FOR UPDATE;
  PERFORM 1
  FROM public."service_job_asset_revisions"
  WHERE "job_id" IN (old_job_id, new_job_id)
  ORDER BY "job_id"
  FOR UPDATE;

  FOR target_job_id IN
    SELECT DISTINCT affected_job_id
    FROM unnest(ARRAY[old_job_id, new_job_id]) AS affected(affected_job_id)
    WHERE affected_job_id IS NOT NULL
    ORDER BY affected_job_id
  LOOP
    UPDATE public."service_job_asset_revisions"
    SET "version" = "version" + 1
    WHERE "job_id" = target_job_id
    RETURNING "version" INTO next_version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SERVICE_ASSET_REVISION_MISSING'
        USING ERRCODE = '23514';
    END IF;
    UPDATE public."service_jobs"
    SET
      "assets_version" = next_version,
      "updated_at" = clock_timestamp()
    WHERE "id" = target_job_id;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "bump_service_job_versions"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "create_service_job_asset_revision"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "bump_service_job_assets_version"() FROM PUBLIC;--> statement-breakpoint

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.service_job_asset_revisions FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.bump_service_job_versions() FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.create_service_job_asset_revision() FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.bump_service_job_assets_version() FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;
