import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: {} }));

import { NEW_STORE_FEATURE_DEFAULTS } from "../src/lib/tenancy/store-features";

const { createMediaLibraryHandlers } = await import(
  "../src/app/api/mobile/library/route"
);

const gate = {
  ok: true as const,
  storeId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  role: "manager" as const,
  features: NEW_STORE_FEATURE_DEFAULTS,
};

describe("media library API", () => {
  test("requires an authenticated active store", async () => {
    const handlers = createMediaLibraryHandlers({
      authenticate: async () => ({ ok: false, error: "errors.unauthorized" }),
    });
    const response = await handlers.GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "errors.unauthorized" });
  });

  test("lists the current store snapshot using the authenticated actor", async () => {
    const actors: unknown[] = [];
    const snapshot = {
      items: [],
      albums: [],
      usage: { libraryBytes: 0, libraryObjects: 0, totalBytes: 0, totalObjects: 0 },
      canManage: true,
    };
    const handlers = createMediaLibraryHandlers({
      authenticate: async () => gate,
      list: async (actor) => { actors.push(actor); return snapshot; },
    });
    const response = await handlers.GET();
    expect(response.status).toBe(200);
    expect(actors).toEqual([{
      storeId: gate.storeId,
      userId: gate.userId,
      role: gate.role,
      features: gate.features,
    }]);
    expect(await response.json()).toEqual({ ok: true, data: snapshot });
  });

  test("forwards create metadata and delete coordinates", async () => {
    const calls: unknown[] = [];
    const handlers = createMediaLibraryHandlers({
      authenticate: async () => gate,
      create: async (actor, body) => { calls.push({ actor, body }); return { id: "item-1" }; },
      remove: async (actor, id) => { calls.push({ actor, id }); return { id, storagePending: true }; },
    });
    const createResponse = await handlers.POST(new Request("https://luma.test/api/mobile/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: "media-1", album: "Đèn", title: "Đèn thả" }),
    }));
    const deleteResponse = await handlers.DELETE(new Request(
      "https://luma.test/api/mobile/library?id=item-1",
      { method: "DELETE" },
    ));

    expect(createResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(calls[0]).toMatchObject({ body: { mediaId: "media-1", album: "Đèn", title: "Đèn thả" } });
    expect(calls[1]).toMatchObject({ id: "item-1" });
  });

  test("maps library service errors without leaking internals", async () => {
    const { MediaLibraryError } = await import("../src/lib/media/library");
    const handlers = createMediaLibraryHandlers({
      authenticate: async () => gate,
      list: async () => { throw new MediaLibraryError("errors.forbidden", 403); },
    });
    const response = await handlers.GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "errors.forbidden" });
  });
});
