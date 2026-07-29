import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const client = new PGlite();
const migrationFiles = readdirSync(`${projectRoot}/drizzle`)
  .filter((name) => name.endsWith(".sql"))
  .sort();

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

for (const file of migrationFiles.filter((name) => name < "0067_")) {
  await applyMigration(file);
}

const principalId = "83000000-0000-4000-8000-000000000001";
const actorId = "83000000-0000-4000-8000-000000000002";
const token = "existing-secret-token-must-not-enter-fence";
await client.query(
  "insert into profiles (id, full_name, role) values ($1, 'Principal', 'owner'), ($2, 'Actor', 'cashier')",
  [principalId, actorId],
);
await client.query(
  `insert into mobile_push_devices (
    user_id, effective_user_id, device_id, platform, token, binding_generation, enabled
  ) values ($1, $2, 'existing-device', 'ios', $3, 7, true)`,
  [principalId, actorId, token],
);

await applyMigration("0067_mobile_push_binding_fences.sql");
let fences = (await client.query(`
  select user_id, device_id, binding_generation, active
  from mobile_push_device_binding_fences
`)).rows;
assert.deepEqual(fences, [{
  user_id: principalId,
  device_id: "existing-device",
  binding_generation: 7,
  active: true,
}]);

await client.query(`
  update mobile_push_device_binding_fences
  set binding_generation = 8, active = false
  where user_id = $1 and device_id = 'existing-device'
`, [principalId]);
await applyMigration("0067_mobile_push_binding_fences.sql");
fences = (await client.query(`
  select binding_generation, active
  from mobile_push_device_binding_fences
`)).rows;
assert.deepEqual(fences, [{ binding_generation: 8, active: false }]);

const fenceColumns = (await client.query(`
  select column_name
  from information_schema.columns
  where table_name = 'mobile_push_device_binding_fences'
  order by ordinal_position
`)).rows.map((row) => row.column_name);
assert.deepEqual(fenceColumns, [
  "user_id",
  "device_id",
  "binding_generation",
  "active",
  "updated_at",
]);
const leakedToken = await client.query(
  `select 1
   from mobile_push_device_binding_fences
   where device_id = $1`,
  [token],
);
assert.equal(leakedToken.rows.length, 0);

await client.close();
console.log("✅ binding fence migration backfills generations without token leakage");
