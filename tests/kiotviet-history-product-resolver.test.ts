import { describe, expect, test } from "bun:test";
import {
  assertKiotVietHistoryProductAuditComplete,
  auditKiotVietHistoryProducts,
  createKiotVietHistoryProductResolver,
} from "@/lib/kiotviet/history-product-resolver";

describe("KiotViet historical product resolver", () => {
  test("resolves bases, live alternate units, archived mappings, and approved historical placeholders", () => {
    const resolver = createKiotVietHistoryProductResolver({
      currentBaseProducts: [
        { id: "base-id", sku: "BASE", baseUnit: "Cái" },
      ],
      productUnits: [
        { productId: "base-id", sku: "ALT", unitName: "Thùng", multiplier: 12 },
      ],
      archivedSourceMappings: [
        // This is a legacy product left behind for ALT. A live unit SKU wins.
        { productId: "legacy-unit-id", externalId: "ALT", baseUnit: "Thùng" },
        { productId: "archived-id", externalId: "ARCHIVED", baseUnit: "Mét" },
      ],
      approvedHistoricalPlaceholders: [
        { productId: "placeholder-id", sku: "MISSING", baseUnit: "Cuộn", isActive: false },
      ],
    });

    expect(resolver.resolve({ sku: "BASE" })).toEqual({
      status: "resolved",
      source: "current_base",
      productId: "base-id",
      sourceSku: "BASE",
      unitName: "Cái",
      unitMultiplier: 1,
    });
    expect(resolver.resolve({ sku: "ALT" })).toEqual({
      status: "resolved",
      source: "alternate_unit",
      productId: "base-id",
      sourceSku: "ALT",
      unitName: "Thùng",
      unitMultiplier: 12,
    });
    expect(resolver.resolve({ sku: "ARCHIVED" })).toEqual({
      status: "resolved",
      source: "archived_mapping",
      productId: "archived-id",
      sourceSku: "ARCHIVED",
      unitName: "Mét",
      unitMultiplier: 1,
    });
    expect(resolver.resolve({ sku: "MISSING" })).toEqual({
      status: "resolved",
      source: "approved_historical_placeholder",
      productId: "placeholder-id",
      sourceSku: "MISSING",
      unitName: "Cuộn",
      unitMultiplier: 1,
    });
  });

  test("retains alternate source units and blocks documents awaiting deterministic placeholder approval", () => {
    const resolver = createKiotVietHistoryProductResolver({
      currentBaseProducts: [{ id: "base-id", sku: "BASE", baseUnit: "Cái" }],
      productUnits: [{ productId: "base-id", sku: "ALT", unitName: "Thùng", multiplier: 12 }],
      archivedSourceMappings: [{ productId: "legacy-unit-id", externalId: "ALT", baseUnit: "Thùng" }],
      approvedHistoricalPlaceholders: [],
    });

    const audit = auditKiotVietHistoryProducts({
      resolver,
      references: [
        { sku: "BASE", documentCode: "HD001" },
        { sku: "ALT", documentCode: "HD001" },
        { sku: "ALT", documentCode: "HD002" },
        { sku: "NEEDS-APPROVAL", productName: "Hàng lịch sử", unitName: "Bộ", documentCode: "HD003" },
      ],
    });

    expect(audit.summary).toEqual({
      uniqueSkuCount: 3,
      referenceCount: 4,
      alternateUnitSkuCount: 1,
      alternateUnitReferenceCount: 2,
      unresolvedReferenceCount: 1,
      awaitingPlaceholderApprovalCount: 1,
    });
    expect(audit.resolutions[1]).toMatchObject({
      status: "resolved",
      source: "alternate_unit",
      productId: "base-id",
      unitName: "Thùng",
      unitMultiplier: 12,
    });
    expect(audit.blockers).toEqual([{
      documentCode: "HD003",
      sku: "NEEDS-APPROVAL",
      reason: "awaiting_historical_placeholder_approval",
      placeholder: {
        sku: "NEEDS-APPROVAL",
        name: "Hàng lịch sử",
        baseUnit: "Bộ",
        isActive: false,
      },
    }]);
    expect(audit.placeholderProposals).toEqual([{
      sku: "NEEDS-APPROVAL",
      name: "Hàng lịch sử",
      baseUnit: "Bộ",
      isActive: false,
    }]);
    expect(() => assertKiotVietHistoryProductAuditComplete(audit))
      .toThrow("KiotViet history product resolution is blocking: 1 reference awaits historical placeholder approval");
  });

  test("fails closed when a caller falsifies an unresolved audit summary", () => {
    const resolver = createKiotVietHistoryProductResolver({
      currentBaseProducts: [],
      productUnits: [],
      archivedSourceMappings: [],
      approvedHistoricalPlaceholders: [],
    });
    const audit = auditKiotVietHistoryProducts({
      resolver,
      references: [{ sku: "NEEDS-APPROVAL" }],
    });

    audit.summary.awaitingPlaceholderApprovalCount = 0;
    audit.summary.unresolvedReferenceCount = 0;

    expect(() => assertKiotVietHistoryProductAuditComplete(audit))
      .toThrow("KiotViet history product resolution is blocking: 1 reference awaits historical placeholder approval");
  });
});
