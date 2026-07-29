import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const client = new PGlite();

async function applyMigration(file, database = client) {
  for (
    const statement of readFileSync(
      `${projectRoot}/drizzle/${file}`,
      "utf8",
    ).split("--> statement-breakpoint")
  ) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await database.exec(sql);
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
await client.exec(`
  GRANT ALL PRIVILEGES
    ON TABLE public.mobile_push_device_binding_fences
    TO anon;
  GRANT ALL PRIVILEGES
    ON TABLE public.mobile_push_device_binding_fences
    TO authenticated;
`);

const [vulnerableAcl] = (await client.query(`
  select
    bool_and(has_table_privilege('anon', c.oid, p.privilege))
      as anon_all_access,
    bool_and(has_table_privilege('authenticated', c.oid, p.privilege))
      as authenticated_all_access
  from pg_class c
  cross join (
    values
      ('SELECT'),
      ('INSERT'),
      ('UPDATE'),
      ('DELETE'),
      ('TRUNCATE'),
      ('REFERENCES'),
      ('TRIGGER')
  ) as p(privilege)
  where c.oid = 'public.mobile_push_device_binding_fences'::regclass
`)).rows;
assert.equal(
  vulnerableAcl.anon_all_access,
  true,
  "test precondition: anon starts with every table privilege",
);
assert.equal(
  vulnerableAcl.authenticated_all_access,
  true,
  "test precondition: authenticated starts with every table privilege",
);

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
    bool_or(has_table_privilege('anon', c.oid, p.privilege))
      as anon_any_access,
    bool_or(has_table_privilege('authenticated', c.oid, p.privilege))
      as authenticated_any_access,
    bool_and(has_table_privilege(current_user, c.oid, p.privilege))
      as owner_all_access
  from pg_class c
  cross join (
    values
      ('SELECT'),
      ('INSERT'),
      ('UPDATE'),
      ('DELETE'),
      ('TRUNCATE'),
      ('REFERENCES'),
      ('TRIGGER')
  ) as p(privilege)
  where c.oid = 'public.mobile_push_device_binding_fences'::regclass
  group by c.relrowsecurity
`)).rows;
assert.equal(security.relrowsecurity, true);
assert.equal(security.anon_any_access, false);
assert.equal(security.authenticated_any_access, false);
assert.equal(security.owner_all_access, true);

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

const rolesAbsentClient = new PGlite();
const roleCount = await rolesAbsentClient.query(`
  select count(*)::integer as count
  from pg_roles
  where rolname in ('anon', 'authenticated')
`);
assert.equal(
  roleCount.rows[0].count,
  0,
  "compatibility precondition: Data API roles are absent",
);
await rolesAbsentClient.exec(`
  create table public.mobile_push_device_binding_fences (
    user_id uuid not null,
    device_id varchar(120) not null,
    primary key (user_id, device_id)
  )
`);
await applyMigration(securityMigration, rolesAbsentClient);
await applyMigration(securityMigration, rolesAbsentClient);
const [rolesAbsentSecurity] = (await rolesAbsentClient.query(`
  select relrowsecurity
  from pg_class
  where oid = 'public.mobile_push_device_binding_fences'::regclass
`)).rows;
assert.equal(rolesAbsentSecurity.relrowsecurity, true);

await client.close();
await rolesAbsentClient.close();
console.log("✅ binding fence security is repeat-safe and preserves tombstones");
