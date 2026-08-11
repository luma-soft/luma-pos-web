CREATE OR REPLACE FUNCTION "invalidate_service_job_signatures"(
  target_job_id uuid,
  reason text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
  job_status service_job_status;
  target_store_id uuid;
BEGIN
  IF target_job_id IS NULL THEN
    RETURN;
  END IF;

  SELECT "status", "store_id"
  INTO job_status, target_store_id
  FROM "service_jobs"
  WHERE "id" = target_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF job_status = 'completed' THEN
    RAISE EXCEPTION 'SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED';
  END IF;

  UPDATE "service_signatures"
  SET
    "invalidated_at" = now(),
    "invalidation_reason" = reason
  WHERE "store_id" = target_store_id
    AND "job_id" = target_job_id
    AND "invalidated_at" IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    INSERT INTO "service_job_events" ("store_id", "job_id", "event_type", "payload")
    VALUES (
      target_store_id,
      target_job_id,
      'job.signature_invalidated',
      jsonb_build_object('reason', reason, 'signatureCount', affected)
    );
  END IF;
END;
$$;
