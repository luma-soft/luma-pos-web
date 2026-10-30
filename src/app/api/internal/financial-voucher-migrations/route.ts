import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
  runMigrationChainWithReservedConnection,
  type MigrationSource,
} from "@/db/migration-runner";
import { requireStoreRole } from "@/lib/auth/store-context";

export const runtime = "nodejs";
export const maxDuration = 300;

const productionProjectRef = "awomvgzxylucxjkkmmjp";
const migrations: MigrationSource[] = [{
  name: "0143_financial_voucher_cancellation.sql",
  content: String.raw`ALTER TABLE customer_receivable_receipts
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES profiles(id),
  ADD COLUMN cancellation_reason text;

ALTER TABLE supplier_payable_receipts
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES profiles(id),
  ADD COLUMN cancellation_reason text;

ALTER TABLE cash_transactions
  ADD COLUMN status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES profiles(id),
  ADD COLUMN cancellation_reason text,
  ADD CONSTRAINT cash_transactions_status_check
    CHECK (status IN ('confirmed', 'cancelled'));

CREATE INDEX cash_tx_status_created_idx
  ON cash_transactions (status, created_at DESC);

CREATE UNIQUE INDEX cash_tx_cancellation_reference_idx
  ON cash_transactions (store_id, ref_type, ref_id)
  WHERE ref_type IN (
    'cash_transaction_cancellation',
    'customer_receivable_receipt_cancellation',
    'supplier_payable_receipt_cancellation'
  );`,
}];

function safeSqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let context;
  try {
    context = await requireStoreRole(["owner"]);
  } catch {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (context.storeSlug !== "hai-dang") {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const applicationDatabaseUrl = process.env.DATABASE_URL;
  if (!supabaseUrl || !applicationDatabaseUrl) {
    return Response.json({ ok: false, error: "database_unavailable" }, { status: 503 });
  }

  let applicationUrl: URL;
  let apiProjectHost: string;
  try {
    applicationUrl = new URL(applicationDatabaseUrl);
    apiProjectHost = new URL(supabaseUrl).hostname;
  } catch {
    return Response.json({ ok: false, error: "database_unavailable" }, { status: 503 });
  }

  const decodedUsername = decodeURIComponent(applicationUrl.username);
  if (
    apiProjectHost !== `${productionProjectRef}.supabase.co`
    || !["postgres:", "postgresql:"].includes(applicationUrl.protocol)
    || applicationUrl.port !== "6543"
    || !applicationUrl.hostname.endsWith(".pooler.supabase.com")
    || !decodedUsername.includes(productionProjectRef)
  ) {
    return Response.json({ ok: false, error: "database_target_mismatch" }, { status: 503 });
  }

  const migrationUrl = new URL(applicationUrl);
  migrationUrl.port = "5432";
  for (const key of ["pgbouncer", "pool_mode", "pool-mode", "mode"]) {
    migrationUrl.searchParams.delete(key);
  }

  let phase = "configure";
  let runnerStarted = false;
  let sql: ReturnType<typeof createMigrationPostgresClient> | undefined;
  try {
    const databaseConfig = readMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: migrationUrl.toString() });
    sql = createMigrationPostgresClient(databaseConfig);

    phase = "connect";
    await sql.unsafe("select 1");

    phase = "run_migrations";
    runnerStarted = true;
    const result = await runMigrationChainWithReservedConnection(sql, migrations, {
      afterLockAcquired: async (connection) => {
        await connection.unsafe("set lock_timeout = '5s'");
        await connection.unsafe("set statement_timeout = '120s'");
      },
    });

    return Response.json({ ok: true, ...result }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Temporary financial-voucher migration failed", {
      phase,
      errorType: error instanceof Error ? error.name : typeof error,
      sqlState: safeSqlState(error),
    });
    return Response.json({
      ok: false,
      error: "migration_failed",
      phase,
      sqlState: safeSqlState(error),
    }, { status: 500, headers: { "cache-control": "no-store" } });
  } finally {
    if (sql && !runnerStarted) {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  }
}
