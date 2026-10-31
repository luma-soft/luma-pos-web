import { expect, mock, test } from "bun:test";

let authorized = true;
let revision = "42";
let snapshotRequests = 0;
let requestedOptions = null;
let shouldFail = false;

mock.module("@/lib/mobile/auth", () => ({
  requireMobileStockReadAccess: async () =>
    authorized
      ? { ok: true, storeId: "store-a", userId: "cashier-a", role: "cashier" }
      : { ok: false, error: "errors.unauthorized" },
}));

mock.module("@/lib/data/product-catalog", () => ({
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
  const response = await GET(new Request("http://localhost/api/mobile/products/catalog?sinceRevision=42"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await response.json()).data).toEqual({
    mode: "unchanged", revision: "42", deltaSupported: false,
  });
  expect(snapshotRequests).toBe(0);
});

test("new revision returns full, authorized and inactive-aware snapshot", async () => {
  snapshotRequests = 0;
  const response = await GET(new Request("http://localhost/api/mobile/products/catalog?sinceRevision=41"));
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

test("unauthorized, invalid revision and partial snapshots are never published", async () => {
  authorized = false;
  expect((await GET(new Request("http://localhost/api/mobile/products/catalog"))).status).toBe(401);
  authorized = true;
  expect((await GET(new Request("http://localhost/api/mobile/products/catalog?sinceRevision=malformed"))).status).toBe(400);
  shouldFail = true;
  expect((await GET(new Request("http://localhost/api/mobile/products/catalog"))).status).toBe(503);
  shouldFail = false;
});
