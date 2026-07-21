import { describe, expect, it } from "vitest";
import { createProductSchema } from "@/app/(app)/products/new/schema";

const base = {
  name: "Coffee beans",
  categoryId: "category-1",
  vatRate: 8,
  priceByWeight: true,
  trackBatches: true,
  shelfLifeDays: 180,
  lifecycleStatus: "draft" as const,
};

describe("product depth schema", () => {
  it("accepts VAT, weight pricing, batch shelf life, and lifecycle", () => {
    const parsed = createProductSchema.parse(base);
    expect(parsed.vatRate).toBe(8);
    expect(parsed.priceByWeight).toBe(true);
    expect(parsed.trackBatches).toBe(true);
    expect(parsed.shelfLifeDays).toBe(180);
    expect(parsed.lifecycleStatus).toBe("draft");
  });

  it("rejects an invalid lifecycle and non-positive shelf life", () => {
    expect(createProductSchema.safeParse({
      ...base,
      lifecycleStatus: "deleted",
      shelfLifeDays: 0,
    }).success).toBe(false);
  });
});
