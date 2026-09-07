import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/lib/media/library", () => ({
  createMediaLibraryItem: async () => null,
  deleteMediaLibraryItem: async () => null,
  deleteMediaLibraryItems: async () => null,
  extractMediaLibraryMetadata: async () => null,
  getMediaLibrarySnapshot: async () => null,
  mediaLibraryError: () => ({ error: "errors.serverError", status: 500 }),
  resolveMediaLibraryItem: async () => null,
  updateMediaLibraryItem: async () => null,
}));

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];
const actor = {
  ok: true,
  storeId: "33333333-3333-4333-8333-333333333333",
  userId: "44444444-4444-4444-8444-444444444444",
  role: "manager",
  features: {},
};
const request = (body) => new Request("http://localhost/api/mobile/library", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const { createMediaLibraryHandlers } = await import("./route");

test("batch delete validates and delegates a bounded unique selection", async () => {
  const removeMany = mock(async () => ({ deletedIds: [ids[0]], failed: [{ id: ids[1], error: "errors.notFound" }] }));
  const { POST } = createMediaLibraryHandlers({ authenticate: async () => actor, removeMany });

  const response = await POST(request({ action: "delete-many", ids }));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({
    deletedIds: [ids[0]],
    failed: [{ id: ids[1], error: "errors.notFound" }],
  });
  expect(removeMany).toHaveBeenCalledTimes(1);
  expect(removeMany.mock.calls[0][1]).toEqual(ids);
});

test("batch delete rejects invalid, duplicate and oversized selections", async () => {
  const removeMany = mock();
  const { POST } = createMediaLibraryHandlers({ authenticate: async () => actor, removeMany });
  const invalid = [
    [],
    [ids[0], ids[0]],
    ["not-an-id"],
    Array.from({ length: 21 }, (_, index) =>
      `11111111-1111-4111-8111-${index.toString().padStart(12, "0")}`),
  ];
  for (const candidate of invalid) {
    expect((await POST(request({ action: "delete-many", ids: candidate }))).status).toBe(400);
  }
  expect(removeMany).not.toHaveBeenCalled();
});

test("download proxies the resolved image with a safe attachment header", async () => {
  const resolve = mock(async () => ({
    id: ids[0],
    fileName: "ảnh camera's.heic",
    mimeType: "image/heic",
    url: "https://media.example/signed",
  }));
  const fetchMedia = mock(async () => new Response(new Uint8Array([1, 2, 3]), {
    headers: { "Content-Type": "image/heic" },
  }));
  const { GET } = createMediaLibraryHandlers({
    authenticate: async () => actor,
    resolve,
    fetchMedia,
  });

  const response = await GET(new Request(`http://localhost/api/mobile/library?download=${ids[0]}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/heic");
  expect(response.headers.get("Content-Disposition")).toContain("%E1%BA%A3nh%20camera%27s.heic");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect(fetchMedia).toHaveBeenCalledWith("https://media.example/signed", { cache: "no-store" });
});

test("preview converts an authorized HEIC image to browser-compatible WebP", async () => {
  const resolve = mock(async () => ({
    id: ids[0],
    fileName: "camera.heic",
    mimeType: "image/heic",
    url: "https://media.example/signed-heic",
  }));
  const fetchMedia = mock(async () => new Response(new Uint8Array([1, 2, 3]), {
    headers: { "Content-Type": "image/heic" },
  }));
  const createThumbnail = mock(async () => new Uint8Array([8, 9]));
  const { GET } = createMediaLibraryHandlers({
    authenticate: async () => actor,
    resolve,
    fetchMedia,
    createThumbnail,
  });

  const response = await GET(new Request(`http://localhost/api/mobile/library?preview=${ids[0]}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/webp");
  expect(response.headers.get("Cache-Control")).toContain("private");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([8, 9]));
  expect(fetchMedia).toHaveBeenCalledWith("https://media.example/signed-heic", { cache: "no-store" });
  expect(createThumbnail).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "image/heic");
});
