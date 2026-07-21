import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  createSignedEInvoiceBridgeAdapter,
  getEInvoiceProviderReadiness,
  resetEInvoiceRetryBudgetForManualSubmission,
  resolveEInvoiceProviderAdapter,
  selectEInvoiceIssuanceProvider,
  type EInvoiceProviderRequest,
} from "../src/lib/einvoice/provider";

const request: EInvoiceProviderRequest = {
  requestId: "mobile-einvoice-order-1",
  orderId: "00000000-0000-0000-0000-000000000001",
  buyerName: "Công ty Luma",
  buyerTaxCode: "0312345678",
  buyerAddress: "Hồ Chí Minh",
  buyerEmail: "tax@luma.test",
  vatRate: 10,
  totalBeforeVat: 1_000_000,
  vatAmount: 100_000,
  total: 1_100_000,
  seller: {
    name: "LumaPOS",
    taxCode: "0311111111",
    address: "Hồ Chí Minh",
  },
  lines: [{
    name: "Sản phẩm thật",
    unit: "cái",
    quantity: 1,
    unitPrice: 1_100_000,
    lineTotal: 1_100_000,
    vatRate: 10,
  }],
};

function signature(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
}

describe("signed e-invoice bridge adapter", () => {
  test("issues only from a signed provider response and signs the exact request body", async () => {
    const secret = "bridge-secret-with-at-least-32-characters";
    const timestamp = "1784448000000";
    const responseBody = JSON.stringify({
      status: "issued",
      number: "00001234",
      serial: "1C26TTP",
      providerReference: "provider-1234",
      issuedAt: "2026-07-19T09:00:00.000Z",
    });
    let sentBody = "";
    let sentHeaders = new Headers();
    const adapter = createSignedEInvoiceBridgeAdapter(
      {
        provider: "VNPT",
        endpoint: "https://einvoice-bridge.example.com/v1/issue",
        apiKey: "server-only-key",
        hmacSecret: secret,
      },
      {
        now: () => new Date(Number(timestamp)),
        fetch: async (_input, init) => {
          sentBody = init?.body?.toString() ?? "";
          sentHeaders = new Headers(init?.headers);
          return new Response(responseBody, {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-luma-timestamp": timestamp,
              "x-luma-signature": signature(secret, timestamp, responseBody),
            },
          });
        },
      },
    );

    const result = await adapter.issue(request);

    expect(result).toEqual({
      outcome: "issued",
      number: "00001234",
      serial: "1C26TTP",
      providerReference: "provider-1234",
      issuedAt: new Date("2026-07-19T09:00:00.000Z"),
    });
    expect(sentHeaders.get("authorization")).toBe("Bearer server-only-key");
    expect(sentHeaders.get("x-luma-request-id")).toBe(request.requestId);
    expect(sentHeaders.get("x-luma-signature")).toBe(
      signature(secret, timestamp, sentBody),
    );
    expect(JSON.parse(sentBody)).toEqual({
      version: "1",
      provider: "VNPT",
      invoice: request,
    });
  });

  test("never issues from a forged or stale bridge response", async () => {
    const now = new Date("2026-07-19T09:10:00.000Z");
    const staleTimestamp = String(
      new Date("2026-07-19T09:00:00.000Z").getTime(),
    );
    const responseBody = JSON.stringify({
      status: "issued",
      number: "00009999",
      serial: "1C26TTP",
      issuedAt: "2026-07-19T09:00:00.000Z",
    });
    const adapter = createSignedEInvoiceBridgeAdapter(
      {
        provider: "VNPT",
        endpoint: "https://einvoice-bridge.example.com/v1/issue",
        apiKey: "server-only-key",
        hmacSecret: "bridge-secret-with-at-least-32-characters",
      },
      {
        now: () => now,
        fetch: async () => new Response(responseBody, {
          status: 200,
          headers: {
            "x-luma-timestamp": staleTimestamp,
            "x-luma-signature": "0".repeat(64),
          },
        }),
      },
    );

    await expect(adapter.issue(request)).resolves.toEqual({
      outcome: "retryable_error",
      error: "einvoice.errors.invalidProviderResponse",
    });
  });

  test("resolves only an exact provider with complete HTTPS bridge config", () => {
    const configured = {
      EINVOICE_BRIDGE_PROVIDER: "VNPT",
      EINVOICE_BRIDGE_URL: "https://einvoice-bridge.example.com/v1/issue",
      EINVOICE_BRIDGE_API_KEY: "server-only-key",
      EINVOICE_BRIDGE_HMAC_SECRET:
        "bridge-secret-with-at-least-32-characters",
    };

    expect(resolveEInvoiceProviderAdapter("VNPT", configured)?.id).toBe(
      "signed-bridge:VNPT",
    );
    expect(resolveEInvoiceProviderAdapter("MISA", configured)).toBeNull();
    expect(resolveEInvoiceProviderAdapter("VNPT", {
      ...configured,
      EINVOICE_BRIDGE_URL: "http://127.0.0.1:3000/issue",
    })).toBeNull();
    expect(resolveEInvoiceProviderAdapter("VNPT", {
      ...configured,
      EINVOICE_BRIDGE_HMAC_SECRET: "too-short",
    })).toBeNull();
  });

  test("keeps a signed asynchronous provider acceptance queued", async () => {
    const secret = "bridge-secret-with-at-least-32-characters";
    const timestamp = String(new Date("2026-07-19T09:00:00.000Z").getTime());
    const responseBody = JSON.stringify({
      status: "pending",
      providerReference: "async-job-123",
    });
    const adapter = createSignedEInvoiceBridgeAdapter(
      {
        provider: "Viettel-S",
        endpoint: "https://einvoice-bridge.example.com/v1/issue",
        apiKey: "server-only-key",
        hmacSecret: secret,
      },
      {
        now: () => new Date(Number(timestamp)),
        fetch: async () => new Response(responseBody, {
          status: 202,
          headers: {
            "x-luma-timestamp": timestamp,
            "x-luma-signature": signature(secret, timestamp, responseBody),
          },
        }),
      },
    );

    await expect(adapter.issue(request)).resolves.toEqual({
      outcome: "retryable_error",
      error: "einvoice.errors.providerPending",
    });
  });

  test("stops retrying a signed permanent provider rejection", async () => {
    const secret = "bridge-secret-with-at-least-32-characters";
    const timestamp = String(new Date("2026-07-19T09:00:00.000Z").getTime());
    const responseBody = JSON.stringify({
      status: "rejected",
      errorCode: "BUYER_TAX_CODE_INVALID",
    });
    const adapter = createSignedEInvoiceBridgeAdapter(
      {
        provider: "MISA",
        endpoint: "https://einvoice-bridge.example.com/v1/issue",
        apiKey: "server-only-key",
        hmacSecret: secret,
      },
      {
        now: () => new Date(Number(timestamp)),
        fetch: async () => new Response(responseBody, {
          status: 200,
          headers: {
            "x-luma-timestamp": timestamp,
            "x-luma-signature": signature(secret, timestamp, responseBody),
          },
        }),
      },
    );

    await expect(adapter.issue(request)).resolves.toEqual({
      outcome: "permanent_error",
      error: "einvoice.errors.providerRejected",
    });
  });

  test("aborts a hung bridge call and schedules a retry", async () => {
    const adapter = createSignedEInvoiceBridgeAdapter(
      {
        provider: "VNPT",
        endpoint: "https://einvoice-bridge.example.com/v1/issue",
        apiKey: "server-only-key",
        hmacSecret: "bridge-secret-with-at-least-32-characters",
        timeoutMs: 5,
      },
      {
        fetch: async (_input, init) => {
          if (!(init?.signal instanceof AbortSignal)) {
            throw new Error("request was not abortable");
          }
          return await new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("Timed out", "AbortError"));
            });
          });
        },
      },
    );

    await expect(adapter.issue(request)).resolves.toEqual({
      outcome: "retryable_error",
      error: "einvoice.errors.providerTimeout",
    });
  });

  test("keeps the timeout active while reading the response body", async () => {
    const adapter = createSignedEInvoiceBridgeAdapter(
      {
        provider: "VNPT",
        endpoint: "https://einvoice-bridge.example.com/v1/issue",
        apiKey: "server-only-key",
        hmacSecret: "bridge-secret-with-at-least-32-characters",
        timeoutMs: 5,
      },
      {
        fetch: async (_input, init) => new Response(new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("Timed out", "AbortError"));
            });
          },
        }), { status: 200 }),
      },
    );

    await expect(adapter.issue(request)).resolves.toEqual({
      outcome: "retryable_error",
      error: "einvoice.errors.providerTimeout",
    });
  }, 200);

  test("server-owned settings disable issuance before provider resolution", () => {
    expect(selectEInvoiceIssuanceProvider({
      einvoiceEnabled: false,
      einvoiceProvider: "VNPT",
    })).toEqual({
      ok: false,
      error: "einvoice.errors.disabled",
    });
    expect(selectEInvoiceIssuanceProvider({
      einvoiceEnabled: true,
      einvoiceProvider: "  ",
    })).toEqual({
      ok: false,
      error: "einvoice.errors.providerNotConfigured",
    });
    expect(selectEInvoiceIssuanceProvider({
      einvoiceEnabled: true,
      einvoiceProvider: "VNPT",
    })).toEqual({ ok: true, provider: "VNPT" });
  });

  test("exposes safe provider readiness without leaking bridge secrets", () => {
    const environment = {
      EINVOICE_BRIDGE_PROVIDER: "VNPT",
      EINVOICE_BRIDGE_URL: "https://einvoice-bridge.example.com/v1/issue",
      EINVOICE_BRIDGE_API_KEY: "server-only-key",
      EINVOICE_BRIDGE_HMAC_SECRET:
        "bridge-secret-with-at-least-32-characters",
    };

    expect(getEInvoiceProviderReadiness({
      einvoiceEnabled: true,
      einvoiceProvider: "VNPT",
    }, environment)).toEqual({
      enabled: true,
      provider: "VNPT",
      configured: true,
      available: true,
      reason: null,
    });
    expect(getEInvoiceProviderReadiness({
      einvoiceEnabled: true,
      einvoiceProvider: "MISA",
    }, environment)).toEqual({
      enabled: true,
      provider: "MISA",
      configured: false,
      available: false,
      reason: "providerNotConfigured",
    });
    expect(getEInvoiceProviderReadiness({
      einvoiceEnabled: false,
      einvoiceProvider: "VNPT",
    }, environment)).toEqual({
      enabled: false,
      provider: "VNPT",
      configured: true,
      available: false,
      reason: "disabled",
    });
  });

  test("manual retry starts a fresh bounded retry budget after exhaustion", () => {
    expect(resetEInvoiceRetryBudgetForManualSubmission({
      status: "error",
      attemptCount: 8,
    })).toEqual({
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
    });
  });
});
