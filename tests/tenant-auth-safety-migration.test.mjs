import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const STORE_A = "00000000-0000-4000-8000-000000000001";
const STORE_B = "00000000-0000-4000-8000-000000000010";
const USER_A = "00000000-0000-4000-8000-000000000002";
const USER_B = "00000000-0000-4000-8000-000000000011";
const migrationName = "0100_tenant_auth_safety.sql";
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
  const migrations = readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql") && name < migrationName)
    .sort();
  for (const name of migrations) {
    await applySqlFile(`${projectRoot}/drizzle/${name}`);
  }
  await database.exec(`
    insert into profiles (id, full_name, phone, role)
    values ('${USER_A}', 'Owner A', '0901 234 567', 'owner');
    insert into stores (id, slug) values ('${STORE_B}', 'store-b');
    insert into profiles (id, store_id, full_name, phone, role)
    values ('${USER_B}', '${STORE_B}', 'Owner B', '+84987654321', 'owner');
  `);
  await applySqlFile(`${projectRoot}/drizzle/${migrationName}`);
});

afterAll(async () => database.close());

describe("tenant auth safety migration", () => {
  test("normalizes globally unique internal-login phones", async () => {
    const rows = await database.query(
      "select id, phone_normalized from profiles order by id",
    );
    expect(rows.rows).toEqual([
      { id: USER_A, phone_normalized: "+84901234567" },
      { id: USER_B, phone_normalized: "+84987654321" },
    ]);
    await expect(database.exec(`
      insert into profiles (id, store_id, full_name, phone_normalized)
      values ('00000000-0000-4000-8000-000000000099', '${STORE_B}', 'Duplicate', '+84901234567')
    `)).rejects.toThrow();
  });

  test("database rejects cross-store approvals", async () => {
    await expect(database.exec(`
      insert into mobile_approvals (
        store_id, token_hash, requester_id, approver_id,
        permission, mode, expires_at
      ) values (
        '${STORE_A}', repeat('a', 64), '${USER_A}', '${USER_B}',
        'order.void', 'manager', now() + interval '2 minutes'
      )
    `)).rejects.toThrow();
  });

  test("database rejects invitations created by another store", async () => {
    await expect(database.exec(`
      insert into staff_invitations (
        store_id, email, role, token_hash, invited_by, expires_at
      ) values (
        '${STORE_A}', 'staff@example.com', 'cashier', repeat('b', 64),
        '${USER_B}', now() + interval '1 day'
      )
    `)).rejects.toThrow();
  });
});
