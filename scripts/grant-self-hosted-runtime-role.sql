-- Run in pgAdmin Query Tool while connected to the target database as the
-- same DBA role that will own/run future schema migrations.
-- Create the login role separately in pgAdmin as `lumapos_runtime` with:
--   LOGIN, BYPASSRLS, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION.
-- Set a strong password in pgAdmin and keep it only in the protected runtime
-- environment. This script contains no credentials and grants no DDL rights.

DO $$
DECLARE
  runtime_role pg_roles%ROWTYPE;
BEGIN
  IF current_database() IN ('postgres', 'template0', 'template1') THEN
    RAISE EXCEPTION 'Refusing to provision runtime access on a PostgreSQL system database';
  END IF;

  SELECT * INTO runtime_role
  FROM pg_roles
  WHERE rolname = 'lumapos_runtime';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Create the lumapos_runtime login role in pgAdmin before running this script';
  END IF;

  IF NOT runtime_role.rolcanlogin
    OR runtime_role.rolsuper
    OR runtime_role.rolcreatedb
    OR runtime_role.rolcreaterole
    OR NOT runtime_role.rolbypassrls
    OR runtime_role.rolreplication THEN
    RAISE EXCEPTION 'lumapos_runtime must be LOGIN + BYPASSRLS without superuser, database, role, or replication privileges';
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO lumapos_runtime', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO lumapos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lumapos_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO lumapos_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lumapos_runtime;

-- Default privileges are scoped to the current role. Run migrations and this
-- grant script as the same schema owner so later tables/functions are usable.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lumapos_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO lumapos_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO lumapos_runtime;
