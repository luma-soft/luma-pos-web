import { describe, expect, it } from "bun:test";
import { editSettlement } from "./edit-settlement";

describe("editSettlement", () => {
  it("collects only the difference when items are added", () => {
    expect(editSettlement({ total: 1_200_000, alreadyPaid: 1_000_000, hasCustomer: true }))
      .toMatchObject({ due: 200_000, excess: 0, refund: 0 });
  });
  it("keeps the excess as credit for customers by default", () => {
    expect(editSettlement({ total: 800_000, alreadyPaid: 1_000_000, hasCustomer: true }))
      .toMatchObject({ due: 0, excess: 200_000, excessChoice: "credit", refund: 0 });
  });
  it("refunds the excess when chosen", () => {
    expect(editSettlement({ total: 800_000, alreadyPaid: 1_000_000, hasCustomer: true, choice: "refund" }).refund).toBe(200_000);
  });
  it("always refunds walk-in sales", () => {
    expect(editSettlement({ total: 800_000, alreadyPaid: 1_000_000, hasCustomer: false, choice: "credit" }))
      .toMatchObject({ excessChoice: "refund", refund: 200_000 });
  });
});
