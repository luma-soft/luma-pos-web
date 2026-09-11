import { describe, expect, test } from "bun:test";
import { parseStorePrefs, storePrefsPatchSchema } from "./settings";

describe("tax preferences", () => {
  test("upgrades legacy stored preferences with safe tax-profile defaults", () => {
    const prefs = parseStorePrefs({ tax: { defaultRate: 10, priceIncludesTax: true } });
    expect(prefs.tax).toMatchObject({ taxpayerType: "household_business", calculationMethod: "unconfigured", filingFrequency: "unconfigured", vatTreatment: "taxable", autoApplyDefaultVat: true, defaultRate: 10, priceIncludesTax: true, businessActivities: [] });
  });
  test("keeps a legacy zero default rate disabled", () => {
    const prefs = parseStorePrefs({ tax: { defaultRate: 0 } });
    expect(prefs.tax.autoApplyDefaultVat).toBe(false);
  });
  test("accepts a complete household-business tax profile", () => {
    const result = storePrefsPatchSchema.safeParse({ tax: { taxpayerType: "household_business", calculationMethod: "revenue_percentage", filingFrequency: "quarterly", effectiveFrom: "2026-01-01", taxpayerName: "Hộ kinh doanh Hải Đăng", taxpayerAddress: "Hải Phòng", taxpayerEmail: "tax@example.com", formerTaxCode: "031094005579", vatTreatment: "taxable", autoApplyDefaultVat: true, defaultRate: 8, priceIncludesTax: true, businessActivities: [{ id: "goods", name: "Phân phối hàng hóa", vatRate: 1, pitRate: 0.5, enabled: true }], einvoiceEnabled: false, einvoiceProvider: "VNPT", einvoiceTaxId: "" } });
    expect(result.success).toBe(true);
  });
  test("rejects invalid dates, rates, and taxpayer email", () => {
    const result = storePrefsPatchSchema.safeParse({ tax: { effectiveFrom: "01/01/2026", taxpayerEmail: "not-an-email", businessActivities: [{ id: "goods", name: "Hàng hóa", vatRate: 101, pitRate: 0.5 }] } });
    expect(result.success).toBe(false);
  });
});
