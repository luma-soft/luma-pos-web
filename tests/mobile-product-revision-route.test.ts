import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createMobileAuthMock } from "./helpers/mobile-auth-mock";

afterAll(() => mock.restore());

type ReadGate = { ok: true; storeId: string } | { ok: false; error: string };
let gate: ReadGate = { ok: true, storeId: "store-a" };
const revisions = new Map<string, string>();
const queriedStores: string[] = [];

mock.module("@/lib/mobile/auth", () => createMobileAuthMock({
  requireMobileStockReadAccess: async () => gate,
}));

mock.module("@/lib/data/product-catalog", () => ({
  getProductCatalogRevision: async (storeId: string) => {
    queriedStores.push(storeId);
    return revisions.get(storeId) ?? "0";
  },
}));

let getRevision: () => Promise<Response>;

beforeAll(async () => {
  ({ GET: getRevision } = await import("../src/app/api/mobile/products/revision/route"));
});

beforeEach(() => {
  gate = { ok: true, storeId: "store-a" };
  revisions.clear();
  revisions.set("store-a", "9007199254740993");
  queriedStores.splice(0);
});

describe("GET /api/mobile/products/revision", () => {
  test("returns the authenticated store revision without losing bigint precision", async () => {
    const response = await getRevision();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { revision: "9007199254740993" },
    });
    expect(queriedStores).toEqual(["store-a"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  test("reads the current database revision on every refresh", async () => {
    const before = await getRevision();
    revisions.set("store-a", "9007199254740994");
    const after = await getRevision();

    expect((await before.json()).data.revision).toBe("9007199254740993");
    expect((await after.json()).data.revision).toBe("9007199254740994");
    expect(queriedStores).toEqual(["store-a", "store-a"]);
  });

  test("uses the active store when the authenticated store changes", async () => {
    revisions.set("store-b", "42");
    gate = { ok: true, storeId: "store-b" };

    const response = await getRevision();

    expect((await response.json()).data.revision).toBe("42");
    expect(queriedStores).toEqual(["store-b"]);
  });

  test.each([
    ["errors.unauthorized", 401],
    ["errors.forbidden", 403],
  ] as const)("rejects %s before reading catalog data", async (error, status) => {
    gate = { ok: false, error };

    const response = await getRevision();

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error });
    expect(queriedStores).toEqual([]);
  });
});
