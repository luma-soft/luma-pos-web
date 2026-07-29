ALTER TABLE "service_signatures"
  ADD COLUMN "canonical_snapshot" jsonb,
  ADD COLUMN "snapshot_schema_version" integer,
  ADD COLUMN "invalidated_at" timestamptz,
  ADD COLUMN "invalidated_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  ADD COLUMN "invalidation_reason" text,
  ADD CONSTRAINT "service_signatures_snapshot_version_check"
    CHECK ("snapshot_schema_version" IS NULL OR "snapshot_schema_version" > 0),
  ADD CONSTRAINT "service_signatures_invalidation_check"
    CHECK ("invalidated_at" IS NOT NULL OR ("invalidated_by" IS NULL AND "invalidation_reason" IS NULL));
--> statement-breakpoint
CREATE INDEX "service_signatures_active_job_idx"
  ON "service_signatures" ("job_id", "signed_at")
  WHERE "invalidated_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invalidate_service_job_signatures"(
  target_job_id uuid,
  reason text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  IF target_job_id IS NULL THEN
    RETURN;
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
CREATE TRIGGER "service_jobs_invalidate_signed_snapshot"
  AFTER UPDATE ON "service_jobs"
  FOR EACH ROW
  EXECUTE FUNCTION "invalidate_signature_on_job_snapshot_change"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invalidate_signature_on_project_snapshot_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  job_row record;
BEGIN
  IF
    OLD."name" IS DISTINCT FROM NEW."name"
    OR OLD."address" IS DISTINCT FROM NEW."address"
    OR OLD."service_type" IS DISTINCT FROM NEW."service_type"
    OR OLD."site_contact_name" IS DISTINCT FROM NEW."site_contact_name"
    OR OLD."site_contact_phone" IS DISTINCT FROM NEW."site_contact_phone"
  THEN
    FOR job_row IN SELECT "id" FROM "service_jobs" WHERE "project_id" = OLD."id"
    LOOP
      PERFORM "invalidate_service_job_signatures"(job_row."id", 'project.changed');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "projects_invalidate_signed_snapshot"
  AFTER UPDATE ON "projects"
  FOR EACH ROW
  EXECUTE FUNCTION "invalidate_signature_on_project_snapshot_change"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invalidate_signature_on_asset_snapshot_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_job_id uuid;
BEGIN
  target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."job_id" ELSE NEW."job_id" END;
  PERFORM "invalidate_service_job_signatures"(target_job_id, 'asset.changed');
  IF TG_OP = 'UPDATE' AND OLD."job_id" IS DISTINCT FROM NEW."job_id" THEN
    PERFORM "invalidate_service_job_signatures"(OLD."job_id", 'asset.changed');
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "installed_assets_invalidate_signed_snapshot"
  AFTER INSERT OR UPDATE OR DELETE ON "installed_assets"
  FOR EACH ROW
  EXECUTE FUNCTION "invalidate_signature_on_asset_snapshot_change"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invalidate_signature_on_attachment_snapshot_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_job_id uuid;
BEGIN
  target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."job_id" ELSE NEW."job_id" END;
  PERFORM "invalidate_service_job_signatures"(target_job_id, 'evidence.changed');
  IF TG_OP = 'UPDATE' AND OLD."job_id" IS DISTINCT FROM NEW."job_id" THEN
    PERFORM "invalidate_service_job_signatures"(OLD."job_id", 'evidence.changed');
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_attachments_invalidate_signed_snapshot"
  AFTER INSERT OR UPDATE OR DELETE ON "service_attachments"
  FOR EACH ROW
  EXECUTE FUNCTION "invalidate_signature_on_attachment_snapshot_change"();
