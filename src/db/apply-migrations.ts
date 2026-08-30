/**
 * Apply migrations directly (no TTY needed). Run: bun run src/db/apply-migrations.ts
 *
 * Có bảng tracking `_migrations` — mỗi file chỉ apply 1 lần.
 * Lần đầu chạy trên DB cũ (chưa có tracking): replay tolerant — bỏ qua lỗi
 * "đã tồn tại" (table/type/column/index) rồi ghi nhận là đã apply.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { applyMigrationFileAtomically } from "./migration-runner";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

// Không đặt timeout qua startup param (pooler transaction mode không hỗ trợ);
// set bằng lệnh SET sau khi kết nối (migration nên chạy qua direct/session :5432).
const sql = postgres(url, { max: 1, prepare: false });

// lỗi kẹt khóa — thử lại được
const LOCK_ERRORS = new Set([
  "55P03", // lock_not_available (hết lock_timeout)
  "57014", // canceling statement (hết statement_timeout)
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Giới hạn thời gian chờ khóa/câu lệnh (chỉ có tác dụng khi chạy qua direct/session :5432).
try { await sql`set lock_timeout = '5s'`; await sql`set statement_timeout = '120s'`; } catch { /* pooler có thể bỏ qua */ }

await sql`create table if not exists _migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`;

const applied = new Set(
  (await sql`select name from _migrations`).map((r) => r.name as string)
);

const dir = "drizzle";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`⏭  ${file} (đã apply trước đó)`);
    continue;
  }
  console.log(`▶ Applying ${file}`);
  const content = readFileSync(join(dir, file), "utf8");
  let attempt = 0;
  let result;
  for (;;) {
    const connection = await sql.reserve();
    try {
      result = await applyMigrationFileAtomically(connection, file, content);
      break;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code && LOCK_ERRORS.has(code) && attempt < 5) {
        attempt++;
        console.log(`  ⏳ kẹt khóa (${code}), thử lại cả file lần ${attempt}/5…`);
        await sleep(2000 * attempt);
        continue;
      }
      throw error;
    } finally {
      connection.release();
    }
  }
  console.log(`  ✓ ${result.statementCount} statements${result.skippedCount ? ` (${result.skippedCount} đã tồn tại, bỏ qua)` : ""}`);
  ran++;
}

console.log(`\n✅ ${ran > 0 ? `Applied ${ran} migration(s)` : "Không có migration mới"} — tracking trong bảng _migrations`);
await sql.end();
process.exit(0);
