CREATE TABLE public.system_worker_heartbeats (
  worker_key text PRIMARY KEY,
  worker_id text NOT NULL,
  state text NOT NULL,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT system_worker_heartbeats_state_check
    CHECK (state IN ('running', 'stopped'))
);
--> statement-breakpoint
ALTER TABLE public.system_worker_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.system_worker_heartbeats FROM PUBLIC, authenticated, service_role;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.system_worker_heartbeats FROM anon;
  END IF;
END
$$;
