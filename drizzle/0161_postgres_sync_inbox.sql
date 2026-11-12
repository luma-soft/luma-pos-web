CREATE TYPE public.sync_event_status AS ENUM (
  'pending', 'processing', 'accepted', 'rejected', 'conflict'
);
--> statement-breakpoint
CREATE TABLE public.sync_events (
  position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  command_type text NOT NULL,
  base_revision bigint,
  payload jsonb NOT NULL,
  payload_hash varchar(64) NOT NULL,
  status public.sync_event_status NOT NULL DEFAULT 'pending',
  result jsonb,
  error_code text,
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_events_store_user_fk
    FOREIGN KEY (store_id, user_id)
    REFERENCES public.profiles (store_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sync_events_payload_hash_check
    CHECK (length(payload_hash) = 64),
  CONSTRAINT sync_events_attempt_count_check
    CHECK (attempt_count >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sync_events_store_event_unique
  ON public.sync_events (store_id, event_id);
--> statement-breakpoint
CREATE INDEX sync_events_pending_available_idx
  ON public.sync_events (available_at, position)
  WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX sync_events_expired_lease_idx
  ON public.sync_events (lease_expires_at, position)
  WHERE status = 'processing';
--> statement-breakpoint
CREATE INDEX sync_events_user_created_idx
  ON public.sync_events (store_id, user_id, created_at);
--> statement-breakpoint
ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sync_events FROM PUBLIC, authenticated, service_role;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.sync_events FROM anon;
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON SEQUENCE public.sync_events_position_seq FROM PUBLIC, authenticated, service_role;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SEQUENCE public.sync_events_position_seq FROM anon;
  END IF;
END
$$;
