import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const STORE_A = "00000000-0000-4000-8000-000000000001";
const STORE_B = "00000000-0000-4000-8000-000000000020";
const migrationName = "0102_core_tenant_category_uniqueness.sql";
const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const database = new PGlite();

async function applySqlFile(path) {
  const contents = readFileSync(path, "utf8");
  for (const statement of contents
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) await database.exec(statement);
  }
}

beforeAll(async () => {
  await database.exec("create role anon; create role authenticated;");
  const migrations = readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql") && name < "0101_core_tenant_isolation.sql")
    .sort();
  for (const name of migrations) await applySqlFile(`${projectRoot}/drizzle/${name}`);
  for (const name of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql") && name <= migrationName)
    .sort()) {
    if (name >= "0101_core_tenant_isolation.sql") {
      await applySqlFile(`${projectRoot}/drizzle/${name}`);
    }
  }
  await database.exec(`insert into stores (id, slug) values ('${STORE_B}', 'store-b')`);
});

afterAll(async () => database.close());

describe("core tenant isolation migration", () => {
  test("backfills and requires store ownership on every core root", async () => {
    const rootTables = [
      "categories", "brands", "price_books", "warehouses", "products",
      "stock_movements", "customers", "suppliers", "payment_bank_accounts",
      "orders", "payments", "customer_receivable_receipts",
      "customer_receivable_entries", "purchase_orders",
      "supplier_payable_receipts", "supplier_payable_entries", "stock_lots",
      "purchase_returns", "returns", "payment_refunds", "cash_transactions",
      "stocktakes", "print_templates", "label_templates", "shifts",
      "internal_use_issues",
    ];
    const columns = await database.query(`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'store_id'
    `);
    const owned = new Set(columns.rows.map((row) => row.table_name));
    expect(rootTables.every((table) => owned.has(table))).toBe(true);

    for (const table of rootTables) {
      const nullable = await database.query(`
        select is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = '${table}' and column_name = 'store_id'
      `);
      expect(nullable.rows[0]?.is_nullable).toBe("NO");
    }
  });

  test("allows store-scoped identifiers to repeat", async () => {
    await database.exec(`
      insert into warehouses (store_id, name, is_default)
      values ('${STORE_A}', 'Kho A', true), ('${STORE_B}', 'Kho B', true);
      insert into products (store_id, sku, name)
      values ('${STORE_A}', 'SAME-SKU', 'A'), ('${STORE_B}', 'SAME-SKU', 'B');
      insert into categories (store_id, name)
      values ('${STORE_A}', 'Cùng tên'), ('${STORE_B}', 'Cùng tên');
      insert into customers (store_id, code, name)
      values ('${STORE_A}', 'KH-SAME', 'A'), ('${STORE_B}', 'KH-SAME', 'B');
      insert into suppliers (store_id, code, name)
      values ('${STORE_A}', 'NCC-SAME', 'A'), ('${STORE_B}', 'NCC-SAME', 'B');
      insert into orders (store_id, code, status)
      values ('${STORE_A}', 'HD-SAME', 'completed'), ('${STORE_B}', 'HD-SAME', 'completed');
      insert into purchase_orders (store_id, code, supplier_id, warehouse_id)
      select s.store_id, 'PN-SAME', s.id, w.id
      from suppliers s join warehouses w on w.store_id = s.store_id
      where s.code = 'NCC-SAME';
    `);
    const rows = await database.query("select count(*)::int as count from products where sku = 'SAME-SKU'");
    expect(rows.rows[0]?.count).toBe(2);
    const orderRows = await database.query("select count(*)::int as count from orders where code = 'HD-SAME'");
    expect(orderRows.rows[0]?.count).toBe(2);
    const purchaseRows = await database.query("select count(*)::int as count from purchase_orders where code = 'PN-SAME'");
    expect(purchaseRows.rows[0]?.count).toBe(2);
  });

  test("rejects cross-store product and warehouse relationships", async () => {
    const products = await database.query(`select id, store_id from products order by store_id`);
    const warehouses = await database.query(`select id, store_id from warehouses order by store_id`);
    const productA = products.rows.find((row) => row.store_id === STORE_A);
    const warehouseB = warehouses.rows.find((row) => row.store_id === STORE_B);
    await expect(database.exec(`
      insert into stock_levels (store_id, product_id, warehouse_id)
      values ('${STORE_A}', '${productA.id}', '${warehouseB.id}')
    `)).rejects.toThrow();
  });

  test("rejects cross-store customer, supplier, order, and child relationships", async () => {
    const [customerB] = (await database.query(`select id from customers where store_id = '${STORE_B}' limit 1`)).rows;
    const [supplierB] = (await database.query(`select id from suppliers where store_id = '${STORE_B}' limit 1`)).rows;
    const [warehouseA] = (await database.query(`select id from warehouses where store_id = '${STORE_A}' limit 1`)).rows;
    const [orderB] = (await database.query(`select id from orders where store_id = '${STORE_B}' limit 1`)).rows;
    const [productA] = (await database.query(`select id from products where store_id = '${STORE_A}' limit 1`)).rows;

    await expect(database.exec(`
      insert into orders (store_id, code, customer_id, warehouse_id)
      values ('${STORE_A}', 'CROSS-CUSTOMER', '${customerB.id}', '${warehouseA.id}')
    `)).rejects.toThrow();
    await expect(database.exec(`
      insert into purchase_orders (store_id, code, supplier_id, warehouse_id)
      values ('${STORE_A}', 'CROSS-SUPPLIER', '${supplierB.id}', '${warehouseA.id}')
    `)).rejects.toThrow();
    await expect(database.exec(`
      insert into order_items (store_id, order_id, product_id, product_name, unit_name, unit_multiplier, quantity, unit_price, total)
      values ('${STORE_A}', '${orderB.id}', '${productA.id}', 'Cross', 'cái', 1, 1, 1, 1)
    `)).rejects.toThrow();
  });
});
