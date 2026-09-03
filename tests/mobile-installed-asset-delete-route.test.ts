import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createMobileAuthMock } from "./helpers/mobile-auth-mock";

let gate = { ok: true } as { ok: true } | { ok: false; error: string };
let result = { ok: true, data: undefined } as { ok: true; data: undefined } | { ok: false; error: string };
const deletedIds: string[] = [];
mock.module("@/lib/mobile/auth", () => createMobileAuthMock({ requireMobileServiceManager: async () => gate }));
mock.module("@/lib/actions/services", () => ({
  deleteInstalledAsset: async (id: string) => { deletedIds.push(id); return result; },
}));
afterAll(() => mock.restore());
let DELETE: typeof import("../src/app/api/mobile/services/assets/[assetId]/route").DELETE;
beforeAll(async () => { ({ DELETE } = await import("../src/app/api/mobile/services/assets/[assetId]/route")); });
beforeEach(() => { gate = { ok: true }; result = { ok: true, data: undefined }; deletedIds.length = 0; });
const remove = () => DELETE(new Request("https://luma.test/api/mobile/services/assets/asset-1", { method: "DELETE" }), { params: Promise.resolve({ assetId: "asset-1" }) });

describe("mobile saved device deletion", () => {
  test("passes the requested device to the shared action", async () => {
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(deletedIds).toEqual(["asset-1"]);
  });
  test.each([["errors.unauthorized", 401], ["errors.forbidden", 403]] as const)("blocks %s before deleting", async (error, status) => {
    gate = { ok: false, error };
    expect((await remove()).status).toBe(status);
    expect(deletedIds).toEqual([]);
  });
  test("returns business errors without reporting success", async () => {
    result = { ok: false, error: "services.errors.assetDeleteLinked" };
    const response = await remove();
    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual(result);
  });
});
