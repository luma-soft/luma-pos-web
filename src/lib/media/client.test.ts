import { expect, test } from "bun:test";

import { uploadManagedMedia } from "./client";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";
const SIGNED_URL = "https://r2.test/signed";
const NOW = new Date("2026-09-24T03:00:00.000Z");
const FILE = new File(
  [Uint8Array.from([0x89, 0x50, 0x4e, 0x47])],
  "camera.png",
  { type: "image/png" },
);

test("retries a transient signed PUT before completing product media", async () => {
  let signedPutAttempts = 0;
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = input.toString();
    calls.push(url);
    if (url === "/api/mobile/media/uploads") {
      return Response.json({
        ok: true,
        data: {
          media: {
            id: MEDIA_ID,
            visibility: "public",
            status: "pending",
            mimeType: "image/png",
            sizeBytes: FILE.size,
            fileName: FILE.name,
          },
          method: "PUT",
          uploadUrl: SIGNED_URL,
          headers: {
            "Content-Type": "image/png",
            "If-None-Match": "*",
          },
          expiresAt: "2026-09-24T03:10:00.000Z",
        },
      });
    }
    if (url === SIGNED_URL) {
      signedPutAttempts += 1;
      return signedPutAttempts === 1
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 204 });
    }
    if (url === `/api/mobile/media/uploads/${MEDIA_ID}/complete`) {
      return Response.json({
        ok: true,
        data: {
          id: MEDIA_ID,
          visibility: "public",
          mimeType: "image/png",
          sizeBytes: FILE.size,
          fileName: FILE.name,
          url: "https://media.lumapos.shop/stores/example/products/image.png",
          thumbnailUrl: null,
        },
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const result = await uploadManagedMedia(
    FILE,
    { purpose: "product-image", targetId: STORE_ID },
    fetcher,
    () => new Date(NOW.getTime()),
  );

  expect(signedPutAttempts).toBe(2);
  expect(calls).toEqual([
    "/api/mobile/media/uploads",
    SIGNED_URL,
    SIGNED_URL,
    `/api/mobile/media/uploads/${MEDIA_ID}/complete`,
  ]);
  expect(result.id).toBe(MEDIA_ID);
});
