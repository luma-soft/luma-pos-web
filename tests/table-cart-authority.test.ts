import { describe, expect, test } from "bun:test";
import {
  mergeLockedTableCart,
  resolveAuthoritativeTableCart,
  tableCheckoutClientId,
} from "../src/lib/tables/authoritative-cart";

describe("F&B table cart authority", () => {
  test("replaces client prices and modifier deltas with server-owned values", () => {
    const cart = resolveAuthoritativeTableCart({
      items: [
        {
          lineId: "line-1",
          productId: "00000000-0000-4000-8000-00000000f001",
          productName: "Forged name",
          unitName: "Forged unit",
          unitMultiplier: 99,
          quantity: 2,
          basePrice: 1,
          unitPrice: 2,
          modifiers: [
            { label: "Thêm phô mai", priceDelta: -50000 },
            { label: "Không cay", priceDelta: 900000 },
          ],
          course: "main",
          courseDelayMinutes: 10,
          sent: true,
        },
      ],
      products: [
        {
          id: "00000000-0000-4000-8000-00000000f001",
          name: "Phở API",
          baseUnit: "tô",
          retailPrice: 89000,
          isActive: true,
          lifecycleStatus: "active",
        },
      ],
      modifierOptions: [
        { label: "Thêm phô mai", priceDelta: 10000 },
      ],
      lockedSentLineIds: new Set(),
    });

    expect(cart).toEqual([
      {
        lineId: "line-1",
        productId: "00000000-0000-4000-8000-00000000f001",
        productName: "Phở API",
        unitName: "tô",
        unitMultiplier: 1,
        quantity: 2,
        basePrice: 89000,
        unitPrice: 99000,
        modifiers: [
          { label: "Thêm phô mai", priceDelta: 10000 },
          { label: "Không cay", priceDelta: 0 },
        ],
        course: "main",
        courseDelayMinutes: 10,
        sent: false,
      },
    ]);
  });

  test("keeps server-sent lines immutable and rejects client sent flags", () => {
    const sentLine = {
      lineId: "sent-line",
      productId: "00000000-0000-4000-8000-00000000f001",
      productName: "Server snapshot",
      unitName: "tô",
      unitMultiplier: 1,
      quantity: 2,
      basePrice: 89000,
      unitPrice: 89000,
      modifiers: [],
      course: "main" as const,
      courseDelayMinutes: 0,
      sent: true,
    };
    const newLine = {
      ...sentLine,
      lineId: "new-line",
      productId: "00000000-0000-4000-8000-00000000f002",
      quantity: 1,
      sent: true,
    };
    const merged = mergeLockedTableCart({
      existing: [sentLine],
      requested: [newLine],
    });
    const cart = resolveAuthoritativeTableCart({
      items: merged.items,
      products: [
        {
          id: sentLine.productId,
          name: "Phở API",
          baseUnit: "tô",
          retailPrice: 89000,
          isActive: true,
          lifecycleStatus: "active",
        },
        {
          id: newLine.productId,
          name: "Trà API",
          baseUnit: "ly",
          retailPrice: 29000,
          isActive: true,
          lifecycleStatus: "active",
        },
      ],
      modifierOptions: [],
      lockedSentLineIds: merged.lockedSentLineIds,
    });

    expect(cart.map((line) => [line.lineId, line.quantity, line.sent])).toEqual([
      ["sent-line", 2, true],
      ["new-line", 1, false],
    ]);
  });

  test("builds a stable retry identity from table and selected bill lines", () => {
    const first = tableCheckoutClientId({
      tableId: "00000000-0000-4000-8000-00000000b101",
      lineIds: ["line-b", "line-a"],
    });
    const replay = tableCheckoutClientId({
      tableId: "00000000-0000-4000-8000-00000000b101",
      lineIds: ["line-a", "line-b"],
    });
    const differentBill = tableCheckoutClientId({
      tableId: "00000000-0000-4000-8000-00000000b101",
      lineIds: ["line-a"],
    });

    expect(replay).toBe(first);
    expect(differentBill).not.toBe(first);
    expect(first.length).toBeLessThanOrEqual(40);
  });
});
