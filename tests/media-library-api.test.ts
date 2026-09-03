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

  test("metadata backfill binds the actor and item only, never trusts supplied EXIF", async () => {
    const calls: unknown[] = [];
    const handlers = createMediaLibraryHandlers({
      authenticate: async () => gate,
      extractMetadata: async (actor, id) => {
        calls.push({ actor, id });
        return { id, metadata: { version: 1, status: "ready" } } as never;
      },
    });
    const response = await handlers.POST(new Request("https://luma.test/api/mobile/library", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "extract-metadata", id: gate.storeId, latitude: 99, storeId: "forged" }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([{ actor: { storeId: gate.storeId, userId: gate.userId, role: gate.role, features: gate.features }, id: gate.storeId }]);
    const { MediaServiceError } = await import("../src/lib/media/service");
    const denied = createMediaLibraryHandlers({ authenticate: async () => gate,
      extractMetadata: async () => { throw new MediaServiceError("errors.notFound", 404); },
    });
    const missing = await denied.POST(new Request("https://luma.test/api/mobile/library", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "extract-metadata", id: gate.storeId }),
    }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: "errors.notFound" });
  });

  test("forwards bounded filters and rejects malformed query parameters before repository access", async () => {
    const queries: unknown[] = [];
    const handlers = createMediaLibraryHandlers({
      authenticate: async () => gate,
      list: async (_actor, query) => {
        queries.push(query);
        return { items: [], albums: [], usage: { libraryBytes: 0, libraryObjects: 0, totalBytes: 0, totalObjects: 0 }, canManage: true };
      },
    });
    const response = await handlers.GET(new Request("https://luma.test/api/mobile/library?q=voi%20chau&album=old&kind=image&limit=20"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(queries).toEqual([{ q: "voi chau", album: "old", kind: "image", limit: 20, includeSources: false }]);
    for (const query of ["kind=audio", "cursor=broken", "limit=101"]) {
      const invalid = await handlers.GET(new Request(`https://luma.test/api/mobile/library?${query}`));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ ok: false, error: "errors.invalidData" });
    }
    expect(queries.length).toBe(1);
  });

  test("new clients opt in to source albums without conflating same-name manual albums", async () => {
    const queries: unknown[] = [];
    const handlers = createMediaLibraryHandlers({
      authenticate: async () => gate,
      list: async (_actor, query) => {
        queries.push(query);
        return { items: [], albums: [], usage: { libraryBytes: 0, libraryObjects: 0, totalBytes: 0, totalObjects: 0 }, canManage: true };
      },
    });
    expect((await handlers.GET(new Request("https://luma.test/api/mobile/library?includeSources=1&source=products"))).status).toBe(200);
    expect(queries[0]).toMatchObject({ includeSources: true, source: "products" });
    expect((await handlers.GET(new Request("https://luma.test/api/mobile/library?includeSources=1&album=H%C3%A0ng%20h%C3%B3a"))).status).toBe(200);
    expect(queries[1]).toMatchObject({ includeSources: true, album: "Hàng hóa" });
    for (const query of ["source=products", "includeSources=0", "includeSources=1&source=unknown", "includeSources=1&source=products&album=Hàng%20hóa", "includeSources=1&includeSources=1"]) {
      expect((await handlers.GET(new Request(`https://luma.test/api/mobile/library?${query}`))).status).toBe(400);
    }
    expect(queries).toHaveLength(2);
  });

  test("resolves only authenticated item coordinates and redirects to the server-signed URL", async () => {
    const calls: unknown[] = [];
    const item = {
      id: "33333333-3333-4333-8333-333333333333", mediaId: "media-1", album: "old", title: "Sample",
      note: null, tags: [], kind: "image" as const, fileName: "sample.jpg", mimeType: "image/jpeg",
      sizeBytes: 100, createdAt: "2026-09-01T00:00:00.000Z", creatorName: null,
      url: "https://storage.luma.test/private/sample.jpg?signature=fresh", thumbnailUrl: null,
    };
    const handlers = createMediaLibraryHandlers({
      authenticate: async () => gate,
      resolve: async (actor, id) => { calls.push({ actor, id }); return item; },
    });
    const resolved = await handlers.GET(new Request(`https://luma.test/api/mobile/library?resolve=${item.id}&storeId=untrusted&mediaId=untrusted`));
    expect(await resolved.json()).toEqual({ ok: true, data: item });
    expect(resolved.headers.get("cache-control")).toBe("private, no-store");
    const opened = await handlers.GET(new Request(`https://luma.test/api/mobile/library?open=${item.id}&url=https://evil.test`));
    expect(opened.status).toBe(307);
    expect(opened.headers.get("location")).toBe(item.url);
    expect(opened.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([
      { actor: { storeId: gate.storeId, userId: gate.userId, role: gate.role, features: gate.features }, id: item.id },
      { actor: { storeId: gate.storeId, userId: gate.userId, role: gate.role, features: gate.features }, id: item.id },
    ]);
  });

  test("unauthorized and cross-store items cannot resolve or redirect", async () => {
    const { MediaLibraryError } = await import("../src/lib/media/library");
    for (const mode of ["resolve", "open"]) {
      const request = new Request(`https://luma.test/api/mobile/library?${mode}=33333333-3333-4333-8333-333333333333`);
      const unauthenticated = createMediaLibraryHandlers({
        authenticate: async () => ({ ok: false, error: "errors.unauthorized" }),
        resolve: async () => { throw new Error("Must not resolve unauthenticated requests"); },
      });
      expect((await unauthenticated.GET(request)).status).toBe(401);
      const handlers = createMediaLibraryHandlers({
        authenticate: async () => gate,
        resolve: async () => { throw new MediaLibraryError("errors.notFound", 404); },
      });
      const response = await handlers.GET(request);
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    }
  });
});
