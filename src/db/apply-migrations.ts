/**
 * Apply migrations directly (no TTY needed). Run: bun run src/db/apply-migrations.ts
 *
 * Có bảng tracking `_migrations` — mỗi file chỉ apply 1 lần. Toàn bộ run giữ
 * một session advisory lock. Database cũ không có tracking phải khớp clean
 * migration state; duplicate/partial state sẽ fail và không được ghi tracking.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
  runMigrationChainWithReservedConnection,
} from "./migration-runner";

// Fail before constructing a client or attempting a network connection. The
// application DATABASE_URL may be a transaction pooler and is never a fallback.
const databaseConfig = readMigrationDatabaseUrl(process.env);

// Migration connections must use a direct/session endpoint. Session settings,
// backend PID checks, and the advisory lock all stay on one reserved connection.
const sql = createMigrationPostgresClient(databaseConfig);

const dir = "drizzle";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const migrations = files.map((name) => ({
  name,
  content: readFileSync(join(dir, name), "utf8"),
}));

const result = await runMigrationChainWithReservedConnection(sql, migrations, {
  // Configure DDL waits only after the global lock, so a second runner waits
  // for serialization instead of timing out while acquiring the run lock.
  afterLockAcquired: async (connection) => {
    await connection.unsafe("set lock_timeout = '5s'");
    await connection.unsafe("set statement_timeout = '120s'");
  },
  onFileStart: (file) => console.log(`▶ Applying ${file}`),
  onFileRetry: (file, code, attempt, maximum) => {
    console.log(`  ⏳ ${file} kẹt khóa (${code}), thử lại cả file lần ${attempt}/${maximum}…`);
  },
});
for (const file of result.skipped) console.log(`⏭  ${file} (đã apply trước đó)`);
console.log(`\n✅ ${result.applied.length > 0
  ? `Applied ${result.applied.length} migration(s)`
  : "Không có migration mới"} — tracking trong bảng _migrations`);
process.exit(0);
