import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_MAX_BYTES,
  ProductImageUploadError,
  uploadProductImageFile,
} from "../src/lib/images/product-image-upload";

describe("web product image upload", () => {
  test("posts a selected PNG to the authenticated inventory upload API", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const file = new File(
      [Uint8Array.from([0x89, 0x50, 0x4e, 0x47])],
      "Hải Đăng.png",
      { type: "image/png" },
    );

    const uploaded = await uploadProductImageFile(
      file,
      async (input, init) => {
        requestUrl = input.toString();
        requestInit = init;
        return Response.json({
          ok: true,
          data: {
            url: "https://cdn.test/products/stores/store-1/image.png",
            path: "stores/store-1/products/drafts/user-1/image.png",
          },
        });
      },
    );

    expect(requestUrl).toBe("/api/inventory/products/images");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBeInstanceOf(FormData);
    const postedFile = (requestInit?.body as FormData).get("file");
    expect(postedFile).toBeInstanceOf(File);
    expect(postedFile).toMatchObject({
      name: "Hải Đăng.png",
      type: "image/png",
      size: 4,
    });
    expect(uploaded).toEqual({
      url: "https://cdn.test/products/stores/store-1/image.png",
      path: "stores/store-1/products/drafts/user-1/image.png",
    });
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
        fetcher,
      ),
    ).rejects.toBeInstanceOf(ProductImageUploadError);
    await expect(
      uploadProductImageFile(
        new File(["<svg />"], "unsafe.svg", { type: "image/svg+xml" }),
        fetcher,
      ),
    ).rejects.toBeInstanceOf(ProductImageUploadError);
    expect(requests).toBe(0);
  });

  test("keeps the picker and helper aligned with the server formats", () => {
    expect(PRODUCT_IMAGE_ACCEPT).toBe(
      "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif",
    );

    const source = readFileSync(
      new URL("../src/app/(app)/products/new/product-form.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("uploadProductImageFile(file)");
    expect(source).toContain("accept={PRODUCT_IMAGE_ACCEPT}");
    expect(source).not.toContain("supabase.storage");
  });
});
