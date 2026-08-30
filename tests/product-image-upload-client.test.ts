import { describe, expect, test } from "bun:test";
import {
  deleteLegacyProductImageUrl,
  deleteUploadedProductImage,
  managedImageToDeleteImmediately,
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_MAX_BYTES,
  ProductImageUploadError,
  uploadProductImageFile,
  uploadProductImageFiles,
  type UploadedProductImage,
} from "../src/lib/images/product-image-upload";
import { ManagedMediaUploadError } from "../src/lib/media/client";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const PUBLIC_PATH =
  `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.png`;
const PUBLIC_BASE_URL = "https://media.staging.lumapos.test";
const PUBLIC_URL = `${PUBLIC_BASE_URL}/${PUBLIC_PATH}`;

function png(name = "Hải Đăng.png") {
  return new File(
    [Uint8Array.from([0x89, 0x50, 0x4e, 0x47])],
    name,
    { type: "image/png" },
  );
}

describe("web product image upload", () => {
  test("uses the managed product-image flow and returns immutable first-party coordinates", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const uploaded = await uploadProductImageFile(
      png(),
      STORE_ID,
      async (input, init) => {
        const url = input.toString();
        requests.push({ url, init });
        if (url === "/api/mobile/media/uploads") {
          return Response.json({
            ok: true,
            data: {
              media: {
                id: MEDIA_ID,
                visibility: "public",
                status: "pending",
                mimeType: "image/png",
                sizeBytes: 4,
                fileName: "Hải Đăng.png",
              },
              method: "PUT",
              uploadUrl: "https://r2.test/upload",
              headers: {
                "Content-Type": "image/png",
                "If-None-Match": "*",
              },
              expiresAt: "2026-08-30T04:00:00.000Z",
            },
          });
        }
        if (url === "https://r2.test/upload") return new Response(null, { status: 200 });
        return Response.json({
          ok: true,
          data: {
            id: MEDIA_ID,
            visibility: "public",
            mimeType: "image/png",
            sizeBytes: 4,
            fileName: "Hải Đăng.png",
            url: PUBLIC_URL,
            thumbnailUrl: null,
          },
        });
      },
      () => new Date("2026-08-30T03:00:00.000Z"),
      PUBLIC_BASE_URL,
    );

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ["/api/mobile/media/uploads", "POST"],
      ["https://r2.test/upload", "PUT"],
      [`/api/mobile/media/uploads/${MEDIA_ID}/complete`, "POST"],
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      purpose: "product-image",
      targetId: STORE_ID,
      fileName: "Hải Đăng.png",
      mimeType: "image/png",
      sizeBytes: 4,
    });
    expect(uploaded).toEqual({
      mediaId: MEDIA_ID,
      url: PUBLIC_URL,
      path: PUBLIC_PATH,
    });
  });

  test("keeps completed media IDs and retries only the remaining drafts", async () => {
    const completed: UploadedProductImage = {
      mediaId: MEDIA_ID,
      url: PUBLIC_URL,
      path: PUBLIC_PATH,
    };
    const calls: string[] = [];
    const drafts = [png("first.png"), png("second.png"), png("third.png")];
    const first = await uploadProductImageFiles({
      completed: [],
      drafts,
      targetId: STORE_ID,
      upload: async (file) => {
        calls.push(file.name);
        if (file.name === "second.png") throw new ProductImageUploadError("errors.network");
        return completed;
      },
    });

    expect(first.completed).toEqual([completed]);
    expect(first.remaining.map((draft) => draft.file.name)).toEqual([
      "second.png",
      "third.png",
    ]);
    expect(first.error).toBe("errors.network");

    const retried = await uploadProductImageFiles({
      completed: first.completed,
      drafts: first.remaining,
      targetId: STORE_ID,
      upload: async (file) => {
        calls.push(file.name);
        return { ...completed, mediaId: file.name };
      },
    });
    expect(calls).toEqual(["first.png", "second.png", "second.png", "third.png"]);
    expect(retried.completed.map((image) => image.mediaId)).toEqual([
      MEDIA_ID,
      "second.png",
      "third.png",
    ]);
    expect(retried.remaining).toEqual([]);
  });

  test("retains completion coordinates and retries without a new file PUT", async () => {
    const file = png("completion.png");
    const completionCalls: Array<string | undefined> = [];
    const first = await uploadProductImageFiles({
      completed: [],
      drafts: [file],
      targetId: STORE_ID,
      upload: async (_file, _targetId, completionMediaId) => {
        completionCalls.push(completionMediaId);
        throw new ManagedMediaUploadError({
          stage: "complete",
          code: "media.completionFailed",
          statusCode: 502,
          mediaId: MEDIA_ID,
          retryFrom: "complete",
        });
      },
    });

    expect(first.remaining).toEqual([{
      file,
      completionMediaId: MEDIA_ID,
    }]);
    const retried = await uploadProductImageFiles({
      completed: first.completed,
      drafts: first.remaining,
      targetId: STORE_ID,
      upload: async (_file, _targetId, completionMediaId) => {
        completionCalls.push(completionMediaId);
        return { mediaId: MEDIA_ID, url: PUBLIC_URL, path: PUBLIC_PATH };
      },
    });

    expect(completionCalls).toEqual([undefined, MEDIA_ID]);
    expect(retried.completed).toHaveLength(1);
    expect(retried.remaining).toEqual([]);
  });

  test("the real product wrapper preserves Task 4 completion retry state", async () => {
    const file = png("completion-wrapper.png");
    const fetcher: typeof fetch = async (input) => {
      const url = input.toString();
      if (url === "/api/mobile/media/uploads") {
        return Response.json({
          ok: true,
          data: {
            media: {
              id: MEDIA_ID,
              visibility: "public",
              status: "pending",
              mimeType: "image/png",
              sizeBytes: file.size,
              fileName: file.name,
            },
            method: "PUT",
            uploadUrl: "https://r2.test/upload",
            headers: {
              "Content-Type": "image/png",
              "If-None-Match": "*",
            },
            expiresAt: "2026-08-30T04:00:00.000Z",
          },
        });
      }
      if (url === "https://r2.test/upload") {
        return new Response(null, { status: 200 });
      }
      return Response.json({ ok: false }, { status: 502 });
    };

    const result = await uploadProductImageFiles({
      completed: [],
      drafts: [file],
      targetId: STORE_ID,
      upload: (draft, targetId) => uploadProductImageFile(
        draft,
        targetId,
        fetcher,
        () => new Date("2026-08-30T03:00:00.000Z"),
        PUBLIC_BASE_URL,
      ),
    });

    expect(result.remaining).toEqual([{
      file,
      completionMediaId: MEDIA_ID,
    }]);
  });

  test("rejects oversized and unsupported files before making a request", async () => {
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests += 1;
      return Response.json({ ok: true });
    };

    await expect(
      uploadProductImageFile(
        new File([new Uint8Array(PRODUCT_IMAGE_MAX_BYTES + 1)], "large.png", {
          type: "image/png",
        }),
        STORE_ID,
        fetcher,
      ),
    ).rejects.toBeInstanceOf(ProductImageUploadError);
    await expect(
      uploadProductImageFile(
        new File(["<svg />"], "unsafe.svg", { type: "image/svg+xml" }),
        STORE_ID,
        fetcher,
      ),
    ).rejects.toBeInstanceOf(ProductImageUploadError);
    expect(requests).toBe(0);
  });

  test("rejects a completion URL outside the immutable public media origin", async () => {
    await expect(uploadProductImageFile(
      png(),
      STORE_ID,
      async (input) => {
        const url = input.toString();
        if (url === "/api/mobile/media/uploads") {
          return Response.json({
            ok: true,
            data: {
              media: {
                id: MEDIA_ID,
                visibility: "public",
                status: "pending",
                mimeType: "image/png",
                sizeBytes: 4,
                fileName: "Hải Đăng.png",
              },
              method: "PUT",
              uploadUrl: "https://r2.test/upload",
              headers: {
                "Content-Type": "image/png",
                "If-None-Match": "*",
              },
              expiresAt: "2026-08-30T04:00:00.000Z",
            },
          });
        }
        if (url === "https://r2.test/upload") {
          return new Response(null, { status: 200 });
        }
        return Response.json({
          ok: true,
          data: {
            id: MEDIA_ID,
            visibility: "public",
            mimeType: "image/png",
            sizeBytes: 4,
            fileName: "Hải Đăng.png",
            url: `https://attacker.test/${PUBLIC_PATH}`,
            thumbnailUrl: null,
          },
        });
      },
      () => new Date("2026-08-30T03:00:00.000Z"),
      PUBLIC_BASE_URL,
    )).rejects.toBeInstanceOf(ProductImageUploadError);
  });

  test("keeps the picker aligned with the server formats", () => {
    expect(PRODUCT_IMAGE_ACCEPT).toBe(
      "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif",
    );
  });

  test("uses the managed multipart bridge for HEIF conversion", async () => {
    const jpegPath =
      `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.jpg`;
    const uploaded = await uploadProductImageFile(
      new File(
        [Uint8Array.from([
          0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
          0x68, 0x65, 0x69, 0x63,
        ])],
        "camera.heic",
        { type: "image/heic" },
      ),
      STORE_ID,
      async (input, init) => {
        expect(input.toString()).toBe("/api/inventory/products/images");
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeInstanceOf(FormData);
        return Response.json({
          ok: true,
          data: {
            mediaId: MEDIA_ID,
            path: jpegPath,
            url: `${PUBLIC_BASE_URL}/${jpegPath}`,
          },
        });
      },
      () => new Date("2026-08-30T03:00:00.000Z"),
      PUBLIC_BASE_URL,
    );

    expect(uploaded).toEqual({
      mediaId: MEDIA_ID,
      path: jpegPath,
      url: `${PUBLIC_BASE_URL}/${jpegPath}`,
    });
  });

  test("deletes managed media by opaque ID and retains the path as a consistency coordinate", async () => {
    const requests: Array<{ url: string; method?: string }> = [];
    await deleteUploadedProductImage(
      { mediaId: MEDIA_ID, path: PUBLIC_PATH },
      async (input, init) => {
        requests.push({ url: input.toString(), method: init?.method });
        return Response.json({ ok: true });
      },
    );

    const request = new URL(requests[0]!.url, "https://app.lumapos.vn");
    expect(requests[0]!.method).toBe("DELETE");
    expect(request.pathname).toBe("/api/inventory/products/images");
    expect(request.searchParams.get("mediaId")).toBe(MEDIA_ID);
    expect(request.searchParams.get("path")).toBe(PUBLIC_PATH);
  });

  test("deletes only recognizable legacy Supabase product URLs by extracted path", async () => {
    const legacyPath =
      `stores/${STORE_ID}/products/drafts/user-1/old-image.png`;
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(input.toString());
      return Response.json({ ok: true });
    };

    const legacyUrl =
      `https://project.supabase.co/storage/v1/object/public/products/${legacyPath}`;
    expect(await deleteLegacyProductImageUrl(
      legacyUrl,
      "https://project.supabase.co",
      fetcher,
    )).toBe(true);
    expect(await deleteLegacyProductImageUrl(
      PUBLIC_URL,
      "https://project.supabase.co",
      fetcher,
    )).toBe(false);
    expect(await deleteLegacyProductImageUrl(
      `https://attacker.test/storage/v1/object/public/products/${legacyPath}`,
      "https://project.supabase.co",
      fetcher,
    )).toBe(false);

    const request = new URL(requests[0]!, "https://app.lumapos.vn");
    expect(requests).toHaveLength(1);
    expect(request.searchParams.get("path")).toBe(legacyPath);
    expect(request.searchParams.get("url")).toBe(legacyUrl);
    expect(request.searchParams.has("mediaId")).toBe(false);
  });

  test("persisted legacy removal stays local on cancel or save failure", () => {
    const legacyUrl =
      `https://project.supabase.co/storage/v1/object/public/products/${STORE_ID}/persisted.jpg`;
    expect(managedImageToDeleteImmediately({
      url: legacyUrl,
      managedImages: [],
      initialMediaIds: new Set(),
    })).toBeNull();
  });
});
