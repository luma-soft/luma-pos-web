REVOKE ALL ON public.sync_relay_memberships, public.sync_relay_events FROM authenticated;
REVOKE ALL ON SEQUENCE public.sync_relay_events_position_seq FROM authenticated;

DROP POLICY IF EXISTS sync_relay_memberships_read_self ON public.sync_relay_memberships;
DROP POLICY IF EXISTS sync_relay_events_read_sales_member ON public.sync_relay_events;
DROP POLICY IF EXISTS sync_relay_events_insert_pos_order ON public.sync_relay_events;

GRANT ALL ON public.sync_relay_memberships, public.sync_relay_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sync_relay_events_position_seq TO service_role;
