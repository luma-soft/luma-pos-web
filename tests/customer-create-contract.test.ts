import { describe, expect, it } from "vitest";
import { createCustomerSchema } from "../src/lib/schemas/order";

describe("customer create contract", () => {
  it("keeps contact fields and defaults missing consent to pending", () => {
    const result = createCustomerSchema.parse({
      name: "Khách Contract",
      email: "contract@example.com",
      zaloUserId: "zalo-contract",
      type: "contractor",
    });

    expect(result).toMatchObject({
      email: "contract@example.com",
      zaloUserId: "zalo-contract",
      type: "contractor",
      consentStatus: "pending",
      consentPurposes: {},
    });
  });

  it("accepts explicit mobile consent in the same create request", () => {
    const result = createCustomerSchema.parse({
      name: "Khách Mobile",
      consentStatus: "granted",
      consentPurposes: {
        sales: true,
        loyalty: true,
        marketing: false,
        analytics: false,
      },
      consentSource: "mobile",
    });

    expect(result.consentStatus).toBe("granted");
    expect(result.consentPurposes.marketing).toBe(false);
    expect(result.consentSource).toBe("mobile");
  });
});
