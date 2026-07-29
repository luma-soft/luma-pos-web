import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const events = await import(`${projectRoot}/src/lib/notifications/events-core.ts`);
const {
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

const [owner, manager, cashier, warehouse] = await db.insert(profiles).values([
  { id: "10000000-0000-4000-8000-000000000001", fullName: "Owner", role: "owner" },
  { id: "10000000-0000-4000-8000-000000000002", fullName: "Manager", role: "manager" },
  { id: "10000000-0000-4000-8000-000000000003", fullName: "Cashier", role: "cashier" },
  { id: "10000000-0000-4000-8000-000000000004", fullName: "Warehouse", role: "warehouse" },
  { id: "10000000-0000-4000-8000-000000000005", fullName: "Inactive", role: "manager", isActive: false },
]).returning();
async function rowsFor(eventId) {
  const [recipients, outbox] = await Promise.all([
    db.select().from(notificationRecipients).where(eq(notificationRecipients.eventId, eventId)),
    db.select().from(notificationOutbox).where(eq(notificationOutbox.eventId, eventId)),
  ]);
  return { recipients, outbox };
}

async function notificationRowCounts() {
  const [events, recipients, outbox] = await Promise.all([
    db.select().from(notificationEvents),
    db.select().from(notificationRecipients),
    db.select().from(notificationOutbox),
  ]);
  return { events: events.length, recipients: recipients.length, outbox: outbox.length };
}

const purchaseInput = {
  eventKey: "purchase-received:10000000-0000-0000-0000-000000000001",
  category: "purchaseReceived",
  entityType: "purchase",
  entityId: "10000000-0000-0000-0000-000000000001",
  actorId: warehouse.id,
  target: "purchases",
  priority: "normal",
  quietHoursPolicy: "defer",
  excludeActor: true,
};

const createdPurchase = await db.transaction((tx) => events.createNotificationEventInTx(tx, purchaseInput));
assert.equal(createdPurchase?.created, true, "creates a new event");
const purchaseRows = await rowsFor(createdPurchase.eventId);
assert.deepEqual(
  purchaseRows.recipients.map((recipient) => recipient.userId).sort(),
  [owner.id, manager.id].sort(),
  "routes active owner and manager while excluding the actor and inactive manager",
);
assert.equal(purchaseRows.outbox.length, 1, "creates exactly one provider-neutral outbox row");

const createdQr = await db.transaction((tx) => events.createNotificationEventInTx(tx, {
  eventKey: "qr-confirmed:10000000-0000-0000-0000-000000000002",
  category: "qrPaymentConfirmed",
  entityType: "order",
  entityId: "10000000-0000-0000-0000-000000000002",
  actorId: cashier.id,
  target: "invoices",
  priority: "high",
  quietHoursPolicy: "bypass",
  directUserIds: [cashier.id],
  excludeActor: true,
}));
assert.equal(createdQr?.created, true, "creates QR confirmation event");
const qrRows = await rowsFor(createdQr.eventId);
assert.deepEqual(
  qrRows.recipients.map((recipient) => recipient.userId).sort(),
  [owner.id, manager.id, cashier.id].sort(),
  "keeps the direct cashier actor alongside active role recipients",
);
assert.equal(qrRows.recipients.find((recipient) => recipient.userId === cashier.id)?.reason, "direct");

const replayedPurchase = await db.transaction((tx) => events.createNotificationEventInTx(tx, purchaseInput));
assert.deepEqual(replayedPurchase, { eventId: createdPurchase.eventId, created: false }, "replays the durable event key");
assert.equal((await rowsFor(createdPurchase.eventId)).recipients.length, 2, "does not duplicate recipients on replay");

await db.update(storeSettings).set({
  prefs: { notifications: { purchaseReceived: false } },
}).where(eq(storeSettings.id, "default"));
const disabled = await db.transaction((tx) => events.createNotificationEventInTx(tx, {
  ...purchaseInput,
  eventKey: "purchase-received:10000000-0000-0000-0000-000000000003",
  entityId: "10000000-0000-0000-0000-000000000003",
}));
assert.equal(disabled, null, "does not persist disabled categories");
await db.update(storeSettings).set({ prefs: {} }).where(eq(storeSettings.id, "default"));

const beforeRollback = await notificationRowCounts();
try {
  await db.transaction(async (tx) => {
    await events.createNotificationEventInTx(tx, {
      ...purchaseInput,
      eventKey: "purchase-received:10000000-0000-0000-0000-000000000004",
      entityId: "10000000-0000-0000-0000-000000000004",
    });
    throw new Error("force rollback");
  });
} catch (error) {
  assert.equal(error instanceof Error ? error.message : "", "force rollback");
}
const rolledBack = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.eventKey, "purchase-received:10000000-0000-0000-0000-000000000004"));
assert.equal(rolledBack.length, 0, "rolls event, recipients, and outbox back together");
assert.deepEqual(await notificationRowCounts(), beforeRollback, "does not leave recipients or outbox rows after rollback");

assert.equal(events.debtEventKey({
  entityType: "customer",
  entityId: "10000000-0000-0000-0000-000000000005",
  operationType: "payment",
  operationId: "10000000-0000-0000-0000-000000000006",
}), "debt-changed:customer:10000000-0000-0000-0000-000000000005:payment:10000000-0000-0000-0000-000000000006");

const zeroDebt = await db.transaction((tx) => events.createDebtChangedEventInTx(tx, {
  entityType: "customer",
  entityId: "10000000-0000-0000-0000-000000000005",
  operationType: "settlement",
  operationId: "10000000-0000-0000-0000-000000000007",
  delta: 10,
  relatedAdjustments: [{ entityType: "supplier", entityId: "10000000-0000-0000-0000-000000000006", delta: -10 }],
}));
assert.equal(zeroDebt, null, "does not create a debt event for a zero net change");

const debt = await db.transaction((tx) => events.createDebtChangedEventInTx(tx, {
  entityType: "customer",
  entityId: "10000000-0000-0000-0000-000000000005",
  operationType: "payment",
  operationId: "10000000-0000-0000-0000-000000000008",
  delta: 1.005,
  actorId: owner.id,
}));
assert.equal(debt?.created, true, "creates non-zero debt events");
const [debtEvent] = await db.select().from(notificationEvents).where(eq(notificationEvents.id, debt.eventId));
assert.deepEqual(debtEvent.metadata, { delta: 1.01, operationType: "payment" }, "keeps rounded protected debt metadata minimal");

await db.update(storeSettings).set({
  prefs: {
    notifications: {
      roleRouting: {
        invoiceCreated: ["owner", "manager", "cashier", "warehouse"],
        purchaseReceived: ["owner", "manager", "cashier", "warehouse"],
        debtChanged: ["owner", "manager", "cashier", "warehouse"],
        qrPaymentConfirmed: ["owner", "manager", "cashier", "warehouse"],
        qrPaymentException: ["owner", "manager", "cashier", "warehouse"],
      },
    },
  },
}).where(eq(storeSettings.id, "default"));

const roleTargetMatrix = [
  {
    category: "invoiceCreated",
    entityType: "order",
    target: "invoices",
    expected: [owner.id, manager.id, cashier.id],
  },
  {
    category: "purchaseReceived",
    entityType: "purchase",
    target: "purchases",
    expected: [owner.id, manager.id, warehouse.id],
  },
  {
    category: "debtChanged",
    entityType: "customer",
    target: "debt",
    expected: [owner.id, manager.id, cashier.id],
  },
  {
    category: "debtChanged",
    entityType: "supplier",
    target: "debt",
    expected: [owner.id, manager.id, warehouse.id],
  },
  {
    category: "qrPaymentConfirmed",
    entityType: "order",
    target: "invoices",
    expected: [owner.id, manager.id, cashier.id],
  },
  {
    category: "qrPaymentException",
    entityType: "payment",
    target: "paymentReconciliation",
    expected: [owner.id, manager.id],
  },
];
for (const [index, route] of roleTargetMatrix.entries()) {
  const created = await db.transaction((tx) =>
    events.createNotificationEventInTx(tx, {
      eventKey: `role-target-matrix:${index}`,
      category: route.category,
      entityType: route.entityType,
      entityId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      target: route.target,
      priority: "normal",
      quietHoursPolicy: "defer",
    })
  );
  assert.ok(created?.created);
  assert.deepEqual(
    (await rowsFor(created.eventId)).recipients
      .map((recipient) => recipient.userId)
      .sort(),
    [...route.expected].sort(),
    `${route.category}/${route.target}/${route.entityType} materializes only roles that can open the entity`,
  );
}

await db.update(storeSettings).set({
  prefs: {
    notifications: {
      roleRouting: { qrPaymentConfirmed: ["owner"] },
    },
  },
}).where(eq(storeSettings.id, "default"));
const directQr = await db.transaction((tx) =>
  events.createNotificationEventInTx(tx, {
    eventKey: "qr-direct-independent-of-role-route",
    category: "qrPaymentConfirmed",
    entityType: "order",
    entityId: "20000000-0000-4000-8000-000000000099",
    actorId: cashier.id,
    directUserIds: [cashier.id],
    excludeActor: true,
    target: "invoices",
    priority: "high",
    quietHoursPolicy: "bypass",
  })
);
assert.ok(directQr?.created);
const directQrRows = await rowsFor(directQr.eventId);
assert.deepEqual(
  directQrRows.recipients.map((recipient) => recipient.userId).sort(),
  [owner.id, cashier.id].sort(),
  "direct QR creator delivery remains independent of the configured role route",
);
assert.equal(
  directQrRows.recipients.find((recipient) => recipient.userId === cashier.id)?.reason,
  "direct",
);

await client.close();
console.log("✅ notification event service records events, recipients, and outbox atomically");
