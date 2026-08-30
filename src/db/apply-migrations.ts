/**
 * Apply migrations directly (no TTY needed). Run: bun run src/db/apply-migrations.ts
 *
 * Có bảng tracking `_migrations` — mỗi file chỉ apply 1 lần. Toàn bộ run giữ
 * một session advisory lock. Database cũ không có tracking phải khớp clean
 * migration state; duplicate/partial state sẽ fail và không được ghi tracking.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { runMigrationChain } from "./migration-runner";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

// Không đặt timeout qua startup param (pooler transaction mode không hỗ trợ);
// set bằng lệnh SET sau khi kết nối (migration nên chạy qua direct/session :5432).
const sql = postgres(url, { max: 1, prepare: false });

const dir = "drizzle";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const migrations = files.map((name) => ({
  name,
  content: readFileSync(join(dir, name), "utf8"),
}));

const connection = await sql.reserve();
try {
  const result = await runMigrationChain(connection, migrations, {
    // Configure DDL waits only after the global lock, so a second runner waits
    // for serialization instead of timing out while acquiring the run lock.
    afterLockAcquired: async () => {
      try {
        await connection.unsafe("set lock_timeout = '5s'");
        await connection.unsafe("set statement_timeout = '120s'");
      } catch { /* transaction-mode poolers may reject session settings */ }
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
} finally {
  connection.release();
  await sql.end();
}
process.exit(0);
