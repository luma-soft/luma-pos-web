import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { mock } from "bun:test";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const { parseStorePrefs } = await import(`${projectRoot}/src/lib/schemas/settings.ts`);
const {
  mobileNotificationStates,
  notificationEvents,
  notificationRecipients,
  profiles,
} = schema;

const client = new PGlite();
const db = drizzle(client, { schema });

for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const ids = {
  owner: "71000000-0000-4000-8000-000000000001",
  manager: "71000000-0000-4000-8000-000000000002",
  cashier: "71000000-0000-4000-8000-000000000003",
  warehouse: "71000000-0000-4000-8000-000000000004",
  visibleEvent: "72000000-0000-4000-8000-000000000001",
  dismissedEvent: "72000000-0000-4000-8000-000000000002",
  ownerOnlyEvent: "72000000-0000-4000-8000-000000000003",
  invoice: "73000000-0000-4000-8000-000000000001",
  purchase: "73000000-0000-4000-8000-000000000002",
  payment: "73000000-0000-4000-8000-000000000003",
};

await db.insert(profiles).values([
  { id: ids.owner, fullName: "Owner", role: "owner" },
  { id: ids.manager, fullName: "Manager", role: "manager" },
  { id: ids.cashier, fullName: "Cashier", role: "cashier" },
  { id: ids.warehouse, fullName: "Warehouse", role: "warehouse" },
]);

await db.insert(notificationEvents).values([
  {
    id: ids.visibleEvent,
    eventKey: "task-7-visible",
    category: "invoiceCreated",
    entityType: "order",
    entityId: ids.invoice,
    actorId: ids.owner,
    target: "invoices",
    priority: "normal",
    quietHoursPolicy: "defer",
    metadata: {
      amount: 1_250_000,
      partner: "Private Customer",
      bankReference: "BANK-SECRET-001",
      note: "Do not expose",
    },
    occurredAt: new Date("2026-07-28T10:30:00.000Z"),
    createdAt: new Date("2026-07-28T10:30:01.000Z"),
  },
  {
    id: ids.dismissedEvent,
    eventKey: "task-7-dismissed",
    category: "purchaseReceived",
    entityType: "purchase",
    entityId: ids.purchase,
    actorId: ids.manager,
    target: "purchases",
    priority: "normal",
    quietHoursPolicy: "defer",
    metadata: { supplier: "Private Supplier" },
    occurredAt: new Date("2026-07-28T11:30:00.000Z"),
    createdAt: new Date("2026-07-28T11:30:01.000Z"),
  },
  {
    id: ids.ownerOnlyEvent,
    eventKey: "task-7-owner-only",
    category: "qrPaymentConfirmed",
    entityType: "order",
    entityId: ids.payment,
    actorId: ids.cashier,
    target: "paymentReconciliation",
    priority: "high",
    quietHoursPolicy: "bypass",
    metadata: { amount: 999_999, reference: "OWNER-ONLY-SECRET" },
    occurredAt: new Date("2026-07-28T12:30:00.000Z"),
    createdAt: new Date("2026-07-28T12:30:01.000Z"),
  },
]);

await db.insert(notificationRecipients).values([
  { eventId: ids.visibleEvent, userId: ids.cashier, reason: "direct" },
  {
    eventId: ids.dismissedEvent,
    userId: ids.cashier,
    reason: "role",
    dismissedAt: new Date("2026-07-28T11:31:00.000Z"),
  },
  { eventId: ids.dismissedEvent, userId: ids.warehouse, reason: "role" },
  { eventId: ids.ownerOnlyEvent, userId: ids.owner, reason: "role" },
]);

let gate = {
  ok: true,
  userId: ids.cashier,
  role: "cashier",
  principalId: ids.owner,
};
let locale = "vi-VN";
let restockSuggestions = [];
let currentShift = null;
const notificationPrefs = parseStorePrefs({
  notifications: {
    lowStock: false,
    shiftClose: false,
    einvoiceError: false,
  },
}).notifications;
let currentNotificationPrefs = notificationPrefs;

mock.module("@/db", () => ({ db }));
mock.module("@/lib/actions/common", () => ({
  async getProfileId(userId) {
    return userId;
  },
}));
mock.module("@/lib/mobile/auth", () => ({
  async requireMobileUser() {
    return gate;
  },
}));
mock.module("@/lib/data/ai-restock", () => ({
  async getRestockSuggestions() {
    return restockSuggestions;
  },
}));
mock.module("@/lib/data/shifts", () => ({
  async getCurrentShift() {
    return currentShift;
  },
}));
mock.module("@/lib/data/settings", () => ({
  async getStoreSettings() {
    return {
      name: "Luma",
      address: "",
      phone: "",
      taxCode: "",
      industry: "grocery",
      currency: "VND",
      locale,
      onboarded: true,
      prefs: parseStorePrefs({ notifications: currentNotificationPrefs }),
    };
  },
}));

const listRoute = await import("../src/app/api/mobile/notifications/route.ts");
const eventRoute = await import("../src/app/api/mobile/notifications/[id]/route.ts");
const { localizedMobileEventCopy } = await import(
  "../src/lib/notifications/mobile-events.ts"
);

let passed = 0;
let failed = 0;
async function check(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ❌ ${name}`);
    console.error(error);
  }
}

async function body(response) {
  return response.json();
}

async function list(requestLocale = "vi") {
  const response = await listRoute.GET(
    new Request(
      `https://luma.test/api/mobile/notifications?locale=${requestLocale}`,
    ),
  );
  assert.equal(response.status, 200);
  return (await body(response)).data;
}

async function resolve(eventId) {
  return eventRoute.GET(
    new Request(`https://luma.test/api/mobile/notifications/${eventId}`),
    { params: Promise.resolve({ id: eventId }) },
  );
}

async function patch(eventId, payload) {
  return eventRoute.PATCH(
    new Request(`https://luma.test/api/mobile/notifications/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id: eventId }) },
  );
}

await check("effective recipient sees a privacy-reduced Vietnamese event row", async () => {
  gate = {
    ok: true,
    userId: ids.cashier,
    role: "cashier",
    principalId: ids.owner,
  };
  locale = "vi-VN";

  const data = await list();
  assert.equal(data.rows.length, 1);
  assert.deepEqual(data.rows[0], {
    id: ids.visibleEvent,
    category: "invoiceCreated",
    title: "Hóa đơn mới đã được tạo",
    body: "Mở LumaPOS để xem chi tiết.",
    unread: true,
    priority: "normal",
    createdAt: "2026-07-28T10:30:01.000Z",
    action: { type: "open", target: "invoices", id: ids.invoice },
  });
  assert.equal(data.counts.all, 1);
  assert.equal(data.counts.unread, 1);
  assert.equal(data.counts.invoiceCreated, 1);
  assert.equal(data.counts.purchaseReceived, 0);
  assert.equal(data.settings, undefined);

  const serialized = JSON.stringify(data);
  for (const protectedValue of [
    ids.owner,
    "Private Customer",
    "BANK-SECRET-001",
    "Do not expose",
    "1250000",
    "metadata",
    "actorId",
  ]) {
    assert.equal(serialized.includes(protectedValue), false, `must omit ${protectedValue}`);
  }
});

await check("English locale uses the category-safe English title and body", async () => {
  locale = "vi-VN";
  const data = await list("en");
  assert.equal(data.rows[0].title, "A new invoice was created");
  assert.equal(data.rows[0].body, "Open LumaPOS to view details.");
});

await check("all persisted categories use fixed Vietnamese and English safe copy", () => {
  const cases = [
    ["invoiceCreated", "Hóa đơn mới đã được tạo", "A new invoice was created"],
    ["purchaseReceived", "Đã ghi nhận phiếu nhập hàng", "A purchase receipt was recorded"],
    ["debtChanged", "Công nợ vừa được cập nhật", "A debt balance was updated"],
    ["qrPaymentConfirmed", "Đã xác nhận thanh toán QR", "QR payment confirmed"],
    ["qrPaymentException", "Cần kiểm tra giao dịch QR", "QR payment needs review"],
  ];
  for (const [category, vi, en] of cases) {
    assert.deepEqual(localizedMobileEventCopy(category, "vi-VN"), {
      title: vi,
      body: "Mở LumaPOS để xem chi tiết.",
    });
    assert.deepEqual(localizedMobileEventCopy(category, "en-US"), {
      title: en,
      body: "Open LumaPOS to view details.",
    });
  }
});

await check("dismissed recipient rows stay hidden and do not inflate category counts", async () => {
  const data = await list();
  assert.equal(data.rows.some((row) => row.id === ids.dismissedEvent), false);
  assert.equal(data.counts.purchaseReceived, 0);
});

await check("mixed persisted and synthetic rows keep stable IDs, ordering, and visible counts", async () => {
  gate = {
    ok: true,
    userId: ids.cashier,
    role: "cashier",
    principalId: ids.owner,
  };
  const productId = "74000000-0000-4000-8000-000000000001";
  const shiftId = "75000000-0000-4000-8000-000000000001";
  restockSuggestions = [{
    id: productId,
    name: "Mixed low stock",
    sku: "MIXED-LOW",
    baseUnit: "cái",
    stock: 1,
    velocity: 2,
    daysOfStock: 0.5,
    suggestedQty: 27,
    priority: "high",
    unitCost: 1000,
  }];
  currentShift = {
    id: shiftId,
    code: "CA-MIXED",
    openedAt: new Date("2026-07-28T12:00:00.000Z"),
  };
  currentNotificationPrefs = {
    ...notificationPrefs,
    lowStock: true,
    shiftClose: true,
    roleRouting: {
      ...notificationPrefs.roleRouting,
      lowStock: ["cashier"],
      shiftClose: ["cashier"],
    },
  };

  try {
    const data = await list();
    assert.deepEqual(data.rows.map((row) => row.id), [
      `shift-${shiftId}`,
      ids.visibleEvent,
      `restock-${productId}`,
    ]);
    assert.deepEqual(data.rows.map((row) => row.createdAt), [
      "2026-07-28T12:00:00.000Z",
      "2026-07-28T10:30:01.000Z",
      "1970-01-01T00:00:00.000Z",
    ]);
    assert.deepEqual(data.counts, {
      all: 3,
      unread: 2,
      lowStock: 1,
      einvoiceError: 0,
      shiftClose: 1,
      invoiceCreated: 1,
      purchaseReceived: 0,
      debtChanged: 0,
      qrPaymentConfirmed: 0,
      qrPaymentException: 0,
    });
    assert.equal(data.rows.some((row) => row.id === ids.dismissedEvent), false);
  } finally {
    restockSuggestions = [];
    currentShift = null;
    currentNotificationPrefs = notificationPrefs;
  }
});

await check("warehouse can read its routed event without inheriting cashier dismissal", async () => {
  gate = {
    ok: true,
    userId: ids.warehouse,
    role: "warehouse",
    principalId: ids.warehouse,
  };
  const data = await list();
  assert.equal(data.rows.some((row) => row.id === ids.dismissedEvent), true);
  assert.equal(data.counts.purchaseReceived, 1);
});

await check("shared-terminal principal does not receive principal-only events", async () => {
  gate = {
    ok: true,
    userId: ids.cashier,
    role: "cashier",
    principalId: ids.owner,
  };
  const data = await list();
  assert.equal(data.rows.some((row) => row.id === ids.ownerOnlyEvent), false);
  const response = await resolve(ids.ownerOnlyEvent);
  assert.equal(response.status, 404);
  assert.deepEqual(await body(response), { ok: false, error: "errors.notFound" });
});

await check("unrelated active user cannot list or resolve another recipient event", async () => {
  gate = {
    ok: true,
    userId: ids.manager,
    role: "manager",
    principalId: ids.manager,
  };
  const data = await list();
  assert.equal(data.rows.some((row) => row.id === ids.visibleEvent), false);
  const response = await resolve(ids.visibleEvent);
  assert.equal(response.status, 404);
});

await check("authorized resolver returns only safe navigation identity", async () => {
  gate = {
    ok: true,
    userId: ids.cashier,
    role: "cashier",
    principalId: ids.owner,
  };
  const response = await resolve(ids.visibleEvent);
  assert.equal(response.status, 200);
  assert.deepEqual((await body(response)).data, {
    eventId: ids.visibleEvent,
    category: "invoiceCreated",
    target: "invoices",
    entityType: "order",
    entityId: ids.invoice,
  });
});

await check("PATCH updates persisted recipient timestamps before legacy state", async () => {
  gate = {
    ok: true,
    userId: ids.cashier,
    role: "cashier",
    principalId: ids.owner,
  };
  const response = await patch(ids.visibleEvent, { read: true, dismissed: true });
  assert.equal(response.status, 200);

  const [recipient] = await db.select().from(notificationRecipients).where(and(
    eq(notificationRecipients.eventId, ids.visibleEvent),
    eq(notificationRecipients.userId, ids.cashier),
  ));
  assert.ok(recipient.readAt instanceof Date);
  assert.ok(recipient.dismissedAt instanceof Date);
  const legacyRows = await db.select().from(mobileNotificationStates).where(and(
    eq(mobileNotificationStates.notificationId, ids.visibleEvent),
    eq(mobileNotificationStates.userId, ids.cashier),
  ));
  assert.equal(legacyRows.length, 0);

  const reopened = await patch(ids.visibleEvent, { read: false, dismissed: false });
  assert.equal(reopened.status, 200);
  const [cleared] = await db.select().from(notificationRecipients).where(and(
    eq(notificationRecipients.eventId, ids.visibleEvent),
    eq(notificationRecipients.userId, ids.cashier),
  ));
  assert.equal(cleared.readAt, null);
  assert.equal(cleared.dismissedAt, null);
});

await check("legacy synthetic IDs still use mobile notification state fallback", async () => {
  const legacyId = "restock-legacy-product";
  const response = await patch(legacyId, { read: true, dismissed: true });
  assert.equal(response.status, 200);

  const [state] = await db.select().from(mobileNotificationStates).where(and(
    eq(mobileNotificationStates.notificationId, legacyId),
    eq(mobileNotificationStates.userId, ids.cashier),
  ));
  assert.equal(state.read, true);
  assert.equal(state.dismissed, true);
});

await check("manager receives complete internal category settings while cashier does not", async () => {
  gate = {
    ok: true,
    userId: ids.manager,
    role: "manager",
    principalId: ids.manager,
  };
  const managerData = await list();
  assert.deepEqual({
    invoiceCreated: managerData.settings.invoiceCreated,
    purchaseReceived: managerData.settings.purchaseReceived,
    debtChanged: managerData.settings.debtChanged,
    qrPaymentConfirmed: managerData.settings.qrPaymentConfirmed,
    qrPaymentException: managerData.settings.qrPaymentException,
  }, {
    invoiceCreated: true,
    purchaseReceived: true,
    debtChanged: true,
    qrPaymentConfirmed: true,
    qrPaymentException: true,
  });
  assert.deepEqual(managerData.settings.roleRouting.purchaseReceived, [
    "owner",
    "manager",
    "warehouse",
  ]);

  gate = {
    ok: true,
    userId: ids.cashier,
    role: "cashier",
    principalId: ids.owner,
  };
  const cashierData = await list();
  assert.equal(cashierData.settings, undefined);
});

await check("persisted rows are capped while aggregate counts remain authoritative", async () => {
  gate = {
    ok: true,
    userId: ids.cashier,
    role: "cashier",
    principalId: ids.owner,
  };
  const extraEvents = Array.from({ length: 55 }, (_, index) => ({
    id: crypto.randomUUID(),
    eventKey: `bounded-list-${index}`,
    category: "invoiceCreated",
    entityType: "order",
    entityId: ids.invoice,
    actorId: ids.owner,
    target: "invoices",
    priority: "normal",
    quietHoursPolicy: "defer",
    metadata: {},
    occurredAt: new Date(`2026-07-29T00:${String(index).padStart(2, "0")}:00.000Z`),
    createdAt: new Date(`2026-07-29T00:${String(index).padStart(2, "0")}:01.000Z`),
  }));
  await db.insert(notificationEvents).values(extraEvents);
  await db.insert(notificationRecipients).values(extraEvents.map((event) => ({
    eventId: event.id,
    userId: ids.cashier,
    reason: "direct",
  })));

  const data = await list("en");
  assert.equal(data.rows.length, 50);
  assert.equal(data.counts.all, 56);
  assert.equal(data.counts.unread, 56);
  assert.equal(data.counts.invoiceCreated, 56);
  assert.equal(data.rows.every((row) => row.title === "A new invoice was created"), true);
});

await client.close();
console.log(`\n${failed === 0 ? "🎉" : "⚠️"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
