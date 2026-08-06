import { describe, expect, test } from "bun:test";
import {
  returnCancellationBlockReason,
  returnCancellationCustomerDeltas,
} from "@/lib/returns/cancellation";

describe("return cancellation policy", () => {
  test("allows a completed non-gateway return", () => {
    expect(returnCancellationBlockReason({
      status: "completed",
      exchangeOrderId: null,
      hasGatewayRefund: false,
    })).toBeNull();
  });

  test("blocks repeat, exchange, and gateway cancellation", () => {
    expect(returnCancellationBlockReason({ status: "cancelled", exchangeOrderId: null, hasGatewayRefund: false }))
      .toBe("RETURN_ALREADY_CANCELLED");
    expect(returnCancellationBlockReason({ status: "completed", exchangeOrderId: "exchange-1", hasGatewayRefund: false }))
      .toBe("EXCHANGE_CANCEL_UNSUPPORTED");
    expect(returnCancellationBlockReason({ status: "completed", exchangeOrderId: null, hasGatewayRefund: true }))
      .toBe("GATEWAY_CANCEL_UNSUPPORTED");
  });

  test("restores debt only when the original refund deducted debt", () => {
    expect(returnCancellationCustomerDeltas({ refundMethod: "debt_deduct", totalRefund: 120_000 }))
      .toEqual({ totalSpent: 120_000, currentDebt: 120_000 });
    expect(returnCancellationCustomerDeltas({ refundMethod: "cash", totalRefund: 120_000 }))
      .toEqual({ totalSpent: 120_000, currentDebt: 0 });
  });
});
