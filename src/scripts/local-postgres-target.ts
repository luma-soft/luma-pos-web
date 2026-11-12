import { userInfo } from "node:os";

const DEFAULT_LOCAL_DATABASE_NAME = "lumapos_local";

export function getLocalPostgresTarget() {
  const databaseName =
    process.env.LUMAPOS_LOCAL_DATABASE_NAME?.trim() || DEFAULT_LOCAL_DATABASE_NAME;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/.test(databaseName)) {
    throw new Error("LUMAPOS_LOCAL_DATABASE_NAME must be a valid PostgreSQL database name");
  }

  const username = userInfo().username;
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
    throw new Error("The local macOS account name cannot be used safely in a PostgreSQL URL");
  }

  const url = new URL(`postgresql://127.0.0.1:5432/${databaseName}`);
  url.username = username;
  return { databaseName, url };
}
