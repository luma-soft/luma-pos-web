ALTER TABLE "media_objects"
  ADD COLUMN "purpose" text NOT NULL,
  ADD COLUMN "target_id" uuid NOT NULL,
  ADD COLUMN "upload_expires_at" timestamptz NOT NULL;--> statement-breakpoint

ALTER TABLE "media_objects"
  ADD CONSTRAINT "media_objects_purpose_check"
  CHECK ("purpose" IN ('product-image','project-document','service-evidence','ai-attachment'));--> statement-breakpoint

CREATE INDEX "media_objects_store_purpose_target_idx"
  ON "media_objects" ("store_id","purpose","target_id");--> statement-breakpoint

CREATE INDEX "media_objects_status_upload_expiry_idx"
  ON "media_objects" ("status","upload_expires_at");
