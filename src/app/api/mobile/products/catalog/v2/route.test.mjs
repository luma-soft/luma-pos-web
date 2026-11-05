import { expect, mock, test } from "bun:test";

let authorized = true;
let revision = "91";
let revisionReplies = [];
let snapshotRequests = 0;
let deltaResult = null;
let deltaThrows = false;
let deltaResponses = [];
const deltaRequests = [];

mock.module("@/lib/mobile/auth", () => ({
  requireMobileStockReadAccess: async () => authorized
    ? { ok: true, storeId: "store-a", userId: "owner-a", role: "manager" }
    : { ok: false, error: "errors.unauthorized" },
}));

mock.module("@/lib/data/product-catalog", () => ({
  getProductCatalogRevision: async () => revisionReplies.length ? revisionReplies.shift() : revision,
  getProductCatalogSnapshot: async (...args) => {
    snapshotRequests += 1;
    return {
      schemaVersion: 12,
      revision,
      userId: args[1],
      scopeId: "store-a:owner-a:manager",
      savedAt: 1,
      products: [{ id: "product-a", name: "Dây điện" }],
      warehouses: [],
    };
  },
  getProductCatalogDeltaV2: async (...args) => {
    deltaRequests.push(args);
    if (deltaThrows) throw new Error("journal temporarily unavailable");
    if (deltaResponses.length) return deltaResponses.shift();
    return deltaResult;
  },
}));

mock.module("@/lib/mobile/response", () => ({
  mobileGate: () => Response.json({ error: "unauthorized" }, { status: 401 }),
  mobileError: (message, status) => Response.json({ error: message }, { status }),
  mobileOk: (data) => Response.json({ data }),
}));

// Load after registering Bun's dependency mocks above.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require("./route");

test("V2 rejects unauthorized and malformed revision requests", async () => {
  authorized = false;
  expect((await GET(new Request("http://localhost/api/mobile/products/catalog/v2"))).status).toBe(401);
  authorized = true;
  expect((await GET(new Request(
    "http://localhost/api/mobile/products/catalog/v2?sinceRevision=abc",
  ))).status).toBe(400);
});

test("matching revision and actor scope returns unchanged without a snapshot", async () => {
  snapshotRequests = 0;
  const response = await GET(new Request(
    "http://localhost/api/mobile/products/catalog/v2?sinceRevision=91&sinceScope=store-a%3Aowner-a%3Amanager",
  ));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(body.data).toEqual({
    protocolVersion: 2,
    mode: "unchanged",
    revision: "91",
    deltaSupported: true,
  });
  expect(snapshotRequests).toBe(0);
});

test("scope change forces a full V2 snapshot", async () => {
  snapshotRequests = 0;
  const response = await GET(new Request(
    "http://localhost/api/mobile/products/catalog/v2?sinceRevision=90&sinceScope=store-a%3Aother-user%3Aowner",
  ));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.mode).toBe("full");
  expect(body.data.catalog.schemaVersion).toBe(12);
  expect(snapshotRequests).toBe(1);
});

test("same-scope changes return a delta without downloading a full snapshot", async () => {
  snapshotRequests = 0;
  deltaRequests.length = 0;
  deltaThrows = false;
  deltaResult = {
    baseRevision: "90",
    revision: "91",
    schemaVersion: 12,
    userId: "owner-a",
    scopeId: "store-a:owner-a:manager",
    upserts: [{ id: "product-a", retailPrice: "20000" }],
    deletedIds: ["product-deleted"],
    hasMore: false,
  };
  const response = await GET(new Request(
    "http://localhost/api/mobile/products/catalog/v2?sinceRevision=90&sinceScope=store-a%3Aowner-a%3Amanager",
  ));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.mode).toBe("delta");
  expect(body.data.protocolVersion).toBe(2);
  expect(body.data.delta.deletedIds).toEqual(["product-deleted"]);
  expect(deltaRequests[0]).toEqual(["store-a", "owner-a", "manager", "90", "91"]);
  expect(snapshotRequests).toBe(0);
});

test("expired or failed journal replay recovers with a complete snapshot", async () => {
  snapshotRequests = 0;
  deltaResult = null;
  const expired = await GET(new Request(
    "http://localhost/api/mobile/products/catalog/v2?sinceRevision=1&sinceScope=store-a%3Aowner-a%3Amanager",
  ));
  expect((await expired.json()).data.mode).toBe("full");
  expect(snapshotRequests).toBe(1);

  snapshotRequests = 0;
  deltaThrows = true;
  const failed = await GET(new Request(
    "http://localhost/api/mobile/products/catalog/v2?sinceRevision=1&sinceScope=store-a%3Aowner-a%3Amanager",
  ));
  expect((await failed.json()).data.mode).toBe("full");
  expect(snapshotRequests).toBe(1);
  deltaThrows = false;
  deltaResult = null;
});

test("retries the delta against a newer bounded target when revision moves during hydration", async () => {
  revisionReplies = ["91", "92"];
  deltaRequests.length = 0;
  snapshotRequests = 0;
  deltaResult = null;
  deltaResponses = [null, {
    baseRevision: "90",
    revision: "92",
    schemaVersion: 12,
    userId: "owner-a",
    scopeId: "store-a:owner-a:manager",
    upserts: [{ id: "product-a", retailPrice: "21000" }],
    deletedIds: [],
    hasMore: false,
  }];

  const response = await GET(new Request(
    "http://localhost/api/mobile/products/catalog/v2?sinceRevision=90&sinceScope=store-a%3Aowner-a%3Amanager",
  ));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.mode).toBe("delta");
  expect(body.data.delta.revision).toBe("92");
  expect(deltaRequests.map(([, , , since, target]) => [since, target]))
    .toEqual([["90", "91"], ["90", "92"]]);
  expect(snapshotRequests).toBe(0);

  revisionReplies = [];
  deltaResponses = [];
});
