-- These tables are server-side only. The app uses its PostgreSQL connection,
-- so no Supabase Data API role needs direct table privileges.
ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._migrations FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
ALTER TABLE public.sepay_payment_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sepay_payment_sessions FROM PUBLIC, anon, authenticated, service_role;
