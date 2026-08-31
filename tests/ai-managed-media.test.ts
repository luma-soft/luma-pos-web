import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: {} }));
mock.module("@/lib/audit", () => ({ writeAuditLog: async () => {} }));

import type { MobileGate } from "../src/lib/mobile/auth";

const { createAiAttachmentHandlers } = await import(
  "../src/app/api/mobile/ai/attachments/route"
);
const { readAiAttachmentBytes } = await import("../src/lib/ai/attachments");
const { resolveAiAttachmentUrl, uploadAiAttachment } = await import(
  "../src/components/ai-assistant/api"
);

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";

const gate: Extract<MobileGate, { ok: true }> = {
  ok: true,
  storeId: STORE_ID,
  userId: USER_ID,
  role: "cashier",
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
};

function pngFile() {
  return new File([
    Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 0,
    ]),
  ], "hóa-đơn.png", { type: "image/png" });
}

describe("AI managed-media attachment route", () => {
  test("uploads a new attachment to private R2 bound to the owned chat session", async () => {
    const uploads: unknown[] = [];
    const handlers = createAiAttachmentHandlers({
      authenticate: async () => gate,
      requireProvider: async () => null,
      privateBucket: "lumapos-test-private-media",
      mediaService: {
        async putManagedObject(actor, input, bytes) {
          uploads.push({ actor, input, bytes: Array.from(bytes) });
          return {
            mediaId: MEDIA_ID,
            path: `stores/${STORE_ID}/ai/2026/08/${MEDIA_ID}/original.png`,
            url: "https://r2.test/private?X-Amz-Signature=managed",
          };
        },
        async resolveMedia() {
          throw new Error("not used");
        },
      },
      getLegacyBucket: async () => "ai-attachments",
      signLegacy: async () => "https://legacy.test/signed",
    });
    const form = new FormData();
    form.set("sessionId", SESSION_ID);
    form.set("surface", "mobile");
    form.set("file", pngFile());

    const response = await handlers.POST(new Request("https://luma.test/api/mobile/ai/attachments", {
      method: "POST",
      body: form,
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      id: MEDIA_ID,
      mediaId: MEDIA_ID,
      sessionId: SESSION_ID,
      bucket: "lumapos-test-private-media",
      path: `stores/${STORE_ID}/ai/2026/08/${MEDIA_ID}/original.png`,
      name: "hóa-đơn.png",
      mimeType: "image/png",
      size: 12,
      kind: "image",
      signedUrl: "https://r2.test/private?X-Amz-Signature=managed",
    });
    expect(uploads).toEqual([
      expect.objectContaining({
        actor: expect.objectContaining({ storeId: STORE_ID, userId: USER_ID, role: "cashier" }),
        input: {
          purpose: "ai-attachment",
          targetId: SESSION_ID,
          fileName: "hóa-đơn.png",
          mimeType: "image/png",
          sizeBytes: 12,
        },
      }),
    ]);
  });

  test("requires an explicit chat session before accepting bytes", async () => {
    let uploadCount = 0;
    const handlers = createAiAttachmentHandlers({
      authenticate: async () => gate,
      requireProvider: async () => null,
      privateBucket: "lumapos-test-private-media",
      mediaService: {
        async putManagedObject() {
          uploadCount += 1;
          throw new Error("must not upload");
        },
        async resolveMedia() {
          throw new Error("not used");
        },
      },
      getLegacyBucket: async () => "ai-attachments",
      signLegacy: async () => "https://legacy.test/signed",
    });
    const form = new FormData();
    form.set("file", pngFile());

    const response = await handlers.POST(new Request("https://luma.test/api/mobile/ai/attachments", {
      method: "POST",
      body: form,
    }));

    expect(response.status).toBe(400);
    expect(uploadCount).toBe(0);
  });

  test("resolves managed media by mediaId and keeps bucket/path only for legacy reads", async () => {
    const resolved: unknown[] = [];
    const legacy: unknown[] = [];
    const handlers = createAiAttachmentHandlers({
      authenticate: async () => gate,
      requireProvider: async () => null,
      privateBucket: "lumapos-test-private-media",
      mediaService: {
        async putManagedObject() {
          throw new Error("not used");
        },
        async resolveMedia(actor, mediaId) {
          resolved.push({ actor, mediaId });
          return {
            id: MEDIA_ID,
            visibility: "private" as const,
            mimeType: "image/png",
            sizeBytes: 12,
            fileName: "hóa-đơn.png",
            url: "https://r2.test/private?X-Amz-Signature=fresh",
            thumbnailUrl: null,
          };
        },
      },
      getLegacyBucket: async () => "ai-attachments",
      signLegacy: async (bucket, path) => {
        legacy.push({ bucket, path });
        return "https://supabase.test/storage/signed";
      },
    });

    const managedResponse = await handlers.GET(new Request(
      `https://luma.test/api/mobile/ai/attachments?mediaId=${MEDIA_ID}`,
    ));
    expect(managedResponse.status).toBe(200);
    expect((await managedResponse.json()).data).toEqual({
      mediaId: MEDIA_ID,
      signedUrl: "https://r2.test/private?X-Amz-Signature=fresh",
    });
    expect(resolved).toHaveLength(1);
    expect(legacy).toEqual([]);

    const legacyPath = `stores/${STORE_ID}/users/${USER_ID}/legacy.png`;
    const legacyResponse = await handlers.GET(new Request(
      `https://luma.test/api/mobile/ai/attachments?bucket=ai-attachments&path=${encodeURIComponent(legacyPath)}`,
    ));
    expect(legacyResponse.status).toBe(200);
    expect((await legacyResponse.json()).data.signedUrl).toContain("supabase.test");
    expect(legacy).toEqual([{ bucket: "ai-attachments", path: legacyPath }]);
  });
});

describe("AI attachment parsing storage compatibility", () => {
  test("reads mediaId attachments through the authorized media service", async () => {
    const calls: unknown[] = [];
    const bytes = Uint8Array.from([1, 3, 3, 7]);

    await expect(readAiAttachmentBytes({
      attachment: {
        mediaId: MEDIA_ID,
        bucket: "legacy-must-not-be-used",
        path: "legacy-must-not-be-used",
      },
      actor: gate,
      readManaged: async (actor, mediaId) => {
        calls.push({ actor, mediaId });
        return bytes;
      },
      downloadLegacy: async () => {
        throw new Error("legacy reader must not run");
      },
      getLegacyBucket: async () => "ai-attachments",
    })).resolves.toEqual(bytes);
    expect(calls).toEqual([{
      actor: gate,
      mediaId: MEDIA_ID,
    }]);
  });

  test("keeps legacy bucket/path downloads scoped to the authenticated owner prefix", async () => {
    const calls: unknown[] = [];
    const path = `stores/${STORE_ID}/users/${USER_ID}/legacy.csv`;

    await expect(readAiAttachmentBytes({
      attachment: { bucket: "ai-attachments", path },
      actor: gate,
      readManaged: async () => {
        throw new Error("managed reader must not run");
      },
      downloadLegacy: async (bucket, objectPath) => {
        calls.push({ bucket, path: objectPath });
        return Uint8Array.from([4, 2]);
      },
      getLegacyBucket: async () => "ai-attachments",
    })).resolves.toEqual(Uint8Array.from([4, 2]));
    expect(calls).toEqual([{ bucket: "ai-attachments", path }]);

    await expect(readAiAttachmentBytes({
      attachment: {
        bucket: "ai-attachments",
        path: `stores/${STORE_ID}/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/foreign.csv`,
      },
      actor: gate,
      readManaged: async () => Uint8Array.from([]),
      downloadLegacy: async () => Uint8Array.from([]),
      getLegacyBucket: async () => "ai-attachments",
    })).rejects.toThrow("ATTACHMENT_FORBIDDEN");
  });
});

describe("AI attachment web client contract", () => {
  test("includes the active chat session in multipart uploads", async () => {
    const originalFetch = globalThis.fetch;
    const calls: unknown[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      calls.push({
        input: input.toString(),
        method: init?.method,
        sessionId: form.get("sessionId"),
        surface: form.get("surface"),
      });
      return Response.json({
        ok: true,
        data: {
          id: MEDIA_ID,
          mediaId: MEDIA_ID,
          sessionId: SESSION_ID,
          name: "hóa-đơn.png",
          mimeType: "image/png",
          size: 12,
          kind: "image",
        },
      });
    }) as typeof fetch;
    try {
      const uploaded = await uploadAiAttachment(pngFile(), "web", SESSION_ID);
      expect(uploaded).toMatchObject({ mediaId: MEDIA_ID, sessionId: SESSION_ID });
      expect(calls).toEqual([{
        input: "/api/mobile/ai/attachments",
        method: "POST",
        sessionId: SESSION_ID,
        surface: "web",
      }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("refreshes managed preview URLs by mediaId before legacy bucket/path", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(input.toString());
      return Response.json({
        ok: true,
        data: { signedUrl: "https://r2.test/private?X-Amz-Signature=fresh" },
      });
    }) as typeof fetch;
    try {
      const resolved = await resolveAiAttachmentUrl({
        id: MEDIA_ID,
        mediaId: MEDIA_ID,
        sessionId: SESSION_ID,
        bucket: "lumapos-test-private-media",
        path: `stores/${STORE_ID}/ai/${MEDIA_ID}/original`,
        name: "hóa-đơn.png",
        mimeType: "image/png",
        size: 12,
        kind: "image",
        signedUrl: "https://r2.test/private?X-Amz-Signature=expired",
        status: "uploaded",
      });

      expect(resolved).toContain("X-Amz-Signature=fresh");
      expect(calls).toEqual([
        `/api/mobile/ai/attachments?mediaId=${MEDIA_ID}`,
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
