import { expect, mock, test } from "bun:test";

let authorized = true;
let revision = "42";
let snapshotRequests = 0;
let requestedOptions = null;
let shouldFail = false;
let deltaResult = null;
let deltaThrows = false;
const deltaRequests = [];

mock.module("@/lib/mobile/auth", () => ({
  requireMobileStockReadAccess: async () =>
    authorized
      ? { ok: true, storeId: "store-a", userId: "cashier-a", role: "cashier" }
      : { ok: false, error: "errors.unauthorized" },
}));

mock.module("@/lib/data/product-catalog", () => ({
  getProductCatalogDelta: async (...args) => {
    deltaRequests.push(args);
    if (deltaThrows) throw new Error("journal temporarily unavailable");
    return deltaResult;
  },
  getProductCatalogRevision: async (storeId) => {
    expect(storeId).toBe("store-a");
    return revision;
  },
  getProductCatalogSnapshot: async (...args) => {
    snapshotRequests += 1;
    requestedOptions = args;
    if (shouldFail) throw new Error("snapshot changed during sync");
    return {
      schemaVersion: 9,
      revision,
      userId: args[1],
      scopeId: "store-a:cashier-a:cashier",
      savedAt: 1,
      products: [{
        id: "product-a", name: "Dây điện", isActive: false,
        lifecycleStatus: "inactive", units: [{ unitName: "cuộn", directSale: true }],
      }],
      warehouses: [],
    };
  },
}));

const { GET } = await import("./route");

test("same revision returns no-op without downloading the product catalog", async () => {
  authorized = true; shouldFail = false; snapshotRequests = 0;
  deltaResult = null; deltaThrows = false;
  const response = await GET(new Request("http://localhost/api/mobile/products/catalog?sinceRevision=42&sinceScope=store-a%3Acashier-a%3Acashier"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await response.json()).data).toEqual({
    mode: "unchanged", revision: "42", deltaSupported: false,
  });
  expect(snapshotRequests).toBe(0);
});

test("same store revision with changed effective role is a FULL download", async () => {
  authorized = true; shouldFail = false; snapshotRequests = 0;
  const response = await GET(new Request(
    "http://localhost/api/mobile/products/catalog?sinceRevision=42&sinceScope=store-a%3Aprevious-user%3Aowner",
  ));
  const body = await response.json();
  expect(body.data.mode).toBe("full");
  expect(snapshotRequests).toBe(1);
});

test("new revision returns full, authorized and inactive-aware snapshot", async () => {
  snapshotRequests = 0;
  const response = await GET(new Request("http://localhost/api/mobile/products/catalog?sinceRevision=41&sinceScope=store-a%3Acashier-a%3Acashier"));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.mode).toBe("full");
  expect(body.data.deltaSupported).toBe(false);
  expect(body.data.catalog.products[0].isActive).toBe(false);
  expect(requestedOptions).toEqual([
    "store-a", "cashier-a", "cashier", { includeInactive: true },
  ]);
  expect(snapshotRequests).toBe(1);
});

test("changed product or hard-delete returns replayable delta without full snapshot", async () => {
  authorized = true; shouldFail = false;
  snapshotRequests = 0; deltaRequests.length = 0;
  deltaResult = {
    baseRevision: "41", revision: "42", schemaVersion: 9,
    userId: "cashier-a", scopeId: "store-a:cashier-a:cashier",
    upserts: [{ id: "product-a", retailPrice: "15000" }],
    deletedIds: ["product-deleted"],
  };
  const response = await GET(new Request(
    "http://localhost/api/mobile/products/catalog?sinceRevision=41&sinceScope=store-a%3Acashier-a%3Acashier",
  ));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.mode).toBe("delta");
  expect(body.data.deltaSupported).toBe(true);
  expect(body.data.delta.deletedIds).toEqual(["product-deleted"]);
  expect(deltaRequests.at(-1)).toEqual(["store-a","cashier-a","cashier","41","42"]);
  expect(snapshotRequests).toBe(0);
  deltaResult = null;
});

test("journal gaps or full-required changes fall back to complete catalog", async () => {
  authorized = true; shouldFail = false;
  deltaResult = null; deltaThrows = false; snapshotRequests = 0;
  const response = await GET(new Request(
    "http://localhost/api/mobile/products/catalog?sinceRevision=38&sinceScope=store-a%3Acashier-a%3Acashier",
  ));
  expect((await response.json()).data.mode).toBe("full");
  expect(snapshotRequests).toBe(1);

  deltaThrows = true; snapshotRequests = 0;
  const fallback = await GET(new Request(
    "http://localhost/api/mobile/products/catalog?sinceRevision=38&sinceScope=store-a%3Acashier-a%3Acashier",
  ));
  expect((await fallback.json()).data.mode).toBe("full");
  expect(snapshotRequests).toBe(1);
  deltaThrows = false;
});

test("unauthorized, invalid revision and partial snapshots are never published", async () => {
  authorized = false;
  expect((await GET(new Request("http://localhost/api/mobile/products/catalog"))).status).toBe(401);
  authorized = true;
  expect((await GET(new Request("http://localhost/api/mobile/products/catalog?sinceRevision=malformed"))).status).toBe(400);
  shouldFail = true;
  expect((await GET(new Request("http://localhost/api/mobile/products/catalog"))).status).toBe(503);
  shouldFail = false;
});
