import { describe, expect, test } from "bun:test";
import { issueEInvoiceSchema } from "../src/lib/schemas/einvoice";

const valid = {
  orderId: "00000000-0000-4000-8000-000000000001",
  buyerName: "Công ty API",
  buyerTaxCode: "0312345678",
  buyerAddress: "1 API Street",
  buyerEmail: "buyer@example.com",
  vatRate: 10,
  requestId: "mobile-einvoice-order-1",
};

describe("e-invoice mobile contract", () => {
  test("accepts buyer tax details and stable retry identity", () => {
    expect(issueEInvoiceSchema.parse(valid)).toMatchObject(valid);
  });

  test("rejects malformed email and missing request identity", () => {
    expect(issueEInvoiceSchema.safeParse({ ...valid, buyerEmail: "bad" }).success).toBe(false);
    expect(issueEInvoiceSchema.safeParse({ ...valid, requestId: undefined }).success).toBe(false);
  });

  test("allows server-derived VAT fallback for mobile issuance", () => {
    const { vatRate: _ignored, ...withoutClientVat } = valid;
    expect(issueEInvoiceSchema.parse(withoutClientVat)).not.toHaveProperty("vatRate");
  });
});
