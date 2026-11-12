ALTER TABLE public.sync_relay_events
  DROP CONSTRAINT IF EXISTS sync_relay_events_command_check;

ALTER TABLE public.sync_relay_events
  ADD CONSTRAINT sync_relay_events_command_check
    CHECK (command_type IN ('pos.order.create', 'service.field.mutation'));
