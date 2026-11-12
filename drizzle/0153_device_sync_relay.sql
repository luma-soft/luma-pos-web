CREATE TABLE IF NOT EXISTS public.sync_relay_memberships (
  store_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_relay_memberships_pkey PRIMARY KEY (store_id, user_id),
  CONSTRAINT sync_relay_memberships_role_check
    CHECK (role IN ('owner', 'manager', 'cashier', 'warehouse', 'technician'))
);

CREATE INDEX IF NOT EXISTS sync_relay_memberships_user_idx
  ON public.sync_relay_memberships (user_id, is_active);

INSERT INTO public.sync_relay_memberships (store_id, user_id, role, is_active, updated_at)
SELECT p.store_id, p.id, p.role::text, p.is_active AND s.status = 'active', now()
FROM public.profiles p
JOIN public.stores s ON s.id = p.store_id
ON CONFLICT (store_id, user_id) DO UPDATE
SET role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS public.sync_relay_events (
  position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL,
  store_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  command_type text NOT NULL,
  base_revision bigint,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  error_code text,
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT sync_relay_events_store_event_unique UNIQUE (store_id, event_id),
  CONSTRAINT sync_relay_events_command_check CHECK (command_type = 'pos.order.create'),
  CONSTRAINT sync_relay_events_status_check
    CHECK (status IN ('pending', 'processing', 'accepted', 'rejected', 'conflict')),
  CONSTRAINT sync_relay_events_device_id_check CHECK (length(device_id) BETWEEN 1 AND 200),
  CONSTRAINT sync_relay_events_payload_object_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT sync_relay_events_attempt_count_check CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS sync_relay_events_store_position_idx
  ON public.sync_relay_events (store_id, position);
CREATE INDEX IF NOT EXISTS sync_relay_events_pending_idx
  ON public.sync_relay_events (store_id, available_at, position)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS sync_relay_events_store_device_idx
  ON public.sync_relay_events (store_id, device_id, position);

ALTER TABLE public.sync_relay_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_relay_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sync_relay_memberships FROM PUBLIC;
REVOKE ALL ON public.sync_relay_events FROM PUBLIC;
GRANT SELECT ON public.sync_relay_memberships TO authenticated;
GRANT SELECT, INSERT ON public.sync_relay_events TO authenticated;
GRANT ALL ON public.sync_relay_memberships TO service_role;
GRANT ALL ON public.sync_relay_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sync_relay_events_position_seq TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.sync_relay_memberships, public.sync_relay_events FROM anon;
  END IF;
END
$$;

DROP POLICY IF EXISTS sync_relay_memberships_read_self ON public.sync_relay_memberships;
CREATE POLICY sync_relay_memberships_read_self
  ON public.sync_relay_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND is_active);

DROP POLICY IF EXISTS sync_relay_events_read_sales_member ON public.sync_relay_events;
CREATE POLICY sync_relay_events_read_sales_member
  ON public.sync_relay_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sync_relay_memberships m
      WHERE m.store_id = sync_relay_events.store_id
        AND m.user_id = auth.uid()
        AND m.is_active
        AND m.role IN ('owner', 'manager', 'cashier')
    )
  );

DROP POLICY IF EXISTS sync_relay_events_insert_pos_order ON public.sync_relay_events;
CREATE POLICY sync_relay_events_insert_pos_order
  ON public.sync_relay_events FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND command_type = 'pos.order.create'
    AND EXISTS (
      SELECT 1 FROM public.sync_relay_memberships m
      WHERE m.store_id = sync_relay_events.store_id
        AND m.user_id = auth.uid()
        AND m.is_active
        AND m.role IN ('owner', 'manager', 'cashier')
    )
  );
