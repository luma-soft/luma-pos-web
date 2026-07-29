CREATE OR REPLACE FUNCTION "bump_service_job_versions"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
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
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bump_service_material_version"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(
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

CREATE OR REPLACE FUNCTION "bump_installed_asset_version"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(
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

CREATE OR REPLACE FUNCTION "bump_service_job_assets_version"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  old_job_id uuid;
  new_job_id uuid;
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

  IF asset_changed AND old_job_id IS NOT NULL
     AND old_job_id IS DISTINCT FROM new_job_id THEN
    UPDATE "service_jobs"
    SET "assets_version" = "assets_version" + 1,
        "updated_at" = clock_timestamp()
    WHERE "id" = old_job_id;
  END IF;
  IF asset_changed AND new_job_id IS NOT NULL THEN
    UPDATE "service_jobs"
    SET "assets_version" = "assets_version" + 1,
        "updated_at" = clock_timestamp()
    WHERE "id" = new_job_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

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
