import { readFileSync, readdirSync } from "node:fs";
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

await client.close();
assert.equal(fail, 0, `${fail} notification schema checks failed`);
