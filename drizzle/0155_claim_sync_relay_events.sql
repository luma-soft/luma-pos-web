CREATE INDEX IF NOT EXISTS sync_relay_events_expired_lease_idx
  ON public.sync_relay_events (lease_expires_at, position)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.claim_sync_relay_events(
  p_worker_id text,
  p_batch_size integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 90
)
RETURNS SETOF public.sync_relay_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  batch_size integer;
  lease_seconds integer;
BEGIN
  IF p_worker_id IS NULL OR length(btrim(p_worker_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid sync relay worker identifier' USING ERRCODE = '22023';
  END IF;

  batch_size := least(greatest(coalesce(p_batch_size, 10), 1), 100);
  lease_seconds := least(greatest(coalesce(p_lease_seconds, 90), 10), 300);

  RETURN QUERY
  WITH claimable AS (
    SELECT e.position
    FROM public.sync_relay_events e
    WHERE (e.status = 'pending' AND e.available_at <= now())
       OR (e.status = 'processing' AND (e.lease_expires_at IS NULL OR e.lease_expires_at <= now()))
    ORDER BY e.position
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sync_relay_events e
  SET status = 'processing',
      lease_owner = btrim(p_worker_id),
      lease_expires_at = now() + make_interval(secs => lease_seconds),
      attempt_count = e.attempt_count + 1,
      updated_at = now()
  FROM claimable c
  WHERE e.position = c.position
  RETURNING e.*;
END
$$;

REVOKE ALL ON FUNCTION public.claim_sync_relay_events(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_sync_relay_events(text, integer, integer) TO service_role;
