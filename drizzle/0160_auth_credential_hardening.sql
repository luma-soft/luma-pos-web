ALTER TABLE public.auth_credentials
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'auth_credentials_password_hash_type_check'
      AND conrelid = 'public.auth_credentials'::regclass
  ) THEN
    ALTER TABLE public.auth_credentials
      ADD CONSTRAINT auth_credentials_password_hash_type_check
      CHECK (password_hash_type IN ('bcrypt', 'scrypt'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'auth_credentials_password_hash_state_check'
      AND conrelid = 'public.auth_credentials'::regclass
  ) THEN
    ALTER TABLE public.auth_credentials
      ADD CONSTRAINT auth_credentials_password_hash_state_check
      CHECK (password_hash IS NOT NULL OR must_reset_password);
  END IF;
END
$$;
