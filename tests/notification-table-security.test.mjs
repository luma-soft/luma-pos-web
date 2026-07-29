import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const notificationTables = [
  "notification_events",
  "notification_recipients",
  "notification_outbox",
];
const tablePrivileges = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];

async function applyMigration(file, database) {
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

const client = new PGlite();
await client.exec("CREATE ROLE anon");
await client.exec("CREATE ROLE authenticated");
for (
  const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql") && name < "0069_")
    .sort()
) {
  await applyMigration(file, client);
}

const principalId = "85000000-0000-4000-8000-000000000001";
const eventId = "85000000-0000-4000-8000-000000000002";
const recipientId = "85000000-0000-4000-8000-000000000003";
const outboxId = "85000000-0000-4000-8000-000000000004";
await client.query(
  "insert into profiles (id, full_name, role) values ($1, 'Notification owner', 'owner')",
  [principalId],
);
await client.query(`
  insert into notification_events (
    id, event_key, category, entity_type, entity_id, target, priority,
    quiet_hours_policy
  ) values (
    $1, 'security-preserved-event', 'invoiceCreated', 'order', $2,
    'invoices', 'normal', 'defer'
  )
`, [eventId, "85000000-0000-4000-8000-000000000005"]);
await client.query(`
  insert into notification_recipients (id, event_id, user_id, reason)
  values ($1, $2, $3, 'role')
`, [recipientId, eventId, principalId]);
await client.query(`
  insert into notification_outbox (id, event_id)
  values ($1, $2)
`, [outboxId, eventId]);

for (const table of notificationTables) {
  await client.exec(`
    GRANT ALL PRIVILEGES ON TABLE public.${table} TO anon;
    GRANT ALL PRIVILEGES ON TABLE public.${table} TO authenticated;
  `);
}

const vulnerableAcl = await client.query(`
  select
    c.relname as table_name,
    bool_and(has_table_privilege('anon', c.oid, p.privilege))
      as anon_all_access,
    bool_and(has_table_privilege('authenticated', c.oid, p.privilege))
      as authenticated_all_access
  from pg_class c
  cross join (
    values ${tablePrivileges.map((privilege) => `('${privilege}')`).join(", ")}
  ) as p(privilege)
  where c.relnamespace = 'public'::regnamespace
    and c.relname = any($1::text[])
  group by c.relname
  order by c.relname
`, [notificationTables]);
assert.equal(
  vulnerableAcl.rows.length,
  notificationTables.length,
  "test precondition: every notification table exists",
);
assert.equal(
  vulnerableAcl.rows.every((row) =>
    row.anon_all_access === true && row.authenticated_all_access === true
  ),
  true,
  "test precondition: both Data API roles start with every table privilege",
);

const securityMigration = "0069_notification_table_security.sql";
assert.equal(
  existsSync(`${projectRoot}/drizzle/${securityMigration}`),
  true,
  "0069 notification table security migration must be tracked",
);
await applyMigration(securityMigration, client);
await applyMigration(securityMigration, client);

const security = await client.query(`
  select
    c.relname as table_name,
    c.relrowsecurity,
    bool_or(has_table_privilege('anon', c.oid, p.privilege))
      as anon_any_access,
    bool_or(has_table_privilege('authenticated', c.oid, p.privilege))
      as authenticated_any_access,
    bool_and(has_table_privilege(current_user, c.oid, p.privilege))
      as owner_all_access
  from pg_class c
  cross join (
    values ${tablePrivileges.map((privilege) => `('${privilege}')`).join(", ")}
  ) as p(privilege)
  where c.relnamespace = 'public'::regnamespace
    and c.relname = any($1::text[])
  group by c.relname, c.relrowsecurity
  order by c.relname
`, [notificationTables]);
assert.deepEqual(
  security.rows.map((row) => ({
    tableName: row.table_name,
    rls: row.relrowsecurity,
    anonAccess: row.anon_any_access,
    authenticatedAccess: row.authenticated_any_access,
    ownerAccess: row.owner_all_access,
  })),
  [...notificationTables].sort().map((tableName) => ({
    tableName,
    rls: true,
    anonAccess: false,
    authenticatedAccess: false,
    ownerAccess: true,
  })),
);

const policies = await client.query(`
  select tablename, policyname
  from pg_policies
  where schemaname = 'public'
    and tablename = any($1::text[])
`, [notificationTables]);
assert.equal(policies.rows.length, 0, "repair adds no permissive policy");

assert.deepEqual(
  (await client.query(`
    select
      (select count(*)::integer from notification_events) as events,
      (select count(*)::integer from notification_recipients) as recipients,
      (select count(*)::integer from notification_outbox) as outbox
  `)).rows,
  [{ events: 1, recipients: 1, outbox: 1 }],
  "repair preserves existing notification rows",
);

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
for (const table of notificationTables) {
  await rolesAbsentClient.exec(`create table public.${table} (id integer)`);
}
await applyMigration(securityMigration, rolesAbsentClient);
await applyMigration(securityMigration, rolesAbsentClient);
const rolesAbsentSecurity = await rolesAbsentClient.query(`
  select relname as table_name, relrowsecurity
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname = any($1::text[])
  order by relname
`, [notificationTables]);
assert.deepEqual(
  rolesAbsentSecurity.rows,
  [...notificationTables].sort().map((table_name) => ({
    table_name,
    relrowsecurity: true,
  })),
);

await client.close();
await rolesAbsentClient.close();
console.log("✅ notification table security is repeat-safe and preserves rows");
