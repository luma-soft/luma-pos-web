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

describe("KiotViet product synchronization migration", () => {
  test("adds tenant-owned source mappings, related products, and alternate-unit SKUs", async () => {
    const columns = await database.query(`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where (table_name = 'product_source_mappings')
         or (table_name = 'products' and column_name = 'related_product_id')
         or (table_name = 'product_units' and column_name = 'sku')
      order by table_name, ordinal_position
    `);

    expect(columns.rows).toEqual([
      { table_name: "product_source_mappings", column_name: "store_id", is_nullable: "NO" },
      { table_name: "product_source_mappings", column_name: "id", is_nullable: "NO" },
      { table_name: "product_source_mappings", column_name: "product_id", is_nullable: "NO" },
      { table_name: "product_source_mappings", column_name: "provider", is_nullable: "NO" },
      { table_name: "product_source_mappings", column_name: "external_id", is_nullable: "NO" },
      { table_name: "product_source_mappings", column_name: "last_seen_at", is_nullable: "NO" },
      { table_name: "product_source_mappings", column_name: "deleted_at", is_nullable: "YES" },
      { table_name: "product_source_mappings", column_name: "created_at", is_nullable: "NO" },
      { table_name: "product_source_mappings", column_name: "updated_at", is_nullable: "NO" },
      { table_name: "product_units", column_name: "sku", is_nullable: "YES" },
      { table_name: "products", column_name: "related_product_id", is_nullable: "YES" },
    ]);
  });

  test("enforces tenant coordinates and source identity uniqueness", async () => {
    const constraints = await database.query(`
      select conname, contype
      from pg_constraint
      where conrelid = 'product_source_mappings'::regclass
      order by conname
    `);
    expect(constraints.rows).toEqual([
      { conname: "product_source_mappings_pkey", contype: "p" },
      { conname: "product_source_mappings_product_tenant_fk", contype: "f" },
      { conname: "product_source_mappings_store_id_stores_id_fk", contype: "f" },
    ]);

    const indexes = await database.query(`
      select indexname, indexdef
      from pg_indexes
      where tablename in ('product_source_mappings', 'product_units')
        and indexname in (
          'product_source_mappings_store_external_idx',
          'product_source_mappings_store_product_idx',
          'product_units_store_sku_idx'
        )
      order by indexname
    `);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "product_source_mappings_store_external_idx",
      "product_source_mappings_store_product_idx",
      "product_units_store_sku_idx",
    ]);
    expect(indexes.rows.every((row) => /UNIQUE INDEX/i.test(row.indexdef))).toBe(true);
  });

  test("keeps source mappings server-only behind RLS", async () => {
    const security = await database.query(`
      select c.relrowsecurity,
             has_table_privilege('anon', c.oid, 'select') as anon_select,
             has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
             count(p.policyname)::int as policy_count
      from pg_class c
      left join pg_policies p
        on p.schemaname = 'public' and p.tablename = c.relname
      where c.oid = 'product_source_mappings'::regclass
      group by c.oid, c.relrowsecurity
    `);
    expect(security.rows).toEqual([{
      relrowsecurity: true,
      anon_select: false,
      authenticated_select: false,
      policy_count: 0,
    }]);
  });
});
