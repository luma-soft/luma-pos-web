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

// These are the only pending migration files in production, copied verbatim
// from drizzle/ so the temporary runner does not depend on bundled SQL files.
const migrations: MigrationSource[] = [
  {
    name: "0142_partner_debt_bank_accounts.sql",
    content: String.raw`ALTER TABLE supplier_payable_receipts
  ADD COLUMN bank_account_id uuid REFERENCES payment_bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX supplier_payable_receipts_bank_account_idx
  ON supplier_payable_receipts (bank_account_id);

ALTER TABLE customer_receivable_receipts
  ADD COLUMN bank_account_id uuid REFERENCES payment_bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX customer_receivable_receipts_bank_account_idx
  ON customer_receivable_receipts (bank_account_id);`,
  },
  {
    name: "0142_sync_stock_level_projection.sql",
    content: String.raw`CREATE OR REPLACE FUNCTION sync_product_stock(p uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE products
  SET total_stock = coalesce((SELECT sum(quantity) FROM stock_levels WHERE product_id = p), 0),
      min_stock = coalesce((SELECT max(min_level) FROM stock_levels WHERE product_id = p), 0)
  WHERE id = p;
$$;

CREATE OR REPLACE FUNCTION trg_sync_product_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_product_stock(OLD.product_id);
  ELSE
    PERFORM sync_product_stock(NEW.product_id);
    IF TG_OP = 'UPDATE' AND NEW.product_id <> OLD.product_id THEN
      PERFORM sync_product_stock(OLD.product_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS stock_levels_sync ON stock_levels;
CREATE TRIGGER stock_levels_sync
  AFTER INSERT OR UPDATE OR DELETE ON stock_levels
  FOR EACH ROW EXECUTE FUNCTION trg_sync_product_stock();

UPDATE products p
SET total_stock = coalesce((SELECT sum(quantity) FROM stock_levels WHERE product_id = p.id), 0),
    min_stock = coalesce((SELECT max(min_level) FROM stock_levels WHERE product_id = p.id), 0);`,
  },
];

function safeSqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) {
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

  const expectedProjectHost = `${productionProjectRef}.supabase.co`;
  const decodedUsername = decodeURIComponent(applicationUrl.username);
  if (
    apiProjectHost !== expectedProjectHost
    || applicationUrl.protocol !== "postgres:" && applicationUrl.protocol !== "postgresql:"
    || applicationUrl.port !== "6543"
    || !applicationUrl.hostname.endsWith(".pooler.supabase.com")
    || !decodedUsername.includes(productionProjectRef)
  ) {
    return Response.json({ ok: false, error: "database_target_mismatch" }, { status: 503 });
  }

  const migrationUrl = new URL(applicationUrl);
  migrationUrl.port = "5432";
  migrationUrl.searchParams.delete("pgbouncer");
  migrationUrl.searchParams.delete("pool_mode");
  migrationUrl.searchParams.delete("pool-mode");
  migrationUrl.searchParams.delete("mode");

  let phase = "configure";
  let runnerStarted = false;
  let sql: ReturnType<typeof createMigrationPostgresClient> | undefined;
  try {
    const databaseConfig = readMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL: migrationUrl.toString(),
    });
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
    console.error("Temporary partner-debt migration failed", {
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
