type RuntimeEnvironment = Record<string, string | undefined>;

export function assertSelfHostedPrimaryDatabase(environment: RuntimeEnvironment): void {
  if (environment.LUMAPOS_AUTH_PROVIDER?.trim().toLowerCase() !== "lumapos") return;

  if (environment.LUMAPOS_PRIMARY_DATABASE_CONFIRMED !== "true") {
    throw new Error("LumaPOS runtime is disabled until the PostgreSQL snapshot is reconciled and declared authoritative");
  }
  const value = environment.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is not configured");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".supabase.com") || host.endsWith(".supabase.co")) {
    throw new Error("LumaPOS self-hosted runtime cannot use a Supabase database endpoint");
  }
}
