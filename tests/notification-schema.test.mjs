import { existsSync, readFileSync, readdirSync } from "node:fs";
import { strict as assert } from "node:assert";
import { PGlite } from "@electric-sql/pglite";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const client = new PGlite();
let fail = 0;
const ok = (name, condition) => {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
};

await client.exec("CREATE ROLE anon");
await client.exec("CREATE ROLE authenticated");

for (const file of readdirSync(`${PROJ}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${PROJ}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const eventColumns = await client.query(`
  select column_name
  from information_schema.columns
  where table_name = 'notification_events'
`);
ok("event schema exists", [
  "id", "event_key", "category", "entity_type", "entity_id", "actor_id",
  "target", "priority", "quiet_hours_policy", "metadata",
  "occurred_at", "created_at",
].every((name) => eventColumns.rows.some((row) => row.column_name === name)));

const outboxColumns = await client.query(`
  select column_name
  from information_schema.columns
  where table_name = 'notification_outbox'
`);
ok("outbox is provider neutral", [
  "event_id", "status", "provider", "provider_message_id", "attempt_count",
  "available_at", "lease_expires_at", "last_error_code",
  "published_at", "first_attempt_at", "completed_at",
].every((name) => outboxColumns.rows.some((row) => row.column_name === name)));

const storeSettingsColumns = await client.query(`
  select column_name
  from information_schema.columns
  where table_name = 'store_settings'
`);
ok("tracked migrations provide the store settings baseline", [
  "id", "name", "address", "phone", "tax_code", "industry", "currency",
  "locale", "onboarded", "prefs", "updated_at",
].every((name) =>
  storeSettingsColumns.rows.some((row) => row.column_name === name)
));

const recipientUnique = await client.query(`
  select 1
  from pg_constraint
  where conrelid = 'notification_recipients'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) =
      'UNIQUE (event_id, user_id)'
`);
ok(
  "recipient schema enforces one event/user row",
  recipientUnique.rows.length === 1,
);

const repairMigrationPath = `${PROJ}/drizzle/0066_internal_push_repair_cycle_2.sql`;
ok("repair cycle 2 migration is tracked", existsSync(repairMigrationPath));
if (existsSync(repairMigrationPath)) {
  for (const statement of readFileSync(repairMigrationPath, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql) await client.exec(sql);
  }
}

const [storeSettingsSecurity] = (await client.query(`
  select
    c.relrowsecurity,
    has_table_privilege('anon', 'public.store_settings', 'SELECT') as anon_select,
    has_table_privilege('authenticated', 'public.store_settings', 'UPDATE') as authenticated_update,
    has_table_privilege(current_user, 'public.store_settings', 'SELECT,INSERT,UPDATE,DELETE') as owner_access
  from pg_class c
  where c.oid = 'public.store_settings'::regclass
`)).rows;
ok("store settings explicitly enables row-level security", storeSettingsSecurity?.relrowsecurity === true);
ok(
  "Data API roles have no direct store settings privileges",
  storeSettingsSecurity?.anon_select === false
    && storeSettingsSecurity?.authenticated_update === false,
);
ok("migration owner retains server-side store settings access", storeSettingsSecurity?.owner_access === true);

const featureTableSecurity = await client.query(`
  select
    c.relname as table_name,
    c.relrowsecurity,
    bool_or(has_table_privilege('anon', c.oid, p.privilege)) as anon_any_access,
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
  where c.oid in (
    'public.store_settings'::regclass,
    'public.mobile_push_device_binding_fences'::regclass
  )
  group by c.relname, c.relrowsecurity
  order by c.relname
`);
ok(
  "feature-created server tables cannot silently omit RLS or Data API ACL revocation",
  featureTableSecurity.rows.length === 2
    && featureTableSecurity.rows.every((row) =>
      row.relrowsecurity === true
      && row.anon_any_access === false
      && row.authenticated_any_access === false
      && row.owner_all_access === true
    ),
);

const featureTablePolicies = await client.query(`
  select tablename, policyname
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'store_settings',
      'mobile_push_device_binding_fences'
    )
`);
ok(
  "feature-created server tables expose no Data API policy path",
  featureTablePolicies.rows.length === 0,
);

const repairColumns = await client.query(`
  select table_name, column_name
  from information_schema.columns
  where (table_name = 'notification_events' and column_name = 'contract_version')
     or (
       table_name = 'mobile_push_devices'
       and column_name in (
         'binding_generation',
         'send_lease_id',
         'send_lease_generation',
         'send_lease_expires_at'
       )
     )
`);
ok("repair migration tracks event version and durable device send lease", repairColumns.rows.length === 5);

const repairIndexes = await client.query(`
  select indexname, indexdef
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'notification_events_mobile_recent_valid_idx',
      'notification_recipients_event_user_visible_idx'
    )
`);
ok(
  "recent valid event scan and recipient probe indexes are tracked",
  repairIndexes.rows.length === 2
    && repairIndexes.rows.some((row) =>
      row.indexname === "notification_events_mobile_recent_valid_idx"
      && /created_at DESC, id DESC/i.test(row.indexdef)
      && /WHERE/i.test(row.indexdef)
    )
    && repairIndexes.rows.some((row) =>
      row.indexname === "notification_recipients_event_user_visible_idx"
      && /event_id, user_id/i.test(row.indexdef)
    ),
);

await client.close();
assert.equal(fail, 0, `${fail} notification schema checks failed`);
