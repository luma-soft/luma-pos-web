-- A restored/imported auth.refresh_tokens table can leave its identity sequence
-- behind MAX(id). GoTrue then fails new sign-ins with "Database error granting user"
-- when it tries to insert a refresh token using an already occupied primary key.
-- Local/PGlite databases do not include the Supabase-managed auth schema.
DO $$
BEGIN
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    PERFORM setval(
      pg_get_serial_sequence('auth.refresh_tokens', 'id'),
      COALESCE((SELECT MAX(id) FROM auth.refresh_tokens), 1),
      EXISTS (SELECT 1 FROM auth.refresh_tokens)
    );
  END IF;
END
$$;
