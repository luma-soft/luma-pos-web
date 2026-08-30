import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { MediaActor } from "@/lib/media/authorization";

mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: {} }));
afterAll(() => mock.restore());

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.jpg`;
const URL = `https://media.lumapos.vn/${PATH}`;

const managedPuts: Array<{
  actor: Record<string, unknown>;
  input: Record<string, unknown>;
  bytes: Uint8Array;
}> = [];
const managedDeletes: string[] = [];
const legacyRemovals: string[][] = [];
let heicConversions = 0;

const { uploadProductImage: uploadHandler, deleteProductImage: deleteHandler } =
  await import("../src/lib/images/product-image-route");

const dependencies = {
  authenticate: async () => ({
    ok: true as const,
    storeId: STORE_ID,
    userId: USER_ID,
    role: "manager" as const,
    features: {
      camera_quote_builder: true,
      camera_price_list: true,
      hunonic_price_list: true,
      rang_dong_price_list: true,
      field_services: true,
      online_sales: true,
      ai_assistant: true,
      einvoice: true,
    },
  }),
  mediaService: {
    async putManagedObject(
      actor: MediaActor,
      input: unknown,
      bytes: Uint8Array,
    ) {
      managedPuts.push({
        actor,
        input: input as Record<string, unknown>,
        bytes,
      });
      return { mediaId: MEDIA_ID, path: PATH, url: URL };
    },
    async deleteMedia(_actor: MediaActor, mediaId: string) {
      managedDeletes.push(mediaId);
      return { id: mediaId, status: "deleted" as const };
    },
  },
  async convertHeif() {
    heicConversions += 1;
    return Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  },
  async removeLegacy(path: string) {
    legacyRemovals.push([path]);
  },
};

const uploadProductImage = (request: Request) =>
  uploadHandler(request, dependencies);
const deleteProductImage = (request: Request) =>
  deleteHandler(request, dependencies);

beforeEach(() => {
  managedPuts.splice(0);
  managedDeletes.splice(0);
  legacyRemovals.splice(0);
  heicConversions = 0;
});

function uploadRequest(bytes: number[], type = "image/jpeg") {
  const form = new FormData();
  const extension = type.split("/").at(-1) ?? "jpg";
  form.set("file", new File([Uint8Array.from(bytes)], `camera.${extension}`, { type }));
  return new Request("https://luma.test/api/mobile/products/images", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/mobile/products/images", () => {
  test("writes validated bytes through MediaService and returns managed coordinates", async () => {
    const response = await uploadProductImage(
      uploadRequest([0xff, 0xd8, 0xff, 0x00]),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { mediaId: MEDIA_ID, url: URL, path: PATH },
    });
    expect(managedPuts).toHaveLength(1);
    expect(managedPuts[0]).toMatchObject({
      actor: { storeId: STORE_ID, userId: USER_ID },
      input: {
        purpose: "product-image",
        targetId: STORE_ID,
        fileName: "camera.jpeg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
      },
    });
    expect(Array.from(managedPuts[0]!.bytes)).toEqual([0xff, 0xd8, 0xff, 0x00]);
  });

  test("keeps MIME sniffing and HEIF-to-JPEG conversion before managed storage", async () => {
    const mismatch = await uploadProductImage(
      uploadRequest([0x89, 0x50, 0x4e, 0x47], "image/jpeg"),
    );
    expect(mismatch.status).toBe(400);
    expect(managedPuts).toEqual([]);

    const heif = await uploadProductImage(uploadRequest(
      [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],
      "image/heic",
    ));
    expect(heif.status).toBe(200);
    expect(heicConversions).toBe(1);
    expect(managedPuts[0]).toMatchObject({
      input: {
        fileName: "camera.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
      },
    });
  });
});

describe("DELETE /api/mobile/products/images", () => {
  test("deletes by managed media ID without passing an R2 key to Supabase", async () => {
    const response = await deleteProductImage(new Request(
      `https://luma.test/api/mobile/products/images?mediaId=${MEDIA_ID}&path=${encodeURIComponent(PATH)}`,
      { method: "DELETE" },
    ));
    expect(response.status).toBe(200);
    expect(managedDeletes).toEqual([MEDIA_ID]);
    expect(legacyRemovals).toEqual([]);
  });

  test("retains strict user-scoped legacy Supabase cleanup", async () => {
    for (const path of [
      `${USER_ID}/uncommitted.jpg`,
      `stores/${STORE_ID}/products/drafts/${USER_ID}/uncommitted.jpg`,
    ]) {
      const response = await deleteProductImage(new Request(
        `https://luma.test/api/mobile/products/images?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      ));
      expect(response.status).toBe(200);
    }
    expect(legacyRemovals).toEqual([
      [`${USER_ID}/uncommitted.jpg`],
      [`stores/${STORE_ID}/products/drafts/${USER_ID}/uncommitted.jpg`],
    ]);
  });

  test("never accepts a path-only R2 key or another user's legacy path", async () => {
    for (const path of [
      PATH,
      "someone-else/uncommitted.jpg",
      `stores/${STORE_ID}/products/drafts/someone-else/uncommitted.jpg`,
    ]) {
      const response = await deleteProductImage(new Request(
        `https://luma.test/api/mobile/products/images?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      ));
      expect(response.status).toBe(403);
    }
    expect(managedDeletes).toEqual([]);
    expect(legacyRemovals).toEqual([]);
  });
});
