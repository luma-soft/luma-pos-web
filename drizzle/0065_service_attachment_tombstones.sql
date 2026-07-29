ALTER TABLE "service_attachments"
  ADD COLUMN "deleted_at" timestamptz,
  ADD COLUMN "deleted_by" uuid REFERENCES "profiles"("id") ON DELETE set null,
  ADD COLUMN "storage_deleted_at" timestamptz,
  ADD COLUMN "storage_delete_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN "storage_delete_last_error" text;
--> statement-breakpoint
CREATE INDEX "service_attachments_active_job_idx"
  ON "service_attachments" ("job_id", "created_at")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_tombstoned_service_signature"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "service_attachments"
    WHERE "id" = NEW."attachment_id"
      AND "deleted_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SERVICE_SIGNATURE_ATTACHMENT_TOMBSTONED';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_signatures_reject_tombstoned_attachment"
  BEFORE INSERT OR UPDATE OF "attachment_id" ON "service_signatures"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_tombstoned_service_signature"();
