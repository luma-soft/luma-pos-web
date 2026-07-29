import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const events = await import(`${projectRoot}/src/lib/notifications/events-core.ts`);
const {
  createNotificationOutboxCore,
} = await import(`${projectRoot}/src/lib/notifications/outbox-core.ts`);
const {
  mobilePushDeliveries,
  mobilePushDevices,
  notificationEvents,
  notificationOutbox,
  notificationRecipients,
  profiles,
  storeSettings,
} = schema;

const client = new PGlite();
const db = drizzle(client, { schema });

for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

await client.exec(`
  CREATE TABLE "store_settings" (
    "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
    "name" text DEFAULT '' NOT NULL,
    "address" text DEFAULT '' NOT NULL,
    "phone" text DEFAULT '' NOT NULL,
    "tax_code" text DEFAULT '' NOT NULL,
    "industry" text DEFAULT 'grocery' NOT NULL,
    "currency" text DEFAULT 'VND' NOT NULL,
    "locale" text DEFAULT 'vi-VN' NOT NULL,
    "onboarded" boolean DEFAULT false NOT NULL,
    "prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
  )
`);

const userIds = {
  owner: "20000000-0000-4000-8000-000000000001",
  manager: "20000000-0000-4000-8000-000000000002",
  cashier: "20000000-0000-4000-8000-000000000003",
  inactive: "20000000-0000-4000-8000-000000000004",
};
await db.insert(profiles).values([
  { id: userIds.owner, fullName: "Owner", role: "owner" },
  { id: userIds.manager, fullName: "Manager", role: "manager" },
  { id: userIds.cashier, fullName: "Cashier", role: "cashier" },
  { id: userIds.inactive, fullName: "Inactive", role: "manager", isActive: false },
]);
await db.insert(storeSettings).values({ id: "default" });

const [ownerDevice, managerDevice, cashierDevice] = await db.insert(mobilePushDevices).values([
  {
    userId: userIds.owner,
    effectiveUserId: userIds.owner,
    deviceId: "owner-device",
    platform: "ios",
    token: "owner-token",
    permission: "authorized",
    locale: "vi",
  },
  {
    userId: userIds.manager,
    effectiveUserId: userIds.manager,
    deviceId: "manager-device",
    platform: "android",
    token: "manager-token",
    permission: "authorized",
    locale: "en",
  },
  {
    userId: userIds.cashier,
    effectiveUserId: userIds.cashier,
    deviceId: "cashier-device",
    platform: "android",
    token: "cashier-token",
    permission: "authorized",
    locale: "vi",
  },
]).returning();

let eventSequence = 0;
async function seedEvent({
  category = "invoiceCreated",
  target = "invoices",
  priority = "normal",
  quietHoursPolicy = "defer",
  directUserIds,
  status = "published",
} = {}) {
  eventSequence += 1;
  const suffix = String(eventSequence).padStart(12, "0");
  const entityId = `30000000-0000-4000-8000-${suffix}`;
  const created = await db.transaction((tx) => events.createNotificationEventInTx(tx, {
    eventKey: `outbox-test:${eventSequence}`,
    category,
    entityType: category.startsWith("qr") ? "payment" : "order",
    entityId,
    target,
    priority,
    quietHoursPolicy,
    directUserIds,
  }));
  assert.ok(created?.eventId);
  await db.update(notificationOutbox).set({
    status,
    availableAt: new Date("2026-07-28T11:00:00.000Z"),
    publishedAt: status === "published" ? new Date("2026-07-28T12:00:00.000Z") : null,
  }).where(eq(notificationOutbox.eventId, created.eventId));
  return { eventId: created.eventId, entityId };
}

async function outboxRow(eventId) {
  const [row] = await db.select().from(notificationOutbox)
    .where(eq(notificationOutbox.eventId, eventId));
  return row;
}

async function deliveryRow(deviceId, eventId) {
  const [row] = await db.select().from(mobilePushDeliveries).where(and(
    eq(mobilePushDeliveries.deviceId, deviceId),
    eq(mobilePushDeliveries.notificationKey, `event:${eventId}`),
  ));
  return row;
}

function core({
  now = new Date("2026-07-28T12:00:00.000Z"),
  publisher = { async publish() { return { providerMessageId: "provider-message" }; } },
  sender = async () => ({ kind: "sent" }),
} = {}) {
  return createNotificationOutboxCore({
    database: db,
    publisher,
    sender,
    now: () => new Date(now),
    jitter: () => 0,
  });
}

// A conditional publication lease makes the externally visible publishing state
// committed before network I/O and rejects a concurrent claim.
{
  const seeded = await seedEvent({ status: "pending" });
  let releasePublisher;
  let publishStarted;
  const started = new Promise((resolve) => { publishStarted = resolve; });
  const release = new Promise((resolve) => { releasePublisher = resolve; });
  let calls = 0;
  const service = core({
    publisher: {
      async publish() {
        calls += 1;
        assert.equal((await outboxRow(seeded.eventId)).status, "publishing");
        publishStarted();
        await release;
        return { providerMessageId: "claim-message" };
      },
    },
  });
  const first = service.publishCommittedNotification(seeded.eventId);
  await started;
  assert.equal(await service.publishCommittedNotification(seeded.eventId), false);
  assert.equal(calls, 1);
  releasePublisher();
  assert.equal(await first, true);
  assert.equal((await outboxRow(seeded.eventId)).status, "published");
}

// An expired publication owner cannot report or persist over its replacement.
{
  const seeded = await seedEvent({ status: "pending" });
  let clock = new Date("2026-07-28T12:00:00.000Z");
  let releaseFirst;
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const release = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const service = createNotificationOutboxCore({
    database: db,
    publisher: {
      async publish() {
        calls += 1;
        if (calls === 1) {
          firstStarted();
          await release;
          return { providerMessageId: "stale-publication" };
        }
        return { providerMessageId: "replacement-publication" };
      },
    },
    sender: async () => ({ kind: "sent" }),
    now: () => new Date(clock),
    jitter: () => 0,
  });
  const first = service.publishCommittedNotification(seeded.eventId);
  await started;
  clock = new Date("2026-07-28T12:00:31.000Z");
  assert.equal(await service.publishCommittedNotification(seeded.eventId), true);
  releaseFirst();
  assert.equal(await first, false);
  const row = await outboxRow(seeded.eventId);
  assert.equal(row.status, "published");
  assert.equal(row.providerMessageId, "replacement-publication");
}

// Arbitrary provider failures are reduced to a bounded operational class.
{
  const seeded = await seedEvent({ status: "pending" });
  assert.equal(await core({
    publisher: {
      async publish() {
        throw new Error("payment reference partner-secret-123");
      },
    },
  }).publishCommittedNotification(seeded.eventId), false);
  const row = await outboxRow(seeded.eventId);
  assert.equal(row.status, "retry");
  assert.equal(row.lastErrorCode, "QUEUE_PUBLISH_FAILED");
}

// Publication never steals an expired processing lease directly.
{
  const seeded = await seedEvent();
  await db.update(notificationOutbox).set({
    status: "processing",
    leaseExpiresAt: new Date("2026-07-28T11:59:00.000Z"),
  }).where(eq(notificationOutbox.eventId, seeded.eventId));
  let calls = 0;
  assert.equal(await core({
    publisher: {
      async publish() {
        calls += 1;
        return { providerMessageId: "must-not-publish" };
      },
    },
  }).publishCommittedNotification(seeded.eventId), false);
  assert.equal(calls, 0);
  assert.equal((await outboxRow(seeded.eventId)).status, "processing");
  await db.update(notificationOutbox).set({
    status: "completed",
    leaseExpiresAt: null,
  }).where(eq(notificationOutbox.eventId, seeded.eventId));
}

// A sent event/device pair is a stable idempotency boundary.
{
  const seeded = await seedEvent();
  await db.insert(mobilePushDeliveries).values({
    deviceId: ownerDevice.id,
    notificationKey: `event:${seeded.eventId}`,
    status: "sent",
  });
  let calls = 0;
  const result = await core({
    sender: async () => {
      calls += 1;
      return { kind: "sent" };
    },
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  assert.deepEqual(result, { completed: true });
  assert.equal(calls, 1, "only the manager device still needs a send");
  assert.equal((await deliveryRow(ownerDevice.id, seeded.eventId)).attempts, 1);
}

// A fresh per-device sending claim fences a concurrent worker from FCM.
{
  const seeded = await seedEvent();
  await db.update(mobilePushDevices).set({ enabled: false })
    .where(eq(mobilePushDevices.id, managerDevice.id));
  await db.insert(mobilePushDeliveries).values({
    deviceId: ownerDevice.id,
    notificationKey: `event:${seeded.eventId}`,
    status: "sending",
    attemptedAt: new Date("2026-07-28T12:00:00.000Z"),
  });
  let calls = 0;
  const result = await core({
    sender: async () => {
      calls += 1;
      return { kind: "sent" };
    },
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  assert.equal(result.completed, false);
  assert.equal(calls, 0);
  assert.equal((await deliveryRow(ownerDevice.id, seeded.eventId)).status, "sending");
  await db.update(mobilePushDevices).set({ enabled: true })
    .where(eq(mobilePushDevices.id, managerDevice.id));
}

// A stale sender cannot overwrite a newer terminal sent result.
{
  const seeded = await seedEvent();
  await db.update(mobilePushDevices).set({ enabled: false })
    .where(eq(mobilePushDevices.id, managerDevice.id));
  await core({
    sender: async () => {
      await db.insert(mobilePushDeliveries).values({
        deviceId: ownerDevice.id,
        notificationKey: `event:${seeded.eventId}`,
        status: "sent",
        attemptedAt: new Date("2026-07-28T12:00:01.000Z"),
      }).onConflictDoUpdate({
        target: [
          mobilePushDeliveries.deviceId,
          mobilePushDeliveries.notificationKey,
        ],
        set: {
          status: "sent",
          errorCode: null,
          attemptedAt: new Date("2026-07-28T12:00:01.000Z"),
        },
      });
      return { kind: "retry", code: "FCM_UNAVAILABLE" };
    },
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  assert.equal((await deliveryRow(ownerDevice.id, seeded.eventId)).status, "sent");
  assert.equal((await outboxRow(seeded.eventId)).status, "completed");
  await db.update(mobilePushDevices).set({ enabled: true })
    .where(eq(mobilePushDevices.id, managerDevice.id));
}

// Losing the outbox ownership token before a device claim prevents FCM.
{
  const seeded = await seedEvent();
  let deviceClaimTransactionStarted = false;
  const raceDatabase = new Proxy(db, {
    get(target, property) {
      if (property === "transaction") {
        return async (callback) => {
          if (!deviceClaimTransactionStarted) {
            deviceClaimTransactionStarted = true;
            await db.update(notificationOutbox).set({
              status: "retry",
              leaseExpiresAt: null,
            }).where(eq(notificationOutbox.eventId, seeded.eventId));
          }
          return db.transaction(callback);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  let calls = 0;
  const service = createNotificationOutboxCore({
    database: raceDatabase,
    publisher: {
      async publish() {
        return { providerMessageId: "unused" };
      },
    },
    sender: async () => {
      calls += 1;
      return { kind: "sent" };
    },
    now: () => new Date("2026-07-28T12:00:00.000Z"),
    jitter: () => 0,
  });
  await service.processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  assert.equal(deviceClaimTransactionStarted, true);
  assert.equal(calls, 0);
  await db.update(notificationOutbox).set({
    status: "completed",
    leaseExpiresAt: null,
  }).where(eq(notificationOutbox.eventId, seeded.eventId));
}

// Routine events defer to the first minute outside quiet hours without consuming
// a delivery attempt.
{
  const now = new Date("2026-07-28T16:00:00.000Z"); // 23:00 ICT
  await db.update(storeSettings).set({
    prefs: {
      notifications: {
        quietHours: {
          enabled: true,
          start: "22:00",
          end: "07:00",
          timezone: "Asia/Ho_Chi_Minh",
        },
      },
    },
  }).where(eq(storeSettings.id, "default"));
  const seeded = await seedEvent();
  let calls = 0;
  const result = await core({
    now,
    sender: async () => {
      calls += 1;
      return { kind: "sent" };
    },
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: now.toISOString(),
  });
  const row = await outboxRow(seeded.eventId);
  assert.equal(result.completed, false);
  assert.equal(result.retryAt?.toISOString(), "2026-07-29T00:00:00.000Z");
  assert.equal(row.status, "retry");
  assert.equal(row.availableAt.toISOString(), "2026-07-29T00:00:00.000Z");
  assert.equal(row.attemptCount, 0);
  assert.equal(calls, 0);
}

// QR bypasses the same quiet-hours policy and reaches active direct devices.
{
  const now = new Date("2026-07-28T16:00:00.000Z");
  const seeded = await seedEvent({
    category: "qrPaymentConfirmed",
    priority: "high",
    quietHoursPolicy: "bypass",
    directUserIds: [userIds.cashier],
  });
  const tokens = [];
  const result = await core({
    now,
    sender: async (input) => {
      tokens.push(input.token);
      assert.equal((await outboxRow(seeded.eventId)).status, "processing");
      return { kind: "sent" };
    },
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: now.toISOString(),
  });
  assert.deepEqual(result, { completed: true });
  assert.deepEqual(tokens.sort(), ["cashier-token", "manager-token", "owner-token"]);
  assert.equal((await outboxRow(seeded.eventId)).status, "completed");
  assert.equal((await deliveryRow(cashierDevice.id, seeded.eventId)).status, "sent");
  assert.equal((await deliveryRow(managerDevice.id, seeded.eventId)).status, "sent");
}

await db.update(storeSettings).set({ prefs: {} }).where(eq(storeSettings.id, "default"));

// Retryable FCM results persist the device attempt and return a due time.
{
  const now = new Date("2026-07-28T12:00:00.000Z");
  const seeded = await seedEvent();
  const result = await core({
    now,
    sender: async () => ({ kind: "retry", code: "FCM_UNAVAILABLE", retryAfterMs: 60_000 }),
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: now.toISOString(),
  });
  const row = await outboxRow(seeded.eventId);
  assert.equal(result.completed, false);
  assert.equal(row.status, "retry");
  assert.equal(row.attemptCount, 1);
  assert.equal(row.availableAt.toISOString(), "2026-07-28T12:01:00.000Z");
  assert.equal((await deliveryRow(ownerDevice.id, seeded.eventId)).status, "failed");
}

// Permanent failures stop immediately.
{
  const seeded = await seedEvent();
  await core({
    sender: async () => ({ kind: "permanent", code: "FCM_UNAUTHENTICATED" }),
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  const row = await outboxRow(seeded.eventId);
  assert.equal(row.status, "dead");
  assert.equal(row.lastErrorCode, "FCM_UNAUTHENTICATED");
}

// A tenth failed attempt reaches dead.
{
  const seeded = await seedEvent();
  await db.update(notificationOutbox).set({
    attemptCount: 9,
    firstAttemptAt: new Date("2026-07-28T11:50:00.000Z"),
  }).where(eq(notificationOutbox.eventId, seeded.eventId));
  await core({
    sender: async () => ({ kind: "retry", code: "FCM_UNAVAILABLE" }),
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  const row = await outboxRow(seeded.eventId);
  assert.equal(row.attemptCount, 10);
  assert.equal(row.status, "dead");
}

// A row at the sixty-minute age bound dies before another device request.
{
  const seeded = await seedEvent();
  await db.update(notificationOutbox).set({
    attemptCount: 1,
    firstAttemptAt: new Date("2026-07-28T11:00:00.000Z"),
  }).where(eq(notificationOutbox.eventId, seeded.eventId));
  let calls = 0;
  await core({
    sender: async () => {
      calls += 1;
      return { kind: "sent" };
    },
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  assert.equal((await outboxRow(seeded.eventId)).status, "dead");
  assert.equal(calls, 0);
}

// A worker recovered after attempt ten dies before incrementing or sending.
{
  const seeded = await seedEvent();
  await db.update(notificationOutbox).set({
    status: "processing",
    attemptCount: 10,
    firstAttemptAt: new Date("2026-07-28T11:50:00.000Z"),
    leaseExpiresAt: new Date("2026-07-28T11:59:00.000Z"),
  }).where(eq(notificationOutbox.eventId, seeded.eventId));
  let calls = 0;
  const service = core({
    publisher: {
      async publish() {
        return { providerMessageId: "recovered-attempt-ten" };
      },
    },
    sender: async () => {
      calls += 1;
      return { kind: "sent" };
    },
  });
  assert.equal(await service.recoverDueNotifications(50), 1);
  assert.equal((await outboxRow(seeded.eventId)).status, "published");
  await service.processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  const row = await outboxRow(seeded.eventId);
  assert.equal(row.status, "dead");
  assert.equal(row.attemptCount, 10);
  assert.equal(calls, 0);
}

// Recovery publishes only due pending/retry rows.
{
  const duePending = await seedEvent({ status: "pending" });
  const futurePending = await seedEvent({ status: "pending" });
  const dueRetry = await seedEvent({ status: "retry" });
  const alreadyPublished = await seedEvent({ status: "published" });
  await db.update(notificationOutbox).set({
    availableAt: new Date("2026-07-28T12:05:00.000Z"),
  }).where(eq(notificationOutbox.eventId, futurePending.eventId));
  const published = [];
  const recovered = await core({
    publisher: {
      async publish(message) {
        published.push(message.eventId);
        return { providerMessageId: `recovery:${message.eventId}` };
      },
    },
  }).recoverDueNotifications(50);
  assert.equal(recovered, 2);
  assert.deepEqual(published.sort(), [duePending.eventId, dueRetry.eventId].sort());
  assert.equal((await outboxRow(futurePending.eventId)).status, "pending");
  assert.equal((await outboxRow(alreadyPublished.eventId)).status, "published");
}

// Disabling push after commit preserves the in-app recipient and completes work.
{
  const seeded = await seedEvent();
  const recipientsBefore = await db.select().from(notificationRecipients)
    .where(eq(notificationRecipients.eventId, seeded.eventId));
  await db.update(storeSettings).set({
    prefs: { notifications: { channels: { push: false } } },
  }).where(eq(storeSettings.id, "default"));
  let calls = 0;
  await core({
    sender: async () => {
      calls += 1;
      return { kind: "sent" };
    },
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  const recipientsAfter = await db.select().from(notificationRecipients)
    .where(eq(notificationRecipients.eventId, seeded.eventId));
  assert.equal(calls, 0);
  assert.equal((await outboxRow(seeded.eventId)).status, "completed");
  assert.deepEqual(recipientsAfter.map((row) => row.id), recipientsBefore.map((row) => row.id));
}

// Store-wide category disablement has the same in-app preservation rule.
{
  await db.update(storeSettings).set({ prefs: {} }).where(eq(storeSettings.id, "default"));
  const seeded = await seedEvent();
  await db.update(storeSettings).set({
    prefs: { notifications: { invoiceCreated: false } },
  }).where(eq(storeSettings.id, "default"));
  let calls = 0;
  await core({
    sender: async () => {
      calls += 1;
      return { kind: "sent" };
    },
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  assert.equal(calls, 0);
  assert.equal((await outboxRow(seeded.eventId)).status, "completed");
  assert.equal(
    (await db.select().from(notificationRecipients)
      .where(eq(notificationRecipients.eventId, seeded.eventId))).length,
    2,
  );
}

// A direct recipient loses delivery when its profile becomes inactive.
{
  await db.update(storeSettings).set({ prefs: {} }).where(eq(storeSettings.id, "default"));
  const seeded = await seedEvent({
    category: "qrPaymentConfirmed",
    priority: "high",
    quietHoursPolicy: "bypass",
    directUserIds: [userIds.cashier],
  });
  await db.update(profiles).set({ isActive: false }).where(eq(profiles.id, userIds.cashier));
  const tokens = [];
  await core({
    sender: async (input) => {
      tokens.push(input.token);
      return { kind: "sent" };
    },
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  assert.deepEqual(tokens.sort(), ["manager-token", "owner-token"]);
  assert.equal(await deliveryRow(cashierDevice.id, seeded.eventId), undefined);
  await db.update(profiles).set({ isActive: true }).where(eq(profiles.id, userIds.cashier));
}

// Token-local invalidation completes mixed delivery without disabling a token
// refreshed while the old send was in flight.
{
  const seeded = await seedEvent();
  await core({
    sender: async (input) => {
      if (input.token === "owner-token") {
        await db.update(mobilePushDevices).set({
          token: "owner-replacement-token",
          enabled: true,
        }).where(eq(mobilePushDevices.id, ownerDevice.id));
        return { kind: "disable-token", code: "FCM_INVALID_TOKEN" };
      }
      return { kind: "sent" };
    },
  }).processNotificationMessage({
    version: 1,
    eventId: seeded.eventId,
    deduplicationKey: `notification:${seeded.eventId}`,
    queuedAt: "2026-07-28T12:00:00.000Z",
  });
  const [refreshed] = await db.select({
    token: mobilePushDevices.token,
    enabled: mobilePushDevices.enabled,
  }).from(mobilePushDevices).where(eq(mobilePushDevices.id, ownerDevice.id));
  assert.deepEqual(refreshed, {
    token: "owner-replacement-token",
    enabled: true,
  });
  assert.equal((await deliveryRow(ownerDevice.id, seeded.eventId)).status, "failed");
  assert.equal((await deliveryRow(managerDevice.id, seeded.eventId)).status, "sent");
  assert.equal((await outboxRow(seeded.eventId)).status, "completed");
  await db.update(mobilePushDevices).set({ token: "owner-token", enabled: true })
    .where(eq(mobilePushDevices.id, ownerDevice.id));
}

// Dead-event republish is manager-only, commits the reset before publication,
// and preserves the immutable event and per-device dedupe row.
{
  const seeded = await seedEvent();
  await db.update(notificationOutbox).set({
    status: "dead",
    attemptCount: 10,
    firstAttemptAt: new Date("2026-07-28T11:00:00.000Z"),
    lastErrorCode: "FCM_UNAVAILABLE",
  }).where(eq(notificationOutbox.eventId, seeded.eventId));
  const [delivery] = await db.insert(mobilePushDeliveries).values({
    deviceId: ownerDevice.id,
    notificationKey: `event:${seeded.eventId}`,
    status: "sent",
  }).returning();
  const envelopes = [];
  const service = core({
    publisher: {
      async publish(message) {
        assert.equal((await outboxRow(seeded.eventId)).status, "publishing");
        envelopes.push(message);
        return { providerMessageId: "republished-message" };
      },
    },
  });
  assert.deepEqual(
    await service.republishDeadNotificationForUser(userIds.cashier, seeded.eventId),
    { ok: false, error: "errors.forbidden" },
  );
  assert.deepEqual(
    await service.republishDeadNotificationForUser(userIds.manager, seeded.eventId),
    { ok: true, data: undefined },
  );
  assert.equal(envelopes[0].eventId, seeded.eventId);
  assert.equal((await db.select().from(notificationEvents)
    .where(eq(notificationEvents.id, seeded.eventId))).length, 1);
  const preserved = await deliveryRow(ownerDevice.id, seeded.eventId);
  assert.equal(preserved.id, delivery.id);
  assert.equal(preserved.notificationKey, `event:${seeded.eventId}`);
  assert.deepEqual(
    await service.republishDeadNotificationForUser(userIds.owner, seeded.eventId),
    { ok: false, error: "errors.conflict" },
  );
}

// Authorization is revalidated inside the reset transaction.
{
  const seeded = await seedEvent();
  await db.update(notificationOutbox).set({
    status: "dead",
    attemptCount: 10,
    lastErrorCode: "FCM_UNAVAILABLE",
  }).where(eq(notificationOutbox.eventId, seeded.eventId));
  let transactionStarted = false;
  const raceDatabase = new Proxy(db, {
    get(target, property) {
      if (property === "transaction") {
        return async (callback) => {
          transactionStarted = true;
          await db.update(profiles).set({ role: "cashier" })
            .where(eq(profiles.id, userIds.manager));
          return db.transaction(callback);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const service = createNotificationOutboxCore({
    database: raceDatabase,
    publisher: {
      async publish() {
        return { providerMessageId: "must-not-publish" };
      },
    },
    sender: async () => ({ kind: "sent" }),
    now: () => new Date("2026-07-28T12:00:00.000Z"),
    jitter: () => 0,
  });
  assert.deepEqual(
    await service.republishDeadNotificationForUser(userIds.manager, seeded.eventId),
    { ok: false, error: "errors.forbidden" },
  );
  assert.equal(transactionStarted, true);
  assert.equal((await outboxRow(seeded.eventId)).status, "dead");
  await db.update(profiles).set({ role: "manager" })
    .where(eq(profiles.id, userIds.manager));
}

await client.close();
console.log("✅ notification outbox publication, worker delivery, recovery, and republish are durable");
