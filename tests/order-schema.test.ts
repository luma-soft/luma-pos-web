import { describe, expect, test } from "bun:test";
import { cancelOrdersSchema, createOrderSchema } from "@/lib/schemas/order";

describe("POS order schema", () => {
  test("lets a unitless line reach authoritative product validation", () => {
    const result = createOrderSchema.safeParse({
      mode: "sale",
      clientId: "pos-order-with-unitless-service",
      customerId: null,
      warehouseId: "00000000-0000-4000-8000-000000000001",
      discount: 0,
      taxRate: 0,
      shippingFee: 0,
      items: [
        {
          productId: "00000000-0000-4000-8000-000000000002",
          productName: "Công lắp đặt camera - cơ bản",
          unitName: "",
          unitMultiplier: 1,
          quantity: 1,
          lineDiscount: 0,
        },
      ],
      payment: {
        method: "cash",
        amount: 110_000,
      },
    });

    expect(result.success).toBe(true);
  });

  test("accepts a bounded batch of unique order ids for cancellation", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";

    expect(cancelOrdersSchema.parse([first, first, second])).toEqual([
      first,
      second,
    ]);
    expect(cancelOrdersSchema.safeParse([]).success).toBe(false);
    expect(
      cancelOrdersSchema.safeParse(
        Array.from({ length: 101 }, (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      ).success,
    ).toBe(false);
  });
});
