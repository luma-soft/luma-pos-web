import { PGlite } from "@electric-sql/pglite";

process.env.LUMA_TEST_STORE_ID = "00000000-0000-4000-8000-000000000001";

const originalExec = PGlite.prototype.exec;
const bootstrappedClients = new WeakSet<PGlite>();

const pgliteAuthBootstrap = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
`;

const pgliteRoleBootstrap = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated;
    END IF;
  END
  $$;
`;

PGlite.prototype.exec = async function execWithSupabaseCompatibility(
  sql: string,
  options?: Parameters<typeof originalExec>[1],
) {
  if (!bootstrappedClients.has(this)) {
    bootstrappedClients.add(this);
    await originalExec.call(this, pgliteAuthBootstrap);
  }

  if (/\bTO\s+(?:anon|authenticated)\b/i.test(sql)) {
    await originalExec.call(this, pgliteRoleBootstrap);
  }

  // PGlite does not bundle Supabase Storage or pg_trgm. Those statements only
  // configure external infrastructure/indexing; application tables and RLS
  // still run through the real migration SQL below.
  if (/\bstorage\.(?:objects|foldername)\b/i.test(sql) || /\bgin_trgm_ops\b/i.test(sql)) {
    return originalExec.call(this, "SELECT 1 WHERE false", options);
  }

  return originalExec.call(this, sql, options);
};
