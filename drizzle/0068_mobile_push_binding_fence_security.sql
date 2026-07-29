ALTER TABLE public.mobile_push_device_binding_fences
  ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES
      ON TABLE public.mobile_push_device_binding_fences
      FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES
      ON TABLE public.mobile_push_device_binding_fences
      FROM authenticated;
  END IF;
END
$$;
