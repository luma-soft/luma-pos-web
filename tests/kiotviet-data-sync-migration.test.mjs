import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const database = new PGlite();

async function applySqlFile(path) {
  const contents = readFileSync(path, "utf8");
  for (const statement of contents
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) {
      await database.exec(statement);
    }
  }
}

beforeAll(async () => {
  await database.exec("create role anon; create role authenticated;");
  for (const name of readdirSync(`${projectRoot}/drizzle`)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    await applySqlFile(`${projectRoot}/drizzle/${name}`);
  }
});

afterAll(async () => database.close());

describe("KiotViet remaining-data synchronization migration", () => {
  test("adds run audit, generic provenance, and missing source snapshot fields", async () => {
    const columns = await database.query(`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_name in ('kiotviet_sync_runs', 'kiotviet_source_mappings')
         or (table_name = 'suppliers' and column_name = 'is_active')
         or (table_name = 'returns' and column_name in ('refund_amount', 'settlement_status'))
         or (table_name = 'purchase_order_items' and column_name in ('product_name', 'sku', 'unit_name', 'unit_multiplier'))
         or (table_name = 'purchase_return_items' and column_name = 'unit_multiplier')
      order by table_name, ordinal_position
    `);

    expect(columns.rows).toEqual([
      { table_name: "kiotviet_source_mappings", column_name: "store_id", is_nullable: "NO" },
      { table_name: "kiotviet_source_mappings", column_name: "id", is_nullable: "NO" },
      { table_name: "kiotviet_source_mappings", column_name: "provider", is_nullable: "NO" },
      { table_name: "kiotviet_source_mappings", column_name: "entity_type", is_nullable: "NO" },
      { table_name: "kiotviet_source_mappings", column_name: "external_id", is_nullable: "NO" },
      { table_name: "kiotviet_source_mappings", column_name: "local_id", is_nullable: "NO" },
      { table_name: "kiotviet_source_mappings", column_name: "source_sha256", is_nullable: "NO" },
      { table_name: "kiotviet_source_mappings", column_name: "adoption_method", is_nullable: "NO" },
      { table_name: "kiotviet_source_mappings", column_name: "last_seen_run_id", is_nullable: "NO" },
      { table_name: "kiotviet_source_mappings", column_name: "deleted_at", is_nullable: "YES" },
      { table_name: "kiotviet_source_mappings", column_name: "created_at", is_nullable: "NO" },
      { table_name: "kiotviet_source_mappings", column_name: "updated_at", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "store_id", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "id", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "provider", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "phase", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "source_file_name", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "source_sha256", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "bundle_sha256", is_nullable: "YES" },
      { table_name: "kiotviet_sync_runs", column_name: "source_rows", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "source_documents", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "status", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "summary", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "error_details", is_nullable: "YES" },
      { table_name: "kiotviet_sync_runs", column_name: "started_at", is_nullable: "NO" },
      { table_name: "kiotviet_sync_runs", column_name: "completed_at", is_nullable: "YES" },
      { table_name: "purchase_order_items", column_name: "product_name", is_nullable: "YES" },
      { table_name: "purchase_order_items", column_name: "sku", is_nullable: "YES" },
      { table_name: "purchase_order_items", column_name: "unit_name", is_nullable: "YES" },
      { table_name: "purchase_order_items", column_name: "unit_multiplier", is_nullable: "NO" },
      { table_name: "purchase_return_items", column_name: "unit_multiplier", is_nullable: "NO" },
      { table_name: "returns", column_name: "refund_amount", is_nullable: "YES" },
      { table_name: "returns", column_name: "settlement_status", is_nullable: "YES" },
      { table_name: "suppliers", column_name: "is_active", is_nullable: "NO" },
    ]);
  });

  test("enforces tenant-scoped source identity and same-store run ownership", async () => {
    const constraints = await database.query(`
      select conname, contype
      from pg_constraint
      where conrelid in ('kiotviet_sync_runs'::regclass, 'kiotviet_source_mappings'::regclass)
      order by conname
    `);

    expect(constraints.rows).toEqual([
      { conname: "kiotviet_source_mappings_adoption_method_check", contype: "c" },
      { conname: "kiotviet_source_mappings_entity_type_check", contype: "c" },
      { conname: "kiotviet_source_mappings_pkey", contype: "p" },
      { conname: "kiotviet_source_mappings_run_tenant_fk", contype: "f" },
      { conname: "kiotviet_source_mappings_source_sha256_check", contype: "c" },
      { conname: "kiotviet_source_mappings_store_id_stores_id_fk", contype: "f" },
      { conname: "kiotviet_sync_runs_counts_check", contype: "c" },
      { conname: "kiotviet_sync_runs_pkey", contype: "p" },
      { conname: "kiotviet_sync_runs_source_sha256_check", contype: "c" },
      { conname: "kiotviet_sync_runs_status_check", contype: "c" },
      { conname: "kiotviet_sync_runs_store_id_id_unique", contype: "u" },
      { conname: "kiotviet_sync_runs_store_id_stores_id_fk", contype: "f" },
    ]);

    const indexes = await database.query(`
      select indexname
      from pg_indexes
      where indexname in (
        'kiotviet_source_mappings_store_external_idx',
        'kiotviet_source_mappings_store_local_idx',
        'kiotviet_source_mappings_store_run_idx',
        'kiotviet_sync_runs_store_status_idx'
      )
      order by indexname
    `);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "kiotviet_source_mappings_store_external_idx",
      "kiotviet_source_mappings_store_local_idx",
      "kiotviet_source_mappings_store_run_idx",
      "kiotviet_sync_runs_store_status_idx",
    ]);
  });

  test("keeps synchronization operations server-only behind RLS", async () => {
    const security = await database.query(`
      select c.relname,
             c.relrowsecurity,
             has_table_privilege('anon', c.oid, 'select') as anon_select,
             has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
             count(p.policyname)::int as policy_count
      from pg_class c
      left join pg_policies p
        on p.schemaname = 'public' and p.tablename = c.relname
      where c.relname in ('kiotviet_sync_runs', 'kiotviet_source_mappings')
      group by c.oid, c.relname, c.relrowsecurity
      order by c.relname
    `);
    expect(security.rows).toEqual([
      {
        relname: "kiotviet_source_mappings",
        relrowsecurity: true,
        anon_select: false,
        authenticated_select: false,
        policy_count: 0,
      },
      {
        relname: "kiotviet_sync_runs",
        relrowsecurity: true,
        anon_select: false,
        authenticated_select: false,
        policy_count: 0,
      },
    ]);
  });
});
