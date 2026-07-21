import { describe, expect, test } from "bun:test";
import {
  executeEInvoiceAttempt,
  nextEInvoiceRetryAt,
  type EInvoiceProviderAdapter,
} from "../src/lib/einvoice/provider";

const request = {
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
  lines: [
    {
      name: "Sản phẩm thật",
      unit: "cái",
      quantity: 1,
      unitPrice: 1_100_000,
      lineTotal: 1_100_000,
      vatRate: 10,
    },
  ],
};

describe("e-invoice provider retry worker", () => {
  test("accepts only a provider-issued number as issued", async () => {
    const adapter: EInvoiceProviderAdapter = {
      id: "sandbox",
      issue: async () => ({
        outcome: "issued",
        number: "00001234",
        serial: "1C26TTP",
        providerReference: "provider-1234",
        issuedAt: new Date("2026-07-19T09:00:00.000Z"),
      }),
    };
    const result = await executeEInvoiceAttempt({
      adapter,
      request,
      attemptCount: 0,
      now: new Date("2026-07-19T09:00:00.000Z"),
    });

    expect(result.status).toBe("issued");
    expect(result.number).toBe("00001234");
    expect(result.nextAttemptAt).toBeNull();
  });

  test("queues retryable provider failures with bounded backoff", async () => {
    const adapter: EInvoiceProviderAdapter = {
      id: "sandbox",
      issue: async () => ({
        outcome: "retryable_error",
        error: "einvoice.errors.providerTimeout",
      }),
    };
    const now = new Date("2026-07-19T09:00:00.000Z");
    const result = await executeEInvoiceAttempt({
      adapter,
      request,
      attemptCount: 1,
      now,
    });

    expect(result.status).toBe("queued");
    expect(result.attemptCount).toBe(2);
    expect(result.nextAttemptAt?.toISOString()).toBe(
      "2026-07-19T09:05:00.000Z",
    );
    expect(nextEInvoiceRetryAt(8, now)).toBeNull();
  });

  test("never retries or invents a number for an unconfigured provider", async () => {
    const result = await executeEInvoiceAttempt({
      adapter: null,
      request,
      attemptCount: 0,
      now: new Date("2026-07-19T09:00:00.000Z"),
    });

    expect(result.status).toBe("error");
    expect(result.error).toBe("einvoice.errors.providerNotConfigured");
    expect(result.number).toBeNull();
    expect(result.nextAttemptAt).toBeNull();
  });
});
