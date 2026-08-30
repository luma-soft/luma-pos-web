import { describe, expect, test } from "bun:test";

import {
  ManagedMediaUploadError,
  resumeManagedMediaCompletion,
  uploadManagedMedia,
  type ManagedMediaDescriptor,
  type ManagedMediaUploadRequest,
} from "../src/lib/media/client";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";
const SIGNED_URL = "https://r2.test/signed?X-Amz-Signature=do-not-log";
const FILE = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], "camera.png", {
  type: "image/png",
});
const REQUEST = {
  purpose: "product-image" as const,
  targetId: STORE_ID,
};
const NOW = new Date("2026-08-30T03:00:00.000Z");

function intentPayload(
  overrides: Record<string, unknown> = {},
  mediaOverrides: Record<string, unknown> = {},
) {
  return {
    ok: true,
    data: {
      media: {
        id: MEDIA_ID,
        visibility: "public",
        status: "pending",
        mimeType: "image/png",
        sizeBytes: 4,
        fileName: "camera.png",
        ...mediaOverrides,
      },
      method: "PUT",
      uploadUrl: SIGNED_URL,
      headers: {
        "Content-Type": "image/png",
        "If-None-Match": "*",
      },
      expiresAt: "2026-08-30T03:10:00.000Z",
      ...overrides,
    },
  };
}

function uploadAtFixedTime(
  fetcher: typeof fetch,
  request: ManagedMediaUploadRequest = REQUEST,
  file: File = FILE,
) {
  return uploadManagedMedia(
    file,
    request,
    fetcher,
    () => new Date(NOW.getTime()),
  );
}

function descriptorPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      id: MEDIA_ID,
      visibility: "public",
      mimeType: "image/png",
      sizeBytes: 4,
      fileName: "camera.png",
      url: "https://media.lumapos.vn/stores/store/products/media/original.png",
      thumbnailUrl: null,
      ...overrides,
    },
  };
}

function responseJson(value: unknown, init?: ResponseInit) {
  return Response.json(value, init);
}

function asUploadError(error: unknown): ManagedMediaUploadError {
  expect(error).toBeInstanceOf(ManagedMediaUploadError);
  return error as ManagedMediaUploadError;
}

describe("web managed media upload client", () => {
  test("performs intent, signed PUT, then completion with the Task 3 wire contract", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = input.toString();
      calls.push({ url, init });
      if (url === "/api/mobile/media/uploads") {
        return responseJson(intentPayload());
      }
      if (url === SIGNED_URL) {
        return new Response(null, { status: 204 });
      }
      if (url === `/api/mobile/media/uploads/${MEDIA_ID}/complete`) {
        return responseJson(descriptorPayload());
      }
      throw new Error("unexpected URL");
    };

    const result = await uploadAtFixedTime(fetcher);

    expect(calls.map(({ url, init }) => `${init?.method ?? "GET"} ${url}`)).toEqual([
      "POST /api/mobile/media/uploads",
      `PUT ${SIGNED_URL}`,
      `POST /api/mobile/media/uploads/${MEDIA_ID}/complete`,
    ]);
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      purpose: "product-image",
      targetId: STORE_ID,
      fileName: "camera.png",
      mimeType: "image/png",
      sizeBytes: 4,
    });
    expect(JSON.parse(calls[2].init?.body as string)).toEqual({});
    expect(result).toEqual<ManagedMediaDescriptor>({
      id: MEDIA_ID,
      visibility: "public",
      mimeType: "image/png",
      sizeBytes: 4,
      fileName: "camera.png",
      url: "https://media.lumapos.vn/stores/store/products/media/original.png",
      thumbnailUrl: null,
    });
  });

  test("uses only the intent-returned upload headers and explicitly omits credentials", async () => {
    let signedPut: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      const url = input.toString();
      if (url === "/api/mobile/media/uploads") return responseJson(intentPayload());
      if (url === SIGNED_URL) {
        signedPut = init;
        return new Response(null, { status: 200 });
      }
      return responseJson(descriptorPayload());
    };

    await uploadAtFixedTime(fetcher);

    const headers = new Headers(signedPut?.headers);
    expect(headers.get("Content-Type")).toBe("image/png");
    expect(headers.get("If-None-Match")).toBe("*");
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Cookie")).toBeNull();
    expect(headers.get("X-Luma-Cashier-Context")).toBeNull();
    expect(headers.get("X-Luma-Store")).toBeNull();
    expect([...headers.keys()].sort()).toEqual(["content-type", "if-none-match"]);
    expect(signedPut?.credentials).toBe("omit");
    expect(signedPut?.body).toBe(FILE);
  });

  test("rejects forbidden intent upload headers before contacting the signed host", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = input.toString();
      calls.push(url);
      return responseJson(intentPayload({
        headers: {
          "Content-Type": "image/png",
          "If-None-Match": "*",
          Authorization: "Bearer do-not-forward",
          Cookie: "session=do-not-forward",
        },
      }));
    };

    const error = asUploadError(
      await uploadAtFixedTime(fetcher).catch((caught) => caught),
    );

    expect(error).toMatchObject({
      stage: "intent",
      code: "media.invalidIntentResponse",
      retryFrom: "intent",
      mediaId: MEDIA_ID,
    });
    expect(calls).toEqual(["/api/mobile/media/uploads"]);
    expect(error.message).not.toContain("do-not-forward");
  });

  test("reports intent HTTP failures without leaking response bodies", async () => {
    const error = asUploadError(
      await uploadAtFixedTime(async () => responseJson({
        ok: false,
        error: "secret-backend-detail",
        signedUrl: SIGNED_URL,
      }, { status: 503 })).catch((caught) => caught),
    );

    expect(error).toMatchObject({
      stage: "intent",
      code: "media.intentFailed",
      statusCode: 503,
      retryFrom: "intent",
      mediaId: undefined,
    });
    expect(error.message).not.toContain("secret-backend-detail");
    expect(error.message).not.toContain("X-Amz-Signature");
  });

  test("rejects malformed intent payloads without issuing a PUT", async () => {
    let calls = 0;
    const error = asUploadError(
      await uploadAtFixedTime(async () => {
        calls += 1;
        return responseJson(intentPayload({ method: "POST" }));
      }).catch((caught) => caught),
    );

    expect(error).toMatchObject({
      stage: "intent",
      code: "media.invalidIntentResponse",
      retryFrom: "intent",
      mediaId: MEDIA_ID,
    });
    expect(calls).toBe(1);
  });

  const invalidIntentScenarios: Array<{
    name: string;
    payload: unknown;
    request?: ManagedMediaUploadRequest;
    retainedMediaId?: string;
  }> = [
    {
      name: "non-UUID media id",
      payload: intentPayload({}, { id: "not-a-uuid" }),
    },
    {
      name: "UUID shape outside the Task 3 schema",
      payload: intentPayload({}, {
        id: "44444444-4444-0444-8444-444444444444",
      }),
    },
    {
      name: "non-pending media coordinate",
      payload: intentPayload({}, { status: "complete" }),
    },
    {
      name: "MIME unrelated to the draft",
      payload: intentPayload({
        headers: {
          "Content-Type": "application/pdf",
          "If-None-Match": "*",
        },
      }, { mimeType: "application/pdf" }),
      retainedMediaId: MEDIA_ID,
    },
    {
      name: "product-image private visibility",
      payload: intentPayload({}, { visibility: "private" }),
      retainedMediaId: MEDIA_ID,
    },
    {
      name: "project-document public visibility",
      payload: intentPayload({}, { visibility: "public" }),
      request: { ...REQUEST, purpose: "project-document" },
      retainedMediaId: MEDIA_ID,
    },
    {
      name: "service-evidence public visibility",
      payload: intentPayload({}, { visibility: "public" }),
      request: { ...REQUEST, purpose: "service-evidence" },
      retainedMediaId: MEDIA_ID,
    },
    {
      name: "ai-attachment public visibility",
      payload: intentPayload({}, { visibility: "public" }),
      request: { ...REQUEST, purpose: "ai-attachment" },
      retainedMediaId: MEDIA_ID,
    },
    {
      name: "expiry equal to the injected clock",
      payload: intentPayload({ expiresAt: NOW.toISOString() }),
      retainedMediaId: MEDIA_ID,
    },
    {
      name: "expired intent",
      payload: intentPayload({ expiresAt: "2026-08-30T02:59:59.999Z" }),
      retainedMediaId: MEDIA_ID,
    },
    {
      name: "parseable but non-ISO expiry",
      payload: intentPayload({ expiresAt: "2026-08-30 03:10:00Z" }),
      retainedMediaId: MEDIA_ID,
    },
    {
      name: "malformed signed URL after a valid pending coordinate",
      payload: intentPayload({ uploadUrl: "not-absolute" }),
      retainedMediaId: MEDIA_ID,
    },
  ];

  for (const scenario of invalidIntentScenarios) {
    test(`rejects ${scenario.name} before signed PUT`, async () => {
      const calls: string[] = [];
      const fetcher: typeof fetch = async (input) => {
        calls.push(input.toString());
        return responseJson(scenario.payload);
      };

      const error = asUploadError(
        await uploadAtFixedTime(
          fetcher,
          scenario.request ?? REQUEST,
        ).catch((caught) => caught),
      );

      expect(error).toMatchObject({
        stage: "intent",
        code: "media.invalidIntentResponse",
        retryFrom: "intent",
        mediaId: scenario.retainedMediaId,
      });
      expect(calls).toEqual(["/api/mobile/media/uploads"]);
      expect(error.message).not.toContain("not-absolute");
    });
  }

  test("retains the pending media id and skips completion after a non-2xx PUT", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = input.toString();
      calls.push(url);
      if (url === "/api/mobile/media/uploads") return responseJson(intentPayload());
      return new Response("provider diagnostic must stay private", { status: 412 });
    };

    const error = asUploadError(
      await uploadAtFixedTime(fetcher).catch((caught) => caught),
    );

    expect(error).toMatchObject({
      stage: "upload",
      code: "media.uploadFailed",
      statusCode: 412,
      mediaId: MEDIA_ID,
      retryFrom: "intent",
    });
    expect(calls).toEqual(["/api/mobile/media/uploads", SIGNED_URL]);
    expect(error.message).not.toContain("provider diagnostic");
    expect(error.message).not.toContain("X-Amz-Signature");
  });

  test("retains the pending media id after an ambiguous PUT network failure", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = input.toString();
      calls.push(url);
      if (url === "/api/mobile/media/uploads") return responseJson(intentPayload());
      throw new Error(`socket failed for ${SIGNED_URL}`);
    };

    const error = asUploadError(
      await uploadAtFixedTime(fetcher).catch((caught) => caught),
    );

    expect(error).toMatchObject({
      stage: "upload",
      code: "media.uploadNetworkFailed",
      statusCode: undefined,
      mediaId: MEDIA_ID,
      retryFrom: "intent",
    });
    expect(calls).toEqual(["/api/mobile/media/uploads", SIGNED_URL]);
    expect(error.message).not.toContain("X-Amz-Signature");
  });

  test("reports completion failure as idempotent-completion retry without duplicating it", async () => {
    let completeCalls = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = input.toString();
      if (url === "/api/mobile/media/uploads") return responseJson(intentPayload());
      if (url === SIGNED_URL) return new Response(null, { status: 200 });
      completeCalls += 1;
      return responseJson({ ok: false, error: "media.uploadIncomplete" }, { status: 409 });
    };

    const error = asUploadError(
      await uploadAtFixedTime(fetcher).catch((caught) => caught),
    );

    expect(error).toMatchObject({
      stage: "complete",
      code: "media.completionFailed",
      statusCode: 409,
      mediaId: MEDIA_ID,
      retryFrom: "complete",
    });
    expect(completeCalls).toBe(1);
  });

  test("resumes completion without another intent or signed PUT", async () => {
    const calls: string[] = [];
    let failCompletion = true;
    const fetcher: typeof fetch = async (input) => {
      const url = input.toString();
      calls.push(url);
      if (url === "/api/mobile/media/uploads") return responseJson(intentPayload());
      if (url === SIGNED_URL) return new Response(null, { status: 200 });
      if (failCompletion) {
        return responseJson({ ok: false }, { status: 502 });
      }
      return responseJson(descriptorPayload());
    };

    const first = asUploadError(
      await uploadAtFixedTime(fetcher).catch((caught) => caught),
    );
    failCompletion = false;
    const completed = await resumeManagedMediaCompletion(
      FILE,
      REQUEST,
      first.mediaId!,
      fetcher,
    );

    expect(completed.id).toBe(MEDIA_ID);
    expect(calls).toEqual([
      "/api/mobile/media/uploads",
      SIGNED_URL,
      `/api/mobile/media/uploads/${MEDIA_ID}/complete`,
      `/api/mobile/media/uploads/${MEDIA_ID}/complete`,
    ]);
  });

  test("rejects malformed completion descriptors and retains completion retry coordinates", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = input.toString();
      if (url === "/api/mobile/media/uploads") return responseJson(intentPayload());
      if (url === SIGNED_URL) return new Response(null, { status: 200 });
      return responseJson(descriptorPayload({ id: "wrong-media-id" }));
    };

    const error = asUploadError(
      await uploadAtFixedTime(fetcher).catch((caught) => caught),
    );

    expect(error).toMatchObject({
      stage: "complete",
      code: "media.invalidCompletionResponse",
      mediaId: MEDIA_ID,
      retryFrom: "complete",
    });
  });

  for (const stage of ["intent", "upload", "complete"] as const) {
    test(`propagates one abort signal through the ${stage} stage`, async () => {
      const controller = new AbortController();
      const calls: string[] = [];
      const fetcher: typeof fetch = async (input, init) => {
        const url = input.toString();
        calls.push(url);
        expect(init?.signal).toBe(controller.signal);
        const currentStage = url === "/api/mobile/media/uploads"
          ? "intent"
          : url === SIGNED_URL
            ? "upload"
            : "complete";
        if (currentStage === stage) {
          controller.abort();
          throw new DOMException("request aborted", "AbortError");
        }
        if (currentStage === "intent") return responseJson(intentPayload());
        if (currentStage === "upload") return new Response(null, { status: 200 });
        return responseJson(descriptorPayload());
      };

      const error = asUploadError(
        await uploadAtFixedTime(
          fetcher,
          { ...REQUEST, signal: controller.signal },
        ).catch((caught) => caught),
      );

      expect(error).toMatchObject({
        stage,
        code: "media.uploadCancelled",
        cancelled: true,
        mediaId: stage === "intent" ? undefined : MEDIA_ID,
        retryFrom: stage === "complete" ? "complete" : "intent",
      });
      expect(calls).toHaveLength(stage === "intent" ? 1 : stage === "upload" ? 2 : 3);
    });
  }
});
