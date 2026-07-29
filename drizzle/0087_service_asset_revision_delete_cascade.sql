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
    IF NOT EXISTS (
      SELECT 1
      FROM public."service_jobs"
      WHERE "id" = target_job_id
    ) THEN
      CONTINUE;
    END IF;
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

REVOKE ALL ON FUNCTION "bump_service_job_assets_version"() FROM PUBLIC;--> statement-breakpoint

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.bump_service_job_assets_version() FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;
