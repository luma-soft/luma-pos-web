CREATE OR REPLACE FUNCTION "invalidate_service_job_signatures"(
  target_job_id uuid,
  reason text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
  job_status service_job_status;
BEGIN
  IF target_job_id IS NULL THEN
    RETURN;
  END IF;

  SELECT "status"
  INTO job_status
  FROM "service_jobs"
  WHERE "id" = target_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF job_status = 'completed' THEN
    RAISE EXCEPTION 'SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED';
  END IF;

  UPDATE "service_signatures"
  SET
    "invalidated_at" = now(),
    "invalidation_reason" = reason
  WHERE "job_id" = target_job_id
    AND "invalidated_at" IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    INSERT INTO "service_job_events" ("job_id", "event_type", "payload")
    VALUES (
      target_job_id,
      'job.signature_invalidated',
      jsonb_build_object('reason', reason, 'signatureCount', affected)
    );
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invalidate_signature_on_job_snapshot_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    OLD."project_id" IS DISTINCT FROM NEW."project_id"
    OR OLD."code" IS DISTINCT FROM NEW."code"
    OR OLD."service_type" IS DISTINCT FROM NEW."service_type"
    OR OLD."title" IS DISTINCT FROM NEW."title"
    OR OLD."description" IS DISTINCT FROM NEW."description"
    OR OLD."checklist" IS DISTINCT FROM NEW."checklist"
  THEN
    PERFORM "invalidate_service_job_signatures"(OLD."id", 'job.changed');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invalidate_signature_on_asset_snapshot_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "invalidate_service_job_signatures"(NEW."job_id", 'asset.changed');
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM "invalidate_service_job_signatures"(OLD."job_id", 'asset.changed');
    RETURN OLD;
  END IF;

  snapshot_changed := (
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
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
  );

  IF snapshot_changed THEN
    PERFORM "invalidate_service_job_signatures"(NEW."job_id", 'asset.changed');
    IF OLD."job_id" IS DISTINCT FROM NEW."job_id" THEN
      PERFORM "invalidate_service_job_signatures"(OLD."job_id", 'asset.changed');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invalidate_signature_on_attachment_snapshot_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    snapshot_changed := NEW."deleted_at" IS NULL;
    IF snapshot_changed THEN
      PERFORM "invalidate_service_job_signatures"(NEW."job_id", 'evidence.changed');
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    snapshot_changed := OLD."deleted_at" IS NULL;
    IF snapshot_changed THEN
      PERFORM "invalidate_service_job_signatures"(OLD."job_id", 'evidence.changed');
    END IF;
    RETURN OLD;
  END IF;

  snapshot_changed := (
    (OLD."deleted_at" IS NULL OR NEW."deleted_at" IS NULL)
    AND (
      OLD."project_id" IS DISTINCT FROM NEW."project_id"
      OR OLD."job_id" IS DISTINCT FROM NEW."job_id"
      OR OLD."category" IS DISTINCT FROM NEW."category"
      OR OLD."file_name" IS DISTINCT FROM NEW."file_name"
      OR OLD."mime_type" IS DISTINCT FROM NEW."mime_type"
      OR OLD."size_bytes" IS DISTINCT FROM NEW."size_bytes"
      OR OLD."sha256" IS DISTINCT FROM NEW."sha256"
      OR OLD."caption" IS DISTINCT FROM NEW."caption"
      OR OLD."created_at" IS DISTINCT FROM NEW."created_at"
      OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
    )
  );

  IF snapshot_changed THEN
    PERFORM "invalidate_service_job_signatures"(NEW."job_id", 'evidence.changed');
    IF OLD."job_id" IS DISTINCT FROM NEW."job_id" THEN
      PERFORM "invalidate_service_job_signatures"(OLD."job_id", 'evidence.changed');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "invalidate_service_job_signatures"(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "invalidate_signature_on_job_snapshot_change"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "invalidate_signature_on_asset_snapshot_change"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "invalidate_signature_on_attachment_snapshot_change"() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "invalidate_service_job_signatures"(uuid, text) FROM anon;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_job_snapshot_change"() FROM anon;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_asset_snapshot_change"() FROM anon;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_attachment_snapshot_change"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "invalidate_service_job_signatures"(uuid, text) FROM authenticated;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_job_snapshot_change"() FROM authenticated;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_asset_snapshot_change"() FROM authenticated;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_attachment_snapshot_change"() FROM authenticated;
  END IF;
END $$;
