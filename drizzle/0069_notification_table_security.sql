ALTER TABLE public.notification_events
  ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE public.notification_recipients
  ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

ALTER TABLE public.notification_outbox
  ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES
      ON TABLE
        public.notification_events,
        public.notification_recipients,
        public.notification_outbox
      FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES
      ON TABLE
        public.notification_events,
        public.notification_recipients,
        public.notification_outbox
      FROM authenticated;
  END IF;
END
$$;
