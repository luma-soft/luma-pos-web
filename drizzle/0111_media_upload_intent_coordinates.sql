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

WITH raw_candidates (store_id, media_object_id, purpose, target_id) AS (
  SELECT relation.store_id, relation.media_object_id, 'product-image', product.id
  FROM product_media relation
  JOIN products product
    ON product.store_id = relation.store_id
   AND product.id = relation.product_id
  WHERE relation.deleted_at IS NULL

  UNION ALL

  -- Brand images use the documented store-catalog staging coordinate.
  SELECT brand.store_id, brand.logo_media_object_id, 'product-image', brand.store_id
  FROM brands brand
  WHERE brand.logo_media_object_id IS NOT NULL

  UNION ALL

  SELECT attachment.store_id, attachment.media_object_id,
         CASE WHEN attachment.job_id IS NULL THEN 'project-document' ELSE 'service-evidence' END,
         COALESCE(job.id, project.id)
  FROM service_attachments attachment
  JOIN projects project
    ON project.store_id = attachment.store_id
   AND project.id = attachment.project_id
  LEFT JOIN service_jobs job
    ON job.store_id = attachment.store_id
   AND job.id = attachment.job_id
  WHERE attachment.media_object_id IS NOT NULL
    AND attachment.deleted_at IS NULL
    AND (attachment.job_id IS NULL OR job.id IS NOT NULL)

  UNION ALL

  SELECT relation.store_id, relation.media_object_id, 'project-document', project.id
  FROM service_handover_document_media relation
  JOIN service_handover_documents document
    ON document.store_id = relation.store_id
   AND document.id = relation.document_id
  JOIN projects project
    ON project.store_id = document.store_id
   AND project.id = document.project_id

  UNION ALL

  SELECT attachment.store_id, attachment.media_object_id,
         CASE WHEN request.linked_job_id IS NULL THEN 'project-document' ELSE 'service-evidence' END,
         COALESCE(job.id, project.id)
  FROM service_customer_request_attachments attachment
  JOIN service_customer_requests request
    ON request.store_id = attachment.store_id
   AND request.id = attachment.request_id
  JOIN projects project
    ON project.store_id = request.store_id
   AND project.id = request.project_id
  LEFT JOIN service_jobs job
    ON job.store_id = request.store_id
   AND job.id = request.linked_job_id
  WHERE attachment.media_object_id IS NOT NULL
    AND (request.linked_job_id IS NULL OR job.id IS NOT NULL)

  UNION ALL

  -- An active signature keeps its evidence authoritative even when the backing
  -- attachment was tombstoned after signing.
  SELECT signature.store_id, attachment.media_object_id, 'service-evidence', job.id
  FROM service_signatures signature
  JOIN service_attachments attachment
    ON attachment.store_id = signature.store_id
   AND attachment.id = signature.attachment_id
  JOIN service_jobs job
    ON job.store_id = signature.store_id
   AND job.id = signature.job_id
  WHERE signature.invalidated_at IS NULL
    AND attachment.media_object_id IS NOT NULL

  UNION ALL

  SELECT message.store_id, parsed.media_object_id, 'ai-attachment', session.id
  FROM ai_chat_messages message
  JOIN ai_chat_sessions session
    ON session.store_id = message.store_id
   AND session.id = message.session_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(message.attachments) = 'array'
      THEN message.attachments ELSE '[]'::jsonb END
  ) element
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN jsonb_typeof(element) = 'object'
       AND jsonb_typeof(element->'mediaId') = 'string'
       AND element->>'mediaId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (element->>'mediaId')::uuid
    END AS media_object_id
  ) parsed
  WHERE parsed.media_object_id IS NOT NULL
), distinct_candidates AS (
  SELECT DISTINCT store_id, media_object_id, purpose, target_id
  FROM raw_candidates
  WHERE media_object_id IS NOT NULL AND target_id IS NOT NULL
), trusted_candidates AS (
  SELECT store_id, media_object_id, min(purpose) AS purpose,
         min(target_id::text)::uuid AS target_id
  FROM distinct_candidates
  GROUP BY store_id, media_object_id
  HAVING count(*) = 1
)
UPDATE media_objects media
SET purpose = candidate.purpose,
    target_id = candidate.target_id
FROM trusted_candidates candidate
WHERE media.store_id = candidate.store_id
  AND media.id = candidate.media_object_id;--> statement-breakpoint

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
