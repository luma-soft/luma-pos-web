/** One-off, store-scoped cleanup. Dry-run by default; never changes other prices. */
import { Client } from "pg";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const candidateQuery = `
  select pp.*, p.sku, p.name, p.cost_price, p.retail_price, p.is_active
  from product_prices pp
  join products p on p.id = pp.product_id and p.store_id = pp.store_id
  join price_books pb on pb.id = pp.price_book_id and pb.store_id = pp.store_id
  where pp.store_id = $1::uuid and pb.system_type = 'list'
    and pp.price <= p.cost_price
  order by pp.id`;

export async function clearListPrices(client, { storeId, expectedCount, backup }) {
  await client.query("begin isolation level repeatable read");
  try {
    await client.query("set local statement_timeout = '30s'");
    await client.query("set local lock_timeout = '5s'");
    const { rows } = await client.query(`${candidateQuery} for update of p, pp`, [storeId]);
    if (rows.length !== expectedCount) throw new Error(`Candidate count changed: expected ${expectedCount}, found ${rows.length}`);
    // A durable backup must succeed before any deletion. The transaction locks
    // prevent concurrent product/price edits changing the reviewed values.
    await backup(rows);
    if (rows.length) {
      const removed = await client.query(
        "delete from product_prices where store_id = $1::uuid and id = any($2::uuid[]) returning id",
        [storeId, rows.map((row) => row.id)],
      );
      if (removed.rows.length !== rows.length) throw new Error("Deleted count did not match backup");
      await client.query(`
        insert into audit_logs (store_id, source, action, entity_type, entity_id, status, "before", "after", metadata)
        select $1::uuid, 'system', 'product.price_book.updated', 'product', (r->>'product_id')::uuid, 'succeeded',
          jsonb_build_object('name', r->>'name', 'sku', r->>'sku', 'price', (r->>'price')::numeric),
          jsonb_build_object('name', r->>'name', 'sku', r->>'sku', 'price', null),
          jsonb_build_object('reason', 'list_price_at_or_below_cost', 'priceBookId', r->>'price_book_id',
            'priceBookName', 'Giá chưa chiết khấu', 'costPrice', (r->>'cost_price')::numeric, 'usesRetailPrice', false)
        from jsonb_array_elements($2::jsonb) r`, [storeId, JSON.stringify(rows)]);
    }
    const remaining = await client.query(candidateQuery, [storeId]);
    if (remaining.rows.length) throw new Error("Invalid list prices remain");
    await client.query("commit");
    return { cleared: rows.length, remaining: 0 };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  const storeId = args.includes("--store-id") ? value("--store-id") : "";
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) throw new Error("--store-id <uuid> is required");
  const apply = args.includes("--apply");
  const expectedCount = args.includes("--expect-count") ? Number(value("--expect-count")) : NaN;
  const backupPath = args.includes("--backup") ? value("--backup") : "";
  if (apply && (!Number.isInteger(expectedCount) || expectedCount < 0 || !backupPath)) {
    throw new Error("--apply requires --expect-count <n> and --backup <new-file.json>");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    if (!apply) {
      const { rows } = await client.query(candidateQuery, [storeId]);
      console.log(JSON.stringify({ storeId, candidates: rows.length, rows }, null, 2));
      return;
    }
    const result = await clearListPrices(client, {
      storeId, expectedCount,
      backup: (rows) => writeFile(backupPath, JSON.stringify({ storeId, createdAt: new Date().toISOString(), rows }, null, 2), { flag: "wx", mode: 0o600 }),
    });
    console.log(JSON.stringify({ ...result, backupPath: resolve(backupPath) }));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    // Do not log database objects or connection strings.
    console.error(error.code ?? error.message);
    process.exitCode = 1;
  });
}
