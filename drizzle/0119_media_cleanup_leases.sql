ALTER TABLE "media_objects"
  ADD COLUMN "cleanup_claimed_at" timestamptz,
  ADD COLUMN "cleanup_claim_token" uuid,
  ADD COLUMN "cleanup_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN "cleanup_last_error" text,
  ADD COLUMN "storage_deleted_at" timestamptz,
  ADD CONSTRAINT "media_objects_cleanup_claim_check" CHECK (
    ("cleanup_claimed_at" IS NULL) = ("cleanup_claim_token" IS NULL)
  ),
  ADD CONSTRAINT "media_objects_cleanup_attempts_check" CHECK (
    "cleanup_attempts" >= 0
  );--> statement-breakpoint

CREATE INDEX "media_objects_cleanup_retry_idx"
  ON "media_objects" (
    "status", "storage_deleted_at", "cleanup_claimed_at",
    "upload_expires_at", "deleted_at"
  );
