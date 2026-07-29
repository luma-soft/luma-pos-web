REVOKE ALL ON FUNCTION "invalidate_service_job_signatures"(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "invalidate_signature_on_job_snapshot_change"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "invalidate_signature_on_project_snapshot_change"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "invalidate_signature_on_asset_snapshot_change"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "invalidate_signature_on_attachment_snapshot_change"() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "invalidate_service_job_signatures"(uuid, text) FROM anon;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_job_snapshot_change"() FROM anon;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_project_snapshot_change"() FROM anon;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_asset_snapshot_change"() FROM anon;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_attachment_snapshot_change"() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "invalidate_service_job_signatures"(uuid, text) FROM authenticated;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_job_snapshot_change"() FROM authenticated;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_project_snapshot_change"() FROM authenticated;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_asset_snapshot_change"() FROM authenticated;
    REVOKE ALL ON FUNCTION "invalidate_signature_on_attachment_snapshot_change"() FROM authenticated;
  END IF;
END $$;
