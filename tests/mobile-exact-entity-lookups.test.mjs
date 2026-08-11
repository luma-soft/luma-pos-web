import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, mock } from "bun:test";
import { createMobileAuthMock } from "./helpers/mobile-auth-mock.ts";
import { drizzle } from "drizzle-orm/pglite";

afterAll(() => mock.restore());

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  paymentWebhookEvents,
  products,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
  warehouses,
} = schema;

const client = new PGlite();
const db = drizzle(client, { schema });
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
  supplier: "81000000-0000-4000-8000-000000000001",
  warehouse: "81000000-0000-4000-8000-000000000002",
  product: "81000000-0000-4000-8000-000000000003",
  purchase: "81000000-0000-4000-8000-000000000004",
  purchaseItem: "81000000-0000-4000-8000-000000000005",
  event: "81000000-0000-4000-8000-000000000006",
  newerEvent: "81000000-0000-4000-8000-000000000007",
  missing: "81000000-0000-4000-8000-000000000099",
};

await db.insert(suppliers).values({
  id: ids.supplier,
  code: "NCC-EXACT",
  name: "Exact Supplier",
  phone: "0900000001",
  email: "private@supplier.test",
  address: "Private supplier address",
  taxCode: "0312345678",
  currentDebt: "125000.00",
  note: "Private supplier note",
});
await db.insert(warehouses).values({
  id: ids.warehouse,
  name: "Exact Warehouse",
});
await db.insert(products).values({
  id: ids.product,
  sku: "EXACT-001",
  name: "Exact Product",
  retailPrice: "100000.00",
});
await db.insert(purchaseOrders).values({
  id: ids.purchase,
  code: "PN-EXACT-001",
  supplierId: ids.supplier,
  warehouseId: ids.warehouse,
  status: "received",
  subtotal: "100000.00",
  total: "100000.00",
  amountPaid: "100000.00",
  note: "Private purchase note",
  createdAt: new Date("2026-07-20T08:00:00.000Z"),
});
await db.insert(purchaseOrderItems).values({
  id: ids.purchaseItem,
  purchaseOrderId: ids.purchase,
  productId: ids.product,
  quantity: "1.0000",
  unitCost: "100000.00",
  total: "100000.00",
});
await db.insert(paymentWebhookEvents).values([
  {
    id: ids.event,
    provider: "sepay",
    providerEventId: "sepay-exact-old",
    accountNumber: "1234567890",
    referenceCode: "PRIVATE-REFERENCE",
    transferType: "in",
    transferAmount: "321000.00",
    status: "verified",
    matchStatus: "unmatched",
    matchReason: "missing_reference",
    rawPayload: { private: "do-not-expose" },
    createdAt: new Date("2026-07-20T08:00:00.000Z"),
  },
  {
    id: ids.newerEvent,
    provider: "sepay",
    providerEventId: "sepay-newer",
    accountNumber: "9999999999",
    transferType: "in",
    transferAmount: "1.00",
    status: "verified",
    matchStatus: "unmatched",
    matchReason: "missing_reference",
    rawPayload: {},
    createdAt: new Date("2026-07-21T08:00:00.000Z"),
  },
]);

const storeId = "00000000-0000-4000-8000-000000000001";
let stockGate = { ok: true, userId: "stock-user", storeId, role: "manager", features: {} };
let managerGate = { ok: true, userId: "manager-user", storeId, role: "manager", features: {} };

mock.module("@/db", () => ({ db }));
mock.module("@/lib/mobile/auth", () => createMobileAuthMock({
  async requireMobileStockAccess() {
    return stockGate;
  },
  async requireMobileManager() {
    return managerGate;
  },
}));

const purchaseRoute = await import(
  "../src/app/api/mobile/inventory/purchases/[id]/route.ts"
);
const supplierRoute = await import(
  "../src/app/api/mobile/suppliers/[id]/route.ts"
);
const reconciliationRoute = await import(
  "../src/app/api/mobile/payments/reconciliation/route.ts"
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

async function exact(route, path, id) {
  return route.GET(
    new Request(`https://luma.test${path}/${id}`),
    { params: Promise.resolve({ id }) },
  );
}

await check("purchase exact lookup returns the mobile receipt detail", async () => {
  const response = await exact(
    purchaseRoute,
    "/api/mobile/inventory/purchases",
    ids.purchase,
  );
  assert.equal(response.status, 200);
  const purchaseData = (await body(response)).data;
  assert.deepEqual(purchaseData, {
    id: ids.purchase,
    code: "PN-EXACT-001",
    status: "received",
    createdAt: "2026-07-20T08:00:00.000Z",
    supplierId: ids.supplier,
    supplierName: "Exact Supplier",
    supplierPhone: "0900000001",
    warehouseId: ids.warehouse,
    warehouseName: "Exact Warehouse",
    invoiceNumber: null,
    createdByName: null,
    itemCount: 1,
    subtotal: 100000,
    discount: 0,
    vatRate: 0,
    tax: 0,
    total: 100000,
    amountPaid: 100000,
    note: "Private purchase note",
    items: [{
      id: ids.purchaseItem,
      productId: ids.product,
      productName: "Exact Product",
      sku: "EXACT-001",
      baseUnit: "cái",
      quantity: 1,
      unitCost: 100000,
      discount: 0,
      total: 100000,
      imageUrl: null,
      imageUpdatedAt: purchaseData.items[0].imageUpdatedAt,
      batchNumber: null,
      expiryDate: null,
    }],
  });
  const serialized = JSON.stringify(await body(
    await exact(
      purchaseRoute,
      "/api/mobile/inventory/purchases",
      ids.purchase,
    ),
  ));
  assert.equal(serialized.includes("private@supplier.test"), false);
  assert.equal(serialized.includes("Private supplier address"), false);
});

await check("supplier exact lookup omits private supplier metadata", async () => {
  const response = await exact(
    supplierRoute,
    "/api/mobile/suppliers",
    ids.supplier,
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await body(response)).data, {
    id: ids.supplier,
    code: "NCC-EXACT",
    name: "Exact Supplier",
    phone: "0900000001",
    taxCode: "0312345678",
    currentDebt: 125000,
  });
  const serialized = JSON.stringify(await body(
    await exact(supplierRoute, "/api/mobile/suppliers", ids.supplier),
  ));
  assert.equal(serialized.includes("private@supplier.test"), false);
  assert.equal(serialized.includes("Private supplier address"), false);
  assert.equal(serialized.includes("Private supplier note"), false);
});

await check("reconciliation eventId lookup bypasses list limits", async () => {
  const response = await reconciliationRoute.GET(
    new Request(
      `https://luma.test/api/mobile/payments/reconciliation?eventId=${ids.event}&limit=1`,
    ),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await body(response)).data, {
    id: ids.event,
    provider: "sepay",
    providerEventId: "sepay-exact-old",
    accountNumber: "••••7890",
    transferType: "in",
    transferAmount: 321000,
    matchStatus: "unmatched",
    matchReason: "missing_reference",
    createdAt: "2026-07-20T08:00:00.000Z",
  });
  const serialized = JSON.stringify(await body(
    await reconciliationRoute.GET(
      new Request(
        `https://luma.test/api/mobile/payments/reconciliation?eventId=${ids.event}`,
      ),
    ),
  ));
  assert.equal(serialized.includes("PRIVATE-REFERENCE"), false);
  assert.equal(serialized.includes("do-not-expose"), false);
});

await check("missing and malformed exact IDs return the same 404", async () => {
  for (const [route, path] of [
    [purchaseRoute, "/api/mobile/inventory/purchases"],
    [supplierRoute, "/api/mobile/suppliers"],
  ]) {
    const missing = await exact(route, path, ids.missing);
    const malformed = await exact(route, path, "not-a-uuid");
    assert.equal(missing.status, 404);
    assert.equal(malformed.status, 404);
    assert.deepEqual(await body(missing), await body(malformed));
  }
  for (const eventId of [ids.missing, "not-a-uuid"]) {
    const response = await reconciliationRoute.GET(
      new Request(
        `https://luma.test/api/mobile/payments/reconciliation?eventId=${eventId}`,
      ),
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await body(response), {
      ok: false,
      error: "errors.notFound",
    });
  }
});

await check("unauthorized exact lookup is indistinguishable from missing", async () => {
  stockGate = { ok: false, error: "errors.forbidden" };
  managerGate = { ok: false, error: "errors.forbidden" };
  const purchase = await exact(
    purchaseRoute,
    "/api/mobile/inventory/purchases",
    ids.purchase,
  );
  const supplier = await exact(
    supplierRoute,
    "/api/mobile/suppliers",
    ids.supplier,
  );
  const event = await reconciliationRoute.GET(
    new Request(
      `https://luma.test/api/mobile/payments/reconciliation?eventId=${ids.event}`,
    ),
  );
  for (const response of [purchase, supplier, event]) {
    assert.equal(response.status, 404);
    assert.deepEqual(await body(response), {
      ok: false,
      error: "errors.notFound",
    });
  }
});

console.log(`\nMobile exact entity lookups: ${passed} passed, ${failed} failed`);
await client.close();
if (failed > 0) process.exitCode = 1;
