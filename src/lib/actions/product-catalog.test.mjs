import { expect, mock, test } from "bun:test";

let revisionValues = [];
let revisionIndex = 0;
let deltaValues = [];
let deltaRequests = [];
let snapshotRequests = 0;

mock.module("@/lib/auth/store-context", () => ({
  requireStoreContext: async () => ({
    storeId: "store-a", userId: "user-a", role: "manager",
  }),
}));

mock.module("@/lib/data/product-catalog", () => ({
  getProductCatalogRevision: async () => revisionValues[revisionIndex++] ?? revisionValues.at(-1),
  getProductCatalogDeltaV2: async (...args) => {
    deltaRequests.push(args);
    return deltaValues.shift() ?? null;
  },
  getProductCatalogSnapshot: async (...args) => {
    snapshotRequests += 1;
    return {
      schemaVersion: 12,
      revision: revisionValues.at(-1),
      userId: args[1],
      scopeId: "store-a:user-a:manager",
      savedAt: 1,
      products: [],
      warehouses: [],
    };
  },
}));

// Load only after registering Bun's dependency mocks.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { syncProductCatalog } = require("./product-catalog");

test("retries a bounded delta when its target revision changes during hydration", async () => {
  revisionValues = ["10", "11"];
  revisionIndex = 0;
  deltaRequests = [];
  snapshotRequests = 0;
  deltaValues = [null, {
    baseRevision: "9",
    revision: "11",
    schemaVersion: 12,
    userId: "user-a",
    scopeId: "store-a:user-a:manager",
    upserts: [{ id: "product-a", sku: "SKU-A" }],
    deletedIds: [],
    hasMore: false,
  }];

  const result = await syncProductCatalog("9");

  expect(result?.mode).toBe("delta");
  if (result?.mode !== "delta") throw new Error("Expected recovered delta");
  expect(result.delta.revision).toBe("11");
  expect(deltaRequests.map(([, , , since, target]) => [since, target]))
    .toEqual([["9", "10"], ["9", "11"]]);
  expect(snapshotRequests).toBe(0);
});
