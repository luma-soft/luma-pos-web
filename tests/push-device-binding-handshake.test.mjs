import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import {
  deactivatePushDeviceBinding,
  registerPushDeviceBinding,
} from "../src/lib/notifications/device-registration-core.ts";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const client = new PGlite();
const database = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");

for (
  const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql"))
    .sort()
) {
  for (
    const statement of readFileSync(
      `${projectRoot}/drizzle/${file}`,
      "utf8",
    ).split("--> statement-breakpoint")
  ) {
    const sql = statement.trim();
    if (sql && !/create extension|gin_trgm_ops/i.test(sql)) await client.exec(sql);
  }
}

const ids = {
  principal: "81000000-0000-4000-8000-000000000001",
  oldActor: "81000000-0000-4000-8000-000000000002",
  newActor: "81000000-0000-4000-8000-000000000003",
  otherPrincipal: "81000000-0000-4000-8000-000000000004",
};
await database.insert(schema.profiles).values([
  { id: ids.principal, fullName: "Principal", role: "owner" },
  { id: ids.oldActor, fullName: "Old actor", role: "cashier" },
  { id: ids.newActor, fullName: "New actor", role: "cashier" },
  { id: ids.otherPrincipal, fullName: "Other principal", role: "owner" },
]);

const unknownDeviceId = "unknown-device-tombstone";
const unknownDeactivation = await deactivatePushDeviceBinding(database, {
  principalId: ids.principal,
  deviceId: unknownDeviceId,
  bindingGeneration: 2,
  now: new Date("2026-07-29T11:59:00.000Z"),
});
assert.deepEqual(unknownDeactivation, { kind: "deactivated" });
const lateUnknownRegistration = await registerPushDeviceBinding(database, {
  principalId: ids.principal,
  effectiveUserId: ids.newActor,
  device: {
    deviceId: unknownDeviceId,
    platform: "ios",
    token: "late-unknown-device-token-value",
    permission: "authorized",
    locale: "vi",
    bindingGeneration: 1,
  },
  now: new Date("2026-07-29T11:59:01.000Z"),
});
assert.deepEqual(lateUnknownRegistration, { kind: "stale" });
const unknownRows = await database.select()
  .from(schema.mobilePushDevices)
  .where(eq(schema.mobilePushDevices.deviceId, unknownDeviceId));
assert.equal(unknownRows.length, 0);
const repeatedUnknownDeactivation = await deactivatePushDeviceBinding(database, {
  principalId: ids.principal,
  deviceId: unknownDeviceId,
  bindingGeneration: 2,
  now: new Date("2026-07-29T11:59:02.000Z"),
});
assert.deepEqual(repeatedUnknownDeactivation, { kind: "deactivated" });

const isolatedRegistration = await registerPushDeviceBinding(database, {
  principalId: ids.otherPrincipal,
  effectiveUserId: ids.otherPrincipal,
  device: {
    deviceId: unknownDeviceId,
    platform: "android",
    token: "same-device-other-principal-token",
    permission: "authorized",
    bindingGeneration: 1,
  },
  now: new Date("2026-07-29T11:59:03.000Z"),
});
assert.deepEqual(isolatedRegistration, { kind: "registered" });

const [device] = await database.insert(schema.mobilePushDevices).values({
  userId: ids.principal,
  effectiveUserId: ids.oldActor,
  deviceId: "shared-terminal-handshake",
  platform: "ios",
  token: "old-shared-terminal-token-value",
  permission: "authorized",
  locale: "vi",
  bindingGeneration: 1,
  sendLeaseId: "82000000-0000-4000-8000-000000000001",
  sendLeaseGeneration: 1,
  sendLeaseExpiresAt: new Date("2026-07-29T12:02:00.000Z"),
}).returning();

const replacement = {
  deviceId: "shared-terminal-handshake",
  platform: "ios",
  token: "new-shared-terminal-token-value",
  permission: "authorized",
  locale: "en",
  bindingGeneration: 2,
};

const busy = await registerPushDeviceBinding(database, {
  principalId: ids.principal,
  effectiveUserId: ids.newActor,
  device: replacement,
  now: new Date("2026-07-29T12:00:00.000Z"),
});
assert.deepEqual(busy, { kind: "busy", retryAfterMs: 120_000 });
let [saved] = await database.select().from(schema.mobilePushDevices)
  .where(eq(schema.mobilePushDevices.id, device.id));
assert.equal(saved.effectiveUserId, ids.oldActor);
assert.equal(saved.token, "old-shared-terminal-token-value");

const rebound = await registerPushDeviceBinding(database, {
  principalId: ids.principal,
  effectiveUserId: ids.newActor,
  device: replacement,
  now: new Date("2026-07-29T12:02:01.000Z"),
});
assert.deepEqual(rebound, { kind: "registered" });
[saved] = await database.select().from(schema.mobilePushDevices)
  .where(eq(schema.mobilePushDevices.id, device.id));
assert.equal(saved.effectiveUserId, ids.newActor);
assert.equal(saved.token, "new-shared-terminal-token-value");
assert.equal(saved.bindingGeneration, 2);
assert.equal(saved.sendLeaseId, null);

const staleRotation = await registerPushDeviceBinding(database, {
  principalId: ids.principal,
  effectiveUserId: ids.oldActor,
  device: {
    ...replacement,
    token: "late-old-token-must-not-win",
    bindingGeneration: 1,
  },
  now: new Date("2026-07-29T12:02:02.000Z"),
});
assert.deepEqual(staleRotation, { kind: "stale" });
[saved] = await database.select().from(schema.mobilePushDevices)
  .where(eq(schema.mobilePushDevices.id, device.id));
assert.equal(saved.effectiveUserId, ids.newActor);
assert.equal(saved.token, "new-shared-terminal-token-value");

const deactivated = await deactivatePushDeviceBinding(database, {
  principalId: ids.principal,
  deviceId: replacement.deviceId,
  bindingGeneration: 3,
  now: new Date("2026-07-29T12:02:03.000Z"),
});
assert.deepEqual(deactivated, { kind: "deactivated" });
[saved] = await database.select().from(schema.mobilePushDevices)
  .where(eq(schema.mobilePushDevices.id, device.id));
assert.equal(saved.enabled, false);
assert.equal(saved.bindingGeneration, 3);

const lateRegistration = await registerPushDeviceBinding(database, {
  principalId: ids.principal,
  effectiveUserId: ids.newActor,
  device: replacement,
  now: new Date("2026-07-29T12:02:04.000Z"),
});
assert.deepEqual(lateRegistration, { kind: "stale" });
[saved] = await database.select().from(schema.mobilePushDevices)
  .where(eq(schema.mobilePushDevices.id, device.id));
assert.equal(saved.enabled, false);

const duplicateRegistration = {
  deviceId: "concurrent-idempotent-registration",
  platform: "android",
  token: "concurrent-idempotent-token-value",
  permission: "authorized",
  locale: "vi",
  bindingGeneration: 1,
};
const duplicateResults = await Promise.all([
  registerPushDeviceBinding(database, {
    principalId: ids.principal,
    effectiveUserId: ids.oldActor,
    device: duplicateRegistration,
    now: new Date("2026-07-29T12:03:00.000Z"),
  }),
  registerPushDeviceBinding(database, {
    principalId: ids.principal,
    effectiveUserId: ids.oldActor,
    device: duplicateRegistration,
    now: new Date("2026-07-29T12:03:00.000Z"),
  }),
]);
const duplicateRows = await database.select()
  .from(schema.mobilePushDevices)
  .where(eq(
    schema.mobilePushDevices.deviceId,
    duplicateRegistration.deviceId,
  ));
assert.deepEqual(duplicateResults, [
  { kind: "registered" },
  { kind: "registered" },
]);
assert.equal(duplicateRows.length, 1);

const inFlightDevice = {
  deviceId: "post-then-delete-fence",
  platform: "ios",
  token: "post-then-delete-real-pglite-token",
  permission: "authorized",
  bindingGeneration: 1,
};
const registrationInFlight = registerPushDeviceBinding(database, {
  principalId: ids.principal,
  effectiveUserId: ids.newActor,
  device: inFlightDevice,
  now: new Date("2026-07-29T12:04:00.000Z"),
});
await Promise.resolve();
const deactivationAfterPost = deactivatePushDeviceBinding(database, {
  principalId: ids.principal,
  deviceId: inFlightDevice.deviceId,
  bindingGeneration: 2,
  now: new Date("2026-07-29T12:04:01.000Z"),
});
const [inFlightRegistrationResult, inFlightDeactivationResult] =
  await Promise.all([registrationInFlight, deactivationAfterPost]);
assert.deepEqual(inFlightRegistrationResult, { kind: "registered" });
assert.deepEqual(inFlightDeactivationResult, { kind: "deactivated" });
const [postThenDelete] = await database.select()
  .from(schema.mobilePushDevices)
  .where(eq(schema.mobilePushDevices.deviceId, inFlightDevice.deviceId));
assert.equal(postThenDelete.enabled, false);
assert.equal(postThenDelete.bindingGeneration, 2);
const lateAfterConcurrentDelete = await registerPushDeviceBinding(database, {
  principalId: ids.principal,
  effectiveUserId: ids.newActor,
  device: inFlightDevice,
  now: new Date("2026-07-29T12:04:02.000Z"),
});
assert.deepEqual(lateAfterConcurrentDelete, { kind: "stale" });

await client.close();
console.log("✅ shared-terminal binding generation and active-send lease fence rebinds");
