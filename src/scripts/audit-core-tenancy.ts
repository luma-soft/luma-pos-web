import { readdirSync } from "node:fs";
import postgres from "postgres";
import { CURRENT_STORE_ID } from "@/lib/tenancy/constants";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL not set");

const postMigration = !process.argv.includes("--preflight");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

const coreTables = [
  "categories", "brands", "price_books", "product_prices", "warehouses",
  "products", "product_combo_items", "product_suppliers", "stock_levels",
  "stock_movements", "customers", "suppliers", "payment_bank_accounts",
  "orders", "order_items", "payments", "customer_receivable_receipts",
  "customer_receivable_allocations", "customer_receivable_entries",
  "purchase_orders", "purchase_order_items", "supplier_payable_receipts",
  "supplier_payable_allocations", "supplier_payable_entries", "stock_lots",
  "purchase_returns", "purchase_return_items", "returns", "return_items",
  "payment_refunds", "cash_transactions", "stocktakes", "stocktake_items",
  "print_templates", "label_templates", "shifts", "internal_use_issues",
  "internal_use_items",
] as const;

const requiredCompositeFks = [
  "stock_levels_store_product_fk", "stock_levels_store_warehouse_fk",
  "product_prices_store_book_fk", "product_prices_store_product_fk",
  "product_suppliers_store_product_fk", "product_suppliers_store_supplier_fk",
  "products_store_category_fk", "products_store_brand_fk", "products_store_supplier_fk",
  "stock_movements_store_product_fk", "stock_movements_store_warehouse_fk",
  "orders_store_customer_fk", "orders_store_warehouse_fk",
  "order_items_store_order_fk", "order_items_store_product_fk", "payments_store_order_fk",
  "purchase_orders_store_supplier_fk", "purchase_orders_store_warehouse_fk",
  "purchase_order_items_store_purchase_fk", "purchase_order_items_store_product_fk",
  "purchase_returns_store_purchase_fk", "purchase_returns_store_supplier_fk",
  "purchase_returns_store_warehouse_fk", "purchase_return_items_store_return_fk",
  "purchase_return_items_store_product_fk", "returns_store_order_fk",
  "returns_store_customer_fk", "returns_store_warehouse_fk",
  "return_items_store_return_fk", "return_items_store_product_fk",
  "payment_refunds_store_return_fk", "payment_refunds_store_payment_fk",
  "stocktakes_store_warehouse_fk", "stocktake_items_store_stocktake_fk",
  "stocktake_items_store_product_fk", "internal_use_issues_store_warehouse_fk",
  "internal_use_items_store_issue_fk", "internal_use_items_store_product_fk",
] as const;

function assertAudit(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`CORE_TENANCY_AUDIT_FAILED: ${message}`);
}

async function tableExists(table: string) {
  const [row] = await sql.unsafe<{ exists: boolean }[]>(
    "select to_regclass($1) is not null as exists",
    [`public.${table}`],
  );
  return row.exists;
}

try {
  const counts: Record<string, number> = {};
  for (const table of coreTables) {
    if (!(await tableExists(table))) continue;
    const [row] = await sql.unsafe<{ count: number }[]>(
      `select count(*)::int as count from public."${table}"`,
    );
    counts[table] = row.count;
  }

  const [balances] = await sql<[{ stock_quantity: string; stock_reserved: string; customer_debt: string; supplier_debt: string; order_total: string; order_paid: string; purchase_total: string; purchase_paid: string; return_total: string; cash_net: string }]>`
    select
      (select coalesce(sum(quantity), 0)::text from stock_levels) as stock_quantity,
      (select coalesce(sum(reserved), 0)::text from stock_levels) as stock_reserved,
      (select coalesce(sum(current_debt), 0)::text from customers) as customer_debt,
      (select coalesce(sum(current_debt), 0)::text from suppliers) as supplier_debt,
      (select coalesce(sum(total), 0)::text from orders) as order_total,
      (select coalesce(sum(amount_paid), 0)::text from orders) as order_paid,
      (select coalesce(sum(total), 0)::text from purchase_orders) as purchase_total,
      (select coalesce(sum(amount_paid), 0)::text from purchase_orders) as purchase_paid,
      (select coalesce(sum(total_refund), 0)::text from returns) as return_total,
      (select coalesce(sum(case when type = 'in' then amount else -amount end), 0)::text from cash_transactions) as cash_net
  `;

  const result: Record<string, unknown> = {
    mode: postMigration ? "post-migration" : "preflight",
    currentStoreId: CURRENT_STORE_ID,
    counts,
    balances,
  };

  if (postMigration) {
    const columns = await sql<{ table_name: string; is_nullable: "YES" | "NO" }[]>`
      select table_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and column_name = 'store_id'
        and table_name = any(${coreTables as unknown as string[]})
    `;
    const owned = new Map(columns.map((row) => [row.table_name, row.is_nullable]));
    const missing = coreTables.filter((table) => !owned.has(table));
    const nullable = coreTables.filter((table) => owned.get(table) !== "NO");
    assertAudit(missing.length === 0, `missing store_id: ${missing.join(", ")}`);
    assertAudit(nullable.length === 0, `nullable store_id: ${nullable.join(", ")}`);

    const nullOrWrong: Record<string, number> = {};
    for (const table of coreTables) {
      const [row] = await sql.unsafe<{ count: number }[]>(
        `select count(*)::int as count from public."${table}" row where store_id is null or not exists (select 1 from public.stores where stores.id = row.store_id)`,
      );
      nullOrWrong[table] = row.count;
    }
    assertAudit(
      Object.values(nullOrWrong).every((count) => count === 0),
      "core rows have a null or orphaned store",
    );

    const constraints = await sql<{ conname: string }[]>`
      select conname from pg_constraint where conname = any(${requiredCompositeFks as unknown as string[]})
    `;
    const presentConstraints = new Set(constraints.map((row) => row.conname));
    const missingConstraints = requiredCompositeFks.filter((name) => !presentConstraints.has(name));
    assertAudit(missingConstraints.length === 0, `missing composite FKs: ${missingConstraints.join(", ")}`);

    const migrationFiles = readdirSync("drizzle").filter((name) => name.endsWith(".sql")).sort();
    const applied = await sql<{ name: string }[]>`select name from _migrations`;
    const appliedNames = new Set(applied.map((row) => row.name));
    const pendingMigrations = migrationFiles.filter((name) => !appliedNames.has(name));
    assertAudit(appliedNames.has("0101_core_tenant_isolation.sql"), "0101 migration is not tracked as applied");
    assertAudit(pendingMigrations.length === 0, `pending migrations: ${pendingMigrations.join(", ")}`);

    result.nullOrWrongStoreRows = nullOrWrong;
    result.compositeForeignKeys = requiredCompositeFks.length;
    result.pendingMigrations = pendingMigrations;
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
