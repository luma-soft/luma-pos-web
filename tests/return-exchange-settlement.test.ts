import { describe, expect, test } from "bun:test";
import { createExchangeSchema } from "../src/lib/schemas/returns";
import { calculateExchangeSettlement } from "../src/lib/returns/exchange-settlement";

const baseInput = {
  clientId: "ex-1780000000000000",
  orderId: "00000000-0000-4000-8000-000000000001",
  reason: "wrong item",
  refundMethod: "cash" as const,
  items: [{
    orderItemId: "00000000-0000-4000-8000-000000000002",
    quantity: 1,
    restock: true,
  }],
  exchangeItems: [{
    productId: "00000000-0000-4000-8000-000000000003",
    unitName: "cái",
    quantity: 1,
  }],
  settlementMethod: "cash" as const,
};

describe("return exchange contract", () => {
  test("requires a bounded idempotency key", () => {
    expect(createExchangeSchema.safeParse(baseInput).success).toBe(true);
    expect(createExchangeSchema.safeParse({ ...baseInput, clientId: "short" }).success)
      .toBe(false);
    expect(createExchangeSchema.safeParse({ ...baseInput, clientId: "x".repeat(41) }).success)
      .toBe(false);
  });

  test("rejects duplicate return and replacement lines", () => {
    expect(createExchangeSchema.safeParse({
      ...baseInput,
      items: [...baseInput.items, ...baseInput.items],
    }).success).toBe(false);
    expect(createExchangeSchema.safeParse({
      ...baseInput,
      exchangeItems: [...baseInput.exchangeItems, ...baseInput.exchangeItems],
    }).success).toBe(false);
  });

  test("collects a positive cash difference", () => {
    expect(calculateExchangeSettlement({
      returnTotal: 99_000,
      replacementTotal: 249_000,
      settlementMethod: "cash",
      refundMethod: "cash",
    })).toEqual({
      returnTotal: 99_000,
      replacementTotal: 249_000,
      difference: 150_000,
      direction: "collect",
      exchangeCredit: 99_000,
      amountPaid: 249_000,
      paymentStatus: "paid",
      debtDelta: 0,
      cashIn: 150_000,
      cashOut: 0,
    });
  });

  test("records an unpaid positive difference as customer debt", () => {
    const result = calculateExchangeSettlement({
      returnTotal: 99_000,
      replacementTotal: 249_000,
      settlementMethod: "credit",
      refundMethod: "cash",
    });
    expect(result.amountPaid).toBe(99_000);
    expect(result.paymentStatus).toBe("partial");
    expect(result.debtDelta).toBe(150_000);
    expect(result.cashIn).toBe(0);
  });

  test("refunds a negative difference or deducts it from debt", () => {
    const cash = calculateExchangeSettlement({
      returnTotal: 249_000,
      replacementTotal: 99_000,
      settlementMethod: "cash",
      refundMethod: "cash",
    });
    expect(cash.direction).toBe("refund");
    expect(cash.cashOut).toBe(150_000);
    expect(cash.debtDelta).toBe(0);

    const debt = calculateExchangeSettlement({
      returnTotal: 249_000,
      replacementTotal: 99_000,
      settlementMethod: "cash",
      refundMethod: "debt_deduct",
    });
    expect(debt.cashOut).toBe(0);
    expect(debt.debtDelta).toBe(-150_000);
  });

  test("gateway refund stays outside cashbook until provider confirmation", () => {
    const result = calculateExchangeSettlement({
      returnTotal: 100_000,
      replacementTotal: 60_000,
      settlementMethod: "cash",
      refundMethod: "momo",
    });
    expect(result.direction).toBe("refund");
    expect(result.cashOut).toBe(0);
  });

  test("rounds money before deciding settlement direction", () => {
    const result = calculateExchangeSettlement({
      returnTotal: 0.1 + 0.2,
      replacementTotal: 0.3,
      settlementMethod: "cash",
      refundMethod: "cash",
    });
    expect(result.direction).toBe("even");
    expect(result.difference).toBe(0);
  });
});
