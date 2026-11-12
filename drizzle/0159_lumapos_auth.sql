CREATE TYPE public.auth_session_kind AS ENUM ('web', 'mobile');
--> statement-breakpoint
CREATE TYPE public.auth_token_kind AS ENUM ('web_session', 'mobile_access', 'mobile_refresh');
--> statement-breakpoint
CREATE TABLE public.auth_credentials (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email text,
  email_normalized text,
  password_hash text,
  password_hash_type varchar(16) NOT NULL DEFAULT 'bcrypt',
  email_verified_at timestamptz,
  must_reset_password boolean NOT NULL DEFAULT false,
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_credentials_password_hash_type_check
    CHECK (password_hash_type IN ('bcrypt', 'scrypt')),
  CONSTRAINT auth_credentials_password_hash_state_check
    CHECK (password_hash IS NOT NULL OR must_reset_password)
);
--> statement-breakpoint
CREATE UNIQUE INDEX auth_credentials_email_normalized_unique
  ON public.auth_credentials (email_normalized)
  WHERE email_normalized IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL,
  kind public.auth_session_kind NOT NULL,
  device_id text,
  device_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT auth_sessions_store_profile_fk
    FOREIGN KEY (store_id, profile_id)
    REFERENCES public.profiles (store_id, id)
    ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX auth_sessions_profile_created_idx
  ON public.auth_sessions (profile_id, created_at);
--> statement-breakpoint
CREATE INDEX auth_sessions_store_active_idx
  ON public.auth_sessions (store_id, revoked_at, expires_at);
--> statement-breakpoint
CREATE TABLE public.auth_session_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.auth_sessions(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  kind public.auth_token_kind NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
--> statement-breakpoint
CREATE INDEX auth_session_tokens_session_kind_idx
  ON public.auth_session_tokens (session_id, kind, expires_at);
--> statement-breakpoint
ALTER TABLE public.auth_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_session_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_credentials, public.auth_sessions, public.auth_session_tokens
  FROM PUBLIC, authenticated, service_role;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.auth_credentials, public.auth_sessions, public.auth_session_tokens FROM anon;
  END IF;
END
$$;
