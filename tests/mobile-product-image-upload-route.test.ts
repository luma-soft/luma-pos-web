import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const uploads: Array<{
  bucket: string;
  path: string;
  bytes: Uint8Array;
  options: Record<string, unknown>;
}> = [];
const removals: string[][] = [];
let heicConversions = 0;

mock.module("sharp", () => ({
  default: () => ({
    rotate() {
      return this;
    },
    jpeg() {
      return this;
    },
    async toBuffer() {
      heicConversions += 1;
      return Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
    },
  }),
}));

mock.module("@/lib/mobile/auth", () => ({
  requireMobileStockAccess: async () => ({
    ok: true,
    storeId: "store-1",
    userId: "user-1",
    role: "manager",
  }),
}));

mock.module("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          bytes: Uint8Array,
          options: Record<string, unknown>,
        ) => {
          uploads.push({ bucket, path, bytes, options });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.test/${bucket}/${path}` },
        }),
        remove: async (paths: string[]) => {
          removals.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));

let uploadProductImage: (request: Request) => Promise<Response>;
let deleteProductImage: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST: uploadProductImage, DELETE: deleteProductImage } = await import(
    "../src/app/api/mobile/products/images/route"
  ));
});

beforeEach(() => {
  uploads.splice(0);
  removals.splice(0);
  heicConversions = 0;
});

function uploadRequest(bytes: number[], type = "image/jpeg") {
  const form = new FormData();
  const extension = type === "image/heic" ? "heic" : "jpg";
  form.set("file", new File([Uint8Array.from(bytes)], `camera.${extension}`, { type }));
  return new Request("https://luma.test/api/mobile/products/images", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/mobile/products/images", () => {
  test("uploads a validated image to a unique user-scoped path", async () => {
    const response = await uploadProductImage(
      uploadRequest([0xff, 0xd8, 0xff, 0x00]),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      bucket: "products",
      options: { contentType: "image/jpeg", upsert: false },
    });
    expect(uploads[0]?.path).toMatch(/^stores\/store-1\/products\/drafts\/user-1\/\d+-[\w-]+\.jpg$/);
    expect(payload.data.url).toBe(
      `https://cdn.test/products/${uploads[0]?.path}`,
    );
  });

  test("rejects a declared image whose bytes do not match", async () => {
    const response = await uploadProductImage(
      uploadRequest([0x89, 0x50, 0x4e, 0x47], "image/jpeg"),
    );

    expect(response.status).toBe(400);
    expect(uploads).toHaveLength(0);
  });

  test("rejects unsupported image formats", async () => {
    const response = await uploadProductImage(
      uploadRequest([0x00, 0x00, 0x00], "image/heic"),
    );

    expect(response.status).toBe(400);
    expect(uploads).toHaveLength(0);
  });

  test("normalizes an iPhone HEIC image to JPEG before storage", async () => {
    const response = await uploadProductImage(
      uploadRequest(
        [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],
        "image/heic",
      ),
    );

    expect(response.status).toBe(200);
    expect(heicConversions).toBe(1);
    expect(uploads[0]).toMatchObject({
      options: { contentType: "image/jpeg", upsert: false },
    });
    expect(uploads[0]?.path).toEndWith(".jpg");
  });

  test("deletes only an uncommitted image owned by the current user", async () => {
    const response = await deleteProductImage(
      new Request(
        "https://luma.test/api/mobile/products/images?path=user-1%2Funcommitted.jpg",
        { method: "DELETE" },
      ),
    );

    expect(response.status).toBe(200);
    expect(removals).toEqual([["user-1/uncommitted.jpg"]]);
  });

  test("does not delete another user's image", async () => {
    const response = await deleteProductImage(
      new Request(
        "https://luma.test/api/mobile/products/images?path=user-2%2Fimage.jpg",
        { method: "DELETE" },
      ),
    );

    expect(response.status).toBe(403);
    expect(removals).toHaveLength(0);
  });
});
