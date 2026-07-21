import { describe, expect, it } from "vitest";
import { summarizeExpiryLots } from "@/lib/inventory/expiry-policy";

describe("expiry stock alerts", () => {
  it("classifies expired, expiring and missing-expiry stock without counting empty lots", () => {
    const result = summarizeExpiryLots(
      [
        { id: "expired", expiryDate: "2026-07-18", availableQuantity: "2", requiresExpiry: true },
        { id: "today", expiryDate: "2026-07-19", availableQuantity: "1", requiresExpiry: true },
        { id: "soon", expiryDate: "2026-08-10", availableQuantity: "3", requiresExpiry: true },
        { id: "later", expiryDate: "2026-09-01", availableQuantity: "4", requiresExpiry: true },
        { id: "unknown", expiryDate: null, availableQuantity: "5", requiresExpiry: true },
        { id: "empty", expiryDate: "2026-07-01", availableQuantity: "0", requiresExpiry: true },
      ],
      { today: "2026-07-19", warningDays: 30 },
    );

    expect(result.expiredCount).toBe(1);
    expect(result.expiringCount).toBe(2);
    expect(result.missingExpiryCount).toBe(1);
    expect(result.attentionCount).toBe(4);
    expect(result.rows.map((row) => row.id)).toEqual(["expired", "today", "soon", "unknown"]);
  });
});
