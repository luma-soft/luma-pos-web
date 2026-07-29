ALTER TABLE "catalog_sync_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON TABLE "catalog_sync_state" TO authenticated;
  END IF;
END;
$$;
--> statement-breakpoint
DROP POLICY IF EXISTS "authenticated_read_catalog_sync_state" ON "catalog_sync_state";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY "authenticated_read_catalog_sync_state"
    ON "catalog_sync_state"
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'catalog_sync_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE catalog_sync_state;
  END IF;
END;
$$;
