import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const client = new PGlite();

async function applyMigration(file) {
  for (
    const statement of readFileSync(
      `${projectRoot}/drizzle/${file}`,
      "utf8",
    ).split("--> statement-breakpoint")
  ) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

await client.exec("CREATE ROLE anon");
await client.exec("CREATE ROLE authenticated");
for (
  const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql") && name < "0068_")
    .sort()
) {
  await applyMigration(file);
}

const principalId = "84000000-0000-4000-8000-000000000001";
await client.query(
  "insert into profiles (id, full_name, role) values ($1, 'Fence owner', 'owner')",
  [principalId],
);
await client.query(`
  insert into mobile_push_device_binding_fences (
    user_id, device_id, binding_generation, active, updated_at
  ) values ($1, 'preserved-tombstone', 9, false, '2026-07-30T01:02:03Z')
`, [principalId]);

const securityMigration = "0068_mobile_push_binding_fence_security.sql";
assert.equal(
  existsSync(`${projectRoot}/drizzle/${securityMigration}`),
  true,
  "0068 security migration must be tracked",
);
await applyMigration(securityMigration);
await applyMigration(securityMigration);

const [security] = (await client.query(`
  select
    c.relrowsecurity,
    has_table_privilege(
      'anon',
      'public.mobile_push_device_binding_fences',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) as anon_access,
    has_table_privilege(
      'authenticated',
      'public.mobile_push_device_binding_fences',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) as authenticated_access,
    has_table_privilege(
      current_user,
      'public.mobile_push_device_binding_fences',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) as owner_access
  from pg_class c
  where c.oid = 'public.mobile_push_device_binding_fences'::regclass
`)).rows;
assert.equal(security.relrowsecurity, true);
assert.equal(security.anon_access, false);
assert.equal(security.authenticated_access, false);
assert.equal(security.owner_access, true);

const policies = await client.query(`
  select policyname
  from pg_policies
  where schemaname = 'public'
    and tablename = 'mobile_push_device_binding_fences'
`);
assert.equal(policies.rows.length, 0);

const tombstones = (await client.query(`
  select user_id, device_id, binding_generation, active, updated_at
  from mobile_push_device_binding_fences
`)).rows;
assert.deepEqual(tombstones, [{
  user_id: principalId,
  device_id: "preserved-tombstone",
  binding_generation: 9,
  active: false,
  updated_at: new Date("2026-07-30T01:02:03.000Z"),
}]);

await client.close();
console.log("✅ binding fence security is repeat-safe and preserves tombstones");
