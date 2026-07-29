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

  -- Serialize snapshot creation/completion with every trigger-driven invalidation.
  -- If the authoritative mutation wins, the signer reads its committed state.
  -- If signing wins, the mutation waits and then invalidates the new signature.
  PERFORM 1
  FROM "service_jobs"
  WHERE "id" = target_job_id
  FOR UPDATE;

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
REVOKE ALL ON FUNCTION "invalidate_service_job_signatures"(uuid, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION "invalidate_service_job_signatures"(uuid, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION "invalidate_service_job_signatures"(uuid, text) FROM authenticated;
  END IF;
END $$;
