ALTER TABLE "media_objects"
  ADD COLUMN "purpose" text,
  ADD COLUMN "target_id" uuid,
  ADD COLUMN "upload_expires_at" timestamptz;--> statement-breakpoint

UPDATE "media_objects"
SET "purpose" = CASE "domain"
  WHEN 'products' THEN 'product-image'
  WHEN 'projects' THEN 'project-document'
  WHEN 'service-evidence' THEN 'service-evidence'
  WHEN 'ai' THEN 'ai-attachment'
  ELSE 'project-document'
END;--> statement-breakpoint

UPDATE "media_objects" media
SET "target_id" = (
  SELECT relation."product_id"
  FROM "product_media" relation
  WHERE relation."store_id" = media."store_id"
    AND relation."media_object_id" = media."id"
    AND relation."deleted_at" IS NULL
  ORDER BY relation."id"
  LIMIT 1
)
WHERE media."purpose" = 'product-image';--> statement-breakpoint

UPDATE "media_objects" media
SET "target_id" = COALESCE(
  (
    SELECT attachment."project_id"
    FROM "service_attachments" attachment
    WHERE attachment."store_id" = media."store_id"
      AND attachment."media_object_id" = media."id"
      AND attachment."deleted_at" IS NULL
    ORDER BY attachment."id"
    LIMIT 1
  ),
  (
    SELECT document."project_id"
    FROM "service_handover_document_media" relation
    JOIN "service_handover_documents" document
      ON document."store_id" = relation."store_id"
     AND document."id" = relation."document_id"
    WHERE relation."store_id" = media."store_id"
      AND relation."media_object_id" = media."id"
    ORDER BY relation."id"
    LIMIT 1
  )
)
WHERE media."purpose" = 'project-document';--> statement-breakpoint

UPDATE "media_objects" media
SET "target_id" = (
  SELECT attachment."job_id"
  FROM "service_attachments" attachment
  WHERE attachment."store_id" = media."store_id"
    AND attachment."media_object_id" = media."id"
    AND attachment."job_id" IS NOT NULL
    AND attachment."deleted_at" IS NULL
  ORDER BY attachment."id"
  LIMIT 1
)
WHERE media."purpose" = 'service-evidence';--> statement-breakpoint

UPDATE "media_objects" media
SET "target_id" = (
  SELECT message."session_id"
  FROM "ai_chat_messages" message
  WHERE message."store_id" = media."store_id"
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(message."attachments", '[]'::jsonb)) attachment
      WHERE attachment->>'mediaId' = media."id"::text
    )
  ORDER BY message."id"
  LIMIT 1
)
WHERE media."purpose" = 'ai-attachment';--> statement-breakpoint

UPDATE "media_objects"
SET
  "status" = CASE WHEN "status" = 'deleted' THEN 'deleted' ELSE 'quarantined' END,
  "target_id" = "store_id"
WHERE "target_id" IS NULL;--> statement-breakpoint

UPDATE "media_objects"
SET "upload_expires_at" = "created_at" + interval '10 minutes'
WHERE "upload_expires_at" IS NULL;--> statement-breakpoint

ALTER TABLE "media_objects"
  ALTER COLUMN "purpose" SET NOT NULL,
  ALTER COLUMN "target_id" SET NOT NULL,
  ALTER COLUMN "upload_expires_at" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "media_objects"
  ADD CONSTRAINT "media_objects_purpose_check"
  CHECK ("purpose" IN ('product-image','project-document','service-evidence','ai-attachment'));--> statement-breakpoint

CREATE INDEX "media_objects_store_purpose_target_idx"
  ON "media_objects" ("store_id","purpose","target_id");--> statement-breakpoint

CREATE INDEX "media_objects_status_upload_expiry_idx"
  ON "media_objects" ("status","upload_expires_at");
