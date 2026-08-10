import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const CURRENT_STORE_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "00000000-0000-4000-8000-000000000002";
const migrationName = "0099_multi_tenant_foundation.sql";
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
  await database.exec(`
    alter default privileges in schema public grant all privileges on tables to anon;
    alter default privileges in schema public grant all privileges on tables to authenticated;
  `);

  const baseMigrations = readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql") && name < migrationName)
    .sort();
  for (const name of baseMigrations) {
    await applySqlFile(`${projectRoot}/drizzle/${name}`);
  }

  await database.exec(`
    insert into profiles (id, full_name, phone, role)
    values ('${PROFILE_ID}', 'Current owner', '+84901234567', 'owner');
    update store_settings
    set name = 'Current store', onboarded = true
    where id = 'default';
    update catalog_sync_state set revision = 42 where id = 1;
  `);

  await applySqlFile(`${projectRoot}/drizzle/${migrationName}`);
});

afterAll(async () => {
  await database.close();
});

describe("multi-tenant foundation migration", () => {
  test("creates the deterministic current store and preserves existing rows", async () => {
    const stores = await database.query(
      "select id, slug, status from stores order by id",
    );
    expect(stores.rows).toEqual([
      { id: CURRENT_STORE_ID, slug: "hai-dang", status: "active" },
    ]);

    const profiles = await database.query(
      "select id, store_id from profiles order by id",
    );
    expect(profiles.rows).toEqual([
      { id: PROFILE_ID, store_id: CURRENT_STORE_ID },
    ]);

    const settings = await database.query(
      "select id, store_id, name, onboarded from store_settings",
    );
    expect(settings.rows).toEqual([
      {
        id: "default",
        store_id: CURRENT_STORE_ID,
        name: "Current store",
        onboarded: true,
      },
    ]);
  });

  test("makes catalog revision state tenant-owned without losing its revision", async () => {
    const rows = await database.query(
      "select store_id, id, revision from catalog_sync_state",
    );
    expect(rows.rows).toEqual([
      { store_id: CURRENT_STORE_ID, id: 1, revision: 42 },
    ]);

    const primaryKey = await database.query(`
      select array_agg(a.attname order by u.ordinality) as columns
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as u(attnum, ordinality)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
      where c.conrelid = 'catalog_sync_state'::regclass and c.contype = 'p'
      group by c.oid
    `);
    expect(primaryKey.rows[0]?.columns).toEqual(["store_id", "id"]);
  });

  test("enables every existing optional feature for the current store", async () => {
    const features = await database.query(`
      select feature_key, enabled
      from store_features
      where store_id = '${CURRENT_STORE_ID}'
      order by feature_key
    `);
    expect(features.rows).toHaveLength(8);
    expect(features.rows.every((row) => row.enabled === true)).toBe(true);
  });

  test("creates a same-store invitation foundation", async () => {
    const columns = await database.query(`
      select column_name, is_nullable
      from information_schema.columns
      where table_name = 'staff_invitations'
    `);
    const names = new Set(columns.rows.map((row) => row.column_name));
    expect(names).toEqual(new Set([
      "id",
      "store_id",
      "email",
      "phone_normalized",
      "role",
      "token_hash",
      "invited_by",
      "expires_at",
      "accepted_at",
      "revoked_at",
      "created_at",
    ]));
  });

  test("keeps tenant foundation tables server-only", async () => {
    const security = await database.query(`
      select
        c.relname as table_name,
        c.relrowsecurity,
        has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
        has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select
      from pg_class c
      where c.oid in (
        'stores'::regclass,
        'store_features'::regclass,
        'staff_invitations'::regclass
      )
      order by c.relname
    `);
    expect(security.rows).toHaveLength(3);
    expect(security.rows.every((row) =>
      row.relrowsecurity === true
      && row.anon_select === false
      && row.authenticated_select === false
    )).toBe(true);
  });
});
