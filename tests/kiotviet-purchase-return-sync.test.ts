import { describe, expect, test } from "bun:test";
import { readKiotVietDataBundle } from "@/lib/kiotviet/data-sync-files";
import { stableKiotVietFingerprint } from "@/lib/kiotviet/data-sync-plan";
import { planKiotVietPurchaseReturnSync } from "@/lib/kiotviet/purchase-return-sync";

const sourceRows = [{
  "Mã trả hàng nhập": "THN-001",
  "Thời gian": "30/08/2026 10:15:00",
  "Mã nhà cung cấp": "NCC-001",
  "Tổng tiền hàng trả": 240000,
  "Giảm giá": 10000,
  "VAT trả hàng nhập": 11500,
  "NCC cần trả": 241500,
  "Tiền NCC trả": 40000,
  "Trạng thái": "Đã trả hàng",
  "Ghi chú": "NCC nhận đủ hàng",
  "Mã hàng": "ALT-001",
  "Tên hàng": "Sản phẩm hộp",
  ĐVT: "Hộp",
  "Số lượng": 2,
  "Giá trả lại": 120000,
  "Giảm giá trả lại": 0,
  "Thành tiền": 240000,
}];

const resolvedSuppliers = [{ code: "NCC-001", supplierId: "supplier-001" }];
const resolvedProducts = [{
  sku: "ALT-001",
  productId: "product-001",
  unitName: "Hộp",
  sourceUnitName: "Hộp",
  unitMultiplier: 12,
  resolutionSource: "alternate_unit" as const,
}];
const suppliedBundleDirectory = process.env.KIOTVIET_BUNDLE_DIR;
const suppliedBundleTest = suppliedBundleDirectory ? test : test.skip;
type SettlementCase = {
  paid: number;
  total: number;
  want: "unsettled" | "partial" | "settled";
  debt: number;
};

function plan(input: Partial<Parameters<typeof planKiotVietPurchaseReturnSync>[0]> = {}) {
  return planKiotVietPurchaseReturnSync({
    storeId: "store-001",
    sourceRows,
    current: [],
    mappings: [],
    lineMappings: [],
    existingLines: [],
    resolvedSuppliers,
    resolvedProducts,
    ...input,
  });
}

describe("KiotViet supplier-return synchronization", () => {
  test("plans a ledger-only supplier return while keeping purchase links null", () => {
    const result = plan();

    expect(result.blockers).toEqual([]);
    expect(result.operationalEffects).toEqual([]);
    expect(result.summary).toMatchObject({ documents: 1, lines: 1, creates: 1 });
    expect(result.writes).toEqual([{
      action: "create",
      externalId: "THN-001",
      purchaseReturn: {
        code: "THN-001",
        purchaseOrderId: null,
        supplierId: "supplier-001",
        status: "completed",
        settlementStatus: "partial",
        subtotal: 240000,
        discount: 10000,
        vatRate: 0,
        tax: 11500,
        totalRefund: 241500,
        refundAmount: 40000,
        refundMethod: "cash",
        debtAmount: 201500,
        note: "NCC nhận đủ hàng",
        createdAt: new Date("2026-08-30T03:15:00.000Z"),
        lines: [{
          action: "create",
          externalId: "THN-001|ALT-001|hộp|1",
          line: {
            purchaseOrderItemId: null,
            productId: "product-001",
            sourceSku: "ALT-001",
            productName: "Sản phẩm hộp",
            unitName: "Hộp",
            unitMultiplier: 12,
            quantity: 2,
            unitCost: 120000,
            returnUnitCost: 120000,
            total: 240000,
          },
        }],
        preservedLineIds: [],
      },
    }]);
  });

  test.each<SettlementCase>([
    { paid: 0, total: 100, want: "unsettled", debt: 100 },
    { paid: 1, total: 100, want: "partial", debt: 99 },
    { paid: 100, total: 100, want: "settled", debt: 0 },
    { paid: 125, total: 100, want: "settled", debt: 0 },
  ])("classifies the exact settlement boundary for paid=$paid", ({ paid, total, want, debt }: SettlementCase) => {
    const result = plan({
      sourceRows: [{
        ...sourceRows[0]!,
        "Tổng tiền hàng trả": total,
        "Giảm giá": 0,
        "VAT trả hàng nhập": 0,
        "NCC cần trả": total,
        "Tiền NCC trả": paid,
        "Số lượng": 1,
        "Giá trả lại": total,
        "Thành tiền": total,
      }],
    });

    expect(result.returns[0]).toMatchObject({
      settlementStatus: want,
      refundAmount: paid,
      debtAmount: debt,
    });
  });

  test.each([
    ["Đã hủy", "draft"],
    ["Phiếu tạm", "draft"],
  ])("keeps non-operational status %s as draft", (sourceStatus: string, want: string) => {
    const result = plan({ sourceRows: [{ ...sourceRows[0]!, "Trạng thái": sourceStatus }] });
    expect(result.returns[0]?.status).toBe(want);
    expect(result.operationalEffects).toEqual([]);
  });

  test("repairs a safe legacy settlement status and adopts its actual legacy child shape", () => {
    const result = plan({
      current: [{
        localId: "return-001", code: "THN-001", fingerprint: "outdated",
        settlementStatus: "settled", legacyImported: true,
      }],
      existingLines: [{
        localId: "legacy-line", purchaseReturnId: "return-001", legacyImported: true,
        legacyProductSku: "ALT-001", quantity: 2, unitCost: 120000,
        returnUnitCost: 120000, total: 240000,
      }, {
        localId: "luma-line", purchaseReturnId: "return-001", legacyImported: false,
      }],
    });

    expect(result.blockers).toEqual([]);
    expect(result.summary).toMatchObject({ adopts: 1, settlementStatusRepairs: 1, preservedLines: 1 });
    expect(result.writes[0]).toMatchObject({
      action: "adopt",
      localId: "return-001",
      purchaseReturn: {
        purchaseOrderId: null,
        settlementStatus: "partial",
        lines: [{
          action: "update", localId: "legacy-line",
          externalId: "THN-001|ALT-001|hộp|1",
          line: { purchaseOrderItemId: null },
        }],
        preservedLineIds: ["luma-line"],
      },
    });
  });

  test("reuses an exact legacy child for a mapped existing parent without child provenance", () => {
    const result = plan({
      current: [{
        localId: "return-001", code: "THN-001", fingerprint: "outdated",
        settlementStatus: "settled", legacyImported: true,
      }],
      mappings: [{ externalId: "THN-001", localId: "return-001" }],
      existingLines: [{
        localId: "legacy-line", purchaseReturnId: "return-001", legacyImported: true,
        legacyProductSku: "ALT-001", quantity: 2, unitCost: 120000,
        returnUnitCost: 120000, total: 240000,
      }],
    });

    expect(result.blockers).toEqual([]);
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0]).toMatchObject({
      action: "update",
      localId: "return-001",
      purchaseReturn: {
        lines: [{
          action: "update", localId: "legacy-line",
          externalId: "THN-001|ALT-001|hộp|1",
        }],
        preservedLineIds: [],
      },
    });
  });

  test("backfills missing child provenance for an otherwise unchanged mapped parent", () => {
    const sourceFingerprint = stableKiotVietFingerprint(plan().returns[0]!);
    const result = plan({
      current: [{
        localId: "return-001", code: "THN-001", fingerprint: sourceFingerprint,
        settlementStatus: "partial", legacyImported: true,
      }],
      mappings: [{ externalId: "THN-001", localId: "return-001" }],
      existingLines: [{
        localId: "legacy-line", purchaseReturnId: "return-001", legacyImported: true,
        legacyProductSku: "ALT-001", quantity: 2, unitCost: 120000,
        returnUnitCost: 120000, total: 240000,
      }],
    });

    expect(result.entityPlan.unchanged).toEqual([{ externalId: "THN-001", localId: "return-001" }]);
    expect(result.blockers).toEqual([]);
    expect(result.writes).toMatchObject([{
      action: "update", localId: "return-001",
      purchaseReturn: { lines: [{ action: "update", localId: "legacy-line" }] },
    }]);
  });

  test("blocks unresolved suppliers and products without dropping source lines", () => {
    const unresolvedSupplier = plan({ resolvedSuppliers: [] });
    expect(unresolvedSupplier.writes).toEqual([]);
    expect(unresolvedSupplier.blockers).toContainEqual({
      documentCode: "THN-001", reference: "NCC-001", reason: "unresolved_supplier",
    });

    const unresolvedProduct = plan({ resolvedProducts: [] });
    expect(unresolvedProduct.writes).toEqual([]);
    expect(unresolvedProduct.summary).toMatchObject({ documents: 1, sourceLines: 1, lines: 0, unresolvedProducts: 1 });
    expect(unresolvedProduct.blockers).toContainEqual({
      documentCode: "THN-001", reference: "ALT-001", reason: "unresolved_product",
    });
  });

  test("requires nonblank source SKU and source unit and rejects an unresolved unit", () => {
    expect(() => plan({ sourceRows: [{ ...sourceRows[0]!, "Mã hàng": " " }] }))
      .toThrow("requires source SKU and source unit");
    expect(() => plan({ sourceRows: [{ ...sourceRows[0]!, ĐVT: " " }] }))
      .toThrow("requires source SKU and source unit");

    const result = plan({ sourceRows: [{ ...sourceRows[0]!, ĐVT: "Thùng" }] });
    expect(result.blockers).toContainEqual({
      documentCode: "THN-001", reference: "ALT-001", reason: "unresolved_product_unit",
    });
  });

  test("blocks mapping collisions and mapped-child parent mismatches", () => {
    expect(() => plan({
      lineMappings: [
        { externalId: "THN-001|ALT-001|hộp|1", localId: "line-1" },
        { externalId: "THN-001|ALT-001|hộp|1", localId: "line-2" },
      ],
    })).toThrow("Duplicate KiotViet purchase return line mapping identity");

    const result = plan({
      current: [{
        localId: "return-001", code: "THN-001", fingerprint: "outdated",
        settlementStatus: "settled", legacyImported: true,
      }],
      lineMappings: [{
        externalId: "THN-001|ALT-001|hộp|1", localId: "wrong-parent-line",
      }],
      existingLines: [{
        localId: "wrong-parent-line", purchaseReturnId: "return-999", legacyImported: true,
        legacyProductSku: "ALT-001", quantity: 2, unitCost: 120000,
        returnUnitCost: 120000, total: 240000,
      }],
    });
    expect(result.writes).toEqual([]);
    expect(result.blockers).toContainEqual({
      documentCode: "THN-001", reference: "THN-001|ALT-001|hộp|1", reason: "mapped_line_parent_mismatch",
    });

    const duplicateRows = [
      {
        ...sourceRows[0]!, "Tổng tiền hàng trả": 480000, "NCC cần trả": 481500,
      },
      {
        ...sourceRows[0]!, "Tổng tiền hàng trả": 480000, "NCC cần trả": 481500,
      },
    ];
    const duplicateLocal = plan({
      sourceRows: duplicateRows,
      current: [{
        localId: "return-001", code: "THN-001", fingerprint: "outdated",
        settlementStatus: "partial", legacyImported: true,
      }],
      lineMappings: [
        { externalId: "THN-001|ALT-001|hộp|1", localId: "same-line" },
        { externalId: "THN-001|ALT-001|hộp|2", localId: "same-line" },
      ],
      existingLines: [{ localId: "same-line", purchaseReturnId: "return-001" }],
    });
    expect(duplicateLocal.writes).toEqual([]);
    expect(duplicateLocal.blockers).toContainEqual({
      documentCode: "THN-001", reference: "THN-001|ALT-001|hộp|2", reason: "duplicate_local_child_write",
    });

    const parentCollision = plan({
      current: [{
        localId: "luma-return", code: "THN-001", fingerprint: "luma",
        settlementStatus: "partial", legacyImported: false,
      }],
    });
    expect(parentCollision.writes).toEqual([]);
    expect(parentCollision.blockers).toEqual([{
      documentCode: "THN-001", reference: "luma-return", reason: "parent_identity_conflict",
    }]);
  });

  test("blocks an unmatched source-owned legacy child but preserves a Luma-native child", () => {
    const result = plan({
      current: [{
        localId: "return-001", code: "THN-001", fingerprint: "outdated",
        settlementStatus: "partial", legacyImported: true,
      }],
      existingLines: [{
        localId: "legacy-wrong", purchaseReturnId: "return-001", legacyImported: true,
        legacyProductSku: "WRONG", quantity: 2, unitCost: 120000,
        returnUnitCost: 120000, total: 240000,
      }, { localId: "luma-line", purchaseReturnId: "return-001", legacyImported: false }],
    });
    expect(result.writes).toEqual([]);
    expect(result.blockers).toContainEqual({
      documentCode: "THN-001", reference: "THN-001|ALT-001|hộp|1", reason: "legacy_line_unmatched",
    });
    expect(result.preservedLineIds).toEqual(["legacy-wrong", "luma-line"]);

    const ambiguous = plan({
      current: [{
        localId: "return-001", code: "THN-001", fingerprint: "outdated",
        settlementStatus: "partial", legacyImported: true,
      }],
      existingLines: ["legacy-a", "legacy-b"].map((localId) => ({
        localId, purchaseReturnId: "return-001", legacyImported: true,
        legacyProductSku: "ALT-001", quantity: 2, unitCost: 120000,
        returnUnitCost: 120000, total: 240000,
      })),
    });
    expect(ambiguous.writes).toEqual([]);
    expect(ambiguous.blockers).toContainEqual({
      documentCode: "THN-001", reference: "THN-001|ALT-001|hộp|1", reason: "ambiguous_legacy_line_match",
    });
  });

  test("reserves a mapped local child globally before exact legacy fallback", () => {
    const result = plan({
      current: [{
        localId: "return-001", code: "THN-001", fingerprint: "outdated",
        settlementStatus: "partial", legacyImported: true,
      }],
      lineMappings: [{
        externalId: "THN-001|ALT-001|hộp|2", localId: "legacy-reserved",
      }],
      existingLines: ["legacy-free", "legacy-reserved"].map((localId) => ({
        localId, purchaseReturnId: "return-001", legacyImported: true,
        legacyProductSku: "ALT-001", quantity: 2, unitCost: 120000,
        returnUnitCost: 120000, total: 240000,
      })),
    });

    expect(result.blockers).toEqual([]);
    expect(result.writes[0]?.purchaseReturn.lines).toMatchObject([{
      action: "update", localId: "legacy-free", externalId: "THN-001|ALT-001|hộp|1",
    }]);
    expect(result.writes[0]?.purchaseReturn.preservedLineIds).toEqual(["legacy-reserved"]);
  });

  test("assigns duplicate same-unit occurrences independently of worksheet order", () => {
    const second = {
      ...sourceRows[0]!,
      "Tổng tiền hàng trả": 360000,
      "Giảm giá": 0,
      "VAT trả hàng nhập": 0,
      "NCC cần trả": 360000,
      "Tiền NCC trả": 0,
      "Số lượng": 1,
      "Giá trả lại": 120000,
      "Thành tiền": 120000,
    };
    const first = { ...second, "Số lượng": 2, "Thành tiền": 240000 };
    const forward = plan({ sourceRows: [first, second] }).returns[0];
    const reversed = plan({ sourceRows: [second, first] }).returns[0];

    expect(reversed).toEqual(forward);
    expect(forward?.lines.map((line) => [line.externalId, line.quantity])).toEqual([
      ["THN-001|ALT-001|hộp|1", 2],
      ["THN-001|ALT-001|hộp|2", 1],
    ]);
  });

  test("plans the reviewed 62 adoptions, 3 creates, 198 lines, and 52 settlement repairs without operational work", () => {
    const documents = Array.from({ length: 65 }, (_, index) => {
      const code = `THN-${String(index + 1).padStart(3, "0")}`;
      const lineCount = index < 3 ? 4 : 3;
      return Array.from({ length: lineCount }, (_, lineIndex) => ({
        ...sourceRows[0]!,
        "Mã trả hàng nhập": code,
        "Tổng tiền hàng trả": lineCount,
        "Giảm giá": 0,
        "VAT trả hàng nhập": 0,
        "NCC cần trả": lineCount,
        "Tiền NCC trả": lineCount,
        "Số lượng": 1,
        "Giá trả lại": 1,
        "Thành tiền": 1,
        "Ghi chú hàng hóa": `Line ${lineIndex + 1}`,
      }));
    }).flat();
    const result = plan({
      sourceRows: documents,
      current: Array.from({ length: 62 }, (_, index) => ({
        localId: `return-${index + 1}`,
        code: `THN-${String(index + 1).padStart(3, "0")}`,
        fingerprint: "legacy",
        settlementStatus: index < 52 ? "unsettled" as const : "settled" as const,
        legacyImported: true,
      })),
    });

    expect(result.blockers).toEqual([]);
    expect(result.summary).toMatchObject({
      documents: 65, sourceLines: 198, lines: 198,
      adopts: 62, creates: 3, settlementStatusRepairs: 52,
    });
    expect(result.writes).toHaveLength(65);
    expect(result.operationalEffects).toEqual([]);
    expect(result.writes.every((write) => write.purchaseReturn.purchaseOrderId === null)).toBe(true);
    expect(result.writes.flatMap((write) => write.purchaseReturn.lines)
      .every((line) => line.line.purchaseOrderItemId === null)).toBe(true);
  });

  suppliedBundleTest("fails closed on blank source units in the reviewed supplier-return workbook", () => {
    const source = readKiotVietDataBundle(suppliedBundleDirectory!).sources
      .find((candidate) => candidate.phase === "purchase-returns")!;

    expect({ documents: source.documentCount, lines: source.rowCount }).toEqual({ documents: 65, lines: 198 });
    expect(source.rows.filter((row) => !String(row.ĐVT ?? "").trim())).toHaveLength(86);
    expect(() => plan({ sourceRows: source.rows }))
      .toThrow("KiotViet purchase return requires source SKU and source unit");
  });
});
