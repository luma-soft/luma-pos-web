import { strict as assert } from "node:assert";
import { mock } from "bun:test";

const { parseStorePrefs } = await import("../src/lib/schemas/settings.ts");

let role = "manager";
let authorization = { ok: true };
let approvalCalls = 0;
let updateCalls = [];
let currentNotifications = parseStorePrefs({
  notifications: {
    invoiceCreated: false,
    purchaseReceived: false,
    debtChanged: false,
    qrPaymentConfirmed: false,
    qrPaymentException: false,
    channels: { inApp: true, push: false },
    roleRouting: {
      invoiceCreated: ["owner"],
      purchaseReceived: ["warehouse"],
      debtChanged: ["manager"],
      qrPaymentConfirmed: ["cashier"],
      qrPaymentException: ["owner", "manager"],
    },
  },
}).notifications;

function gateFor(roles) {
  return roles.includes(role)
    ? {
        ok: true,
        userId: `settings-${role}`,
        role,
        principalId: `settings-${role}`,
      }
    : { ok: false, error: "errors.forbidden" };
}

mock.module("@/lib/mobile/auth", () => ({
  async requireMobileRole(roles) {
    return gateFor(roles);
  },
  async requireMobileManager() {
    return gateFor(["owner", "manager"]);
  },
}));
mock.module("@/lib/auth/mobile-approval", () => ({
  async authorizeMobileSensitiveAction() {
    approvalCalls += 1;
    return authorization;
  },
}));
mock.module("@/lib/actions/settings", () => ({
  async updateStorePrefsForUser(userId, patch) {
    updateCalls.push({ userId, patch });
    return { ok: true, data: undefined };
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
      locale: "vi-VN",
      onboarded: true,
      prefs: parseStorePrefs({ notifications: currentNotifications }),
    };
  },
}));
mock.module("@/lib/notifications/channels", () => ({
  resolveNotificationChannels() {
    return [
      { id: "inApp", configured: true },
      { id: "push", configured: true },
    ];
  },
}));

const settingsRoute = await import(
  "../src/app/api/mobile/notifications/settings/route.ts"
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

function patchRequest(payload) {
  return new Request("https://luma.test/api/mobile/notifications/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function json(response) {
  return response.json();
}

await check("cashier and warehouse cannot read or mutate notification administration", async () => {
  for (const blockedRole of ["cashier", "warehouse"]) {
    role = blockedRole;
    approvalCalls = 0;
    updateCalls = [];

    const getResponse = await settingsRoute.GET();
    assert.equal(getResponse.status, 403);
    assert.deepEqual(await json(getResponse), {
      ok: false,
      error: "errors.forbidden",
    });

    const patchResponse = await settingsRoute.PATCH(
      patchRequest({ lowStock: false }),
    );
    assert.equal(patchResponse.status, 403);
    assert.equal(approvalCalls, 0);
    assert.equal(updateCalls.length, 0);
  }
});

await check("truthy primitives, arrays, unknown keys, and malformed nested values fail before approval", async () => {
  role = "manager";
  const malformedPayloads = [
    true,
    "notifications",
    [],
    [{ lowStock: false }],
    { unknown: true },
    { invoiceCreated: "yes" },
    { channels: { push: "yes" } },
    { quietHours: { start: "25:00" } },
    { quietHours: { unknown: true } },
    { thresholds: { lowStockDays: 0 } },
    { thresholds: { unknown: 1 } },
    { roleRouting: { invoiceCreated: [] } },
    { roleRouting: { invoiceCreated: ["accountant"] } },
    { roleRouting: { unknown: ["owner"] } },
  ];

  for (const payload of malformedPayloads) {
    approvalCalls = 0;
    updateCalls = [];
    const response = await settingsRoute.PATCH(patchRequest(payload));
    assert.equal(response.status, 400, `payload ${JSON.stringify(payload)}`);
    assert.deepEqual(await json(response), {
      ok: false,
      error: "errors.invalidData",
    });
    assert.equal(approvalCalls, 0, "approval must not be consumed");
    assert.equal(updateCalls.length, 0);
  }
});

await check("valid manager patch still requires sensitive approval", async () => {
  role = "manager";
  authorization = { ok: false, error: "errors.approvalRequired" };
  approvalCalls = 0;
  updateCalls = [];

  const response = await settingsRoute.PATCH(
    patchRequest({ lowStock: false }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await json(response), {
    ok: false,
    error: "errors.approvalRequired",
  });
  assert.equal(approvalCalls, 1);
  assert.equal(updateCalls.length, 0);
});

await check("manager GET and approved legacy partial PATCH preserve complete settings", async () => {
  role = "manager";
  authorization = { ok: true };
  approvalCalls = 0;
  updateCalls = [];

  const getResponse = await settingsRoute.GET();
  assert.equal(getResponse.status, 200);
  const getData = (await json(getResponse)).data;
  assert.equal(getData.invoiceCreated, false);
  assert.deepEqual(getData.roleRouting.purchaseReceived, ["warehouse"]);
  assert.deepEqual(getData.availableChannels, [
    { id: "inApp", configured: true },
    { id: "push", configured: true },
  ]);

  const patchResponse = await settingsRoute.PATCH(patchRequest({
    lowStock: false,
    channels: { inApp: false },
    roleRouting: { lowStock: ["owner"] },
  }));
  assert.equal(patchResponse.status, 200);
  assert.equal(approvalCalls, 1);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].userId, "settings-manager");

  const saved = updateCalls[0].patch.notifications;
  assert.equal(saved.lowStock, false);
  assert.equal(saved.invoiceCreated, false);
  assert.equal(saved.purchaseReceived, false);
  assert.equal(saved.debtChanged, false);
  assert.equal(saved.qrPaymentConfirmed, false);
  assert.equal(saved.qrPaymentException, false);
  assert.deepEqual(saved.channels, { inApp: false, push: false });
  assert.deepEqual(saved.roleRouting.lowStock, ["owner"]);
  assert.deepEqual(saved.roleRouting.invoiceCreated, ["owner"]);
  assert.deepEqual(saved.roleRouting.purchaseReceived, ["warehouse"]);
  assert.deepEqual(saved.roleRouting.qrPaymentConfirmed, ["cashier"]);
});

console.log(`\n${failed === 0 ? "🎉" : "⚠️"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
