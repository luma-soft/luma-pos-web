import { describe, expect, it } from "vitest";
import { validateReceiptBatchLines } from "@/lib/inventory/batch-policy";

const trackedProduct = {
  id: "tracked",
  trackBatches: true,
  shelfLifeDays: 180,
};

describe("receipt batch policy", () => {
  it("requires batch and expiry for shelf-life tracked products", () => {
    expect(
      validateReceiptBatchLines({
        products: [trackedProduct],
        items: [{ productId: "tracked", quantity: 2 }],
        receivedOn: new Date("2026-07-19T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, error: "purchases.errors.batchRequired" });

    expect(
      validateReceiptBatchLines({
        products: [trackedProduct],
        items: [{ productId: "tracked", quantity: 2, batchNumber: "L-1" }],
        receivedOn: new Date("2026-07-19T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, error: "purchases.errors.expiryRequired" });
  });

  it("rejects an already expired receipt lot", () => {
    expect(
      validateReceiptBatchLines({
        products: [trackedProduct],
        items: [
          {
            productId: "tracked",
            quantity: 2,
            batchNumber: "L-1",
            expiryDate: "2026-07-18",
          },
        ],
        receivedOn: new Date("2026-07-19T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, error: "purchases.errors.expiredBatch" });
  });

  it("accepts valid tracked lots and untracked product lines", () => {
    expect(
      validateReceiptBatchLines({
        products: [trackedProduct, { id: "plain", trackBatches: false, shelfLifeDays: null }],
        items: [
          {
            productId: "tracked",
            quantity: 2,
            batchNumber: " L-1 ",
            expiryDate: "2027-01-15",
          },
          { productId: "plain", quantity: 1 },
        ],
        receivedOn: new Date("2026-07-19T00:00:00.000Z"),
      }),
    ).toEqual({ ok: true });
  });
});
