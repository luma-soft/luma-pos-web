ALTER TABLE "service_attachments"
  ADD COLUMN "cleanup_claimed_at" timestamptz,
  ADD COLUMN "cleanup_claim_token" uuid,
  ADD CONSTRAINT "service_attachments_cleanup_claim_check" CHECK (
    ("cleanup_claimed_at" IS NULL) = ("cleanup_claim_token" IS NULL)
  );
--> statement-breakpoint
CREATE INDEX "service_attachments_cleanup_retry_idx"
  ON "service_attachments" ("cleanup_claimed_at", "created_at")
  WHERE "deleted_at" IS NOT NULL AND "storage_deleted_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_tombstoned_service_signature"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attachment_deleted_at timestamptz;
BEGIN
  SELECT "deleted_at"
  INTO attachment_deleted_at
  FROM "service_attachments"
  WHERE "id" = NEW."attachment_id"
  FOR UPDATE;

  IF attachment_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'SERVICE_SIGNATURE_ATTACHMENT_TOMBSTONED';
  END IF;
  RETURN NEW;
END;
$$;
