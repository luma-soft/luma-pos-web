-- Server-only enrichment. Do not add GPS to media_objects: that registry has
-- authenticated store-wide SELECT access, broader than project/job permissions.
-- Existing originals and registry grants remain unchanged.
CREATE TABLE "media_file_metadata" (
  "store_id" uuid NOT NULL,
  "media_object_id" uuid NOT NULL,
  "metadata" jsonb NOT NULL,
  CONSTRAINT "media_file_metadata_pkey" PRIMARY KEY ("store_id", "media_object_id"),
  CONSTRAINT "media_file_metadata_object_tenant_fk"
    FOREIGN KEY ("store_id", "media_object_id")
    REFERENCES "media_objects"("store_id", "id") ON DELETE CASCADE,
  CONSTRAINT "media_file_metadata_json_check" CHECK (COALESCE((
    jsonb_typeof("metadata") = 'object'
    AND "metadata"->'version' = '1'::jsonb
    AND "metadata"->>'status' IN ('ready', 'empty', 'unsupported', 'failed')
    AND jsonb_typeof("metadata"->'extractedAt') = 'string'
    AND octet_length("metadata"::text) <= 16384
    AND "metadata" ?& ARRAY['version', 'status', 'extractedAt']
  ), false))
);
--> statement-breakpoint
ALTER TABLE "media_file_metadata" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "media_file_metadata" FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
COMMENT ON TABLE "media_file_metadata" IS
'Server-only metadata extracted from stored originals. Access only after media target authorization; no direct client policies or grants. Unknown capture timezone remains unknown. GPS is not device check-in location.';
