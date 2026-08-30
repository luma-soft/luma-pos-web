import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { readKiotVietDataBundle } from "@/lib/kiotviet/data-sync-files";
import { createKiotVietHistoryProductResolver } from "@/lib/kiotviet/history-product-resolver";
import { parseKiotVietProductRows } from "@/lib/kiotviet/product-sync";
import {
  kiotVietPurchaseFingerprint,
  planKiotVietPurchaseSync,
  type KiotVietResolvedPurchaseProduct,
} from "@/lib/kiotviet/purchase-sync";

const sourceRows = [
  {
    "Mã nhập hàng": "PN-001",
    "Thời gian": "30/08/2026 10:15:00",
    "Mã nhà cung cấp": "NCC-001",
    "Ghi chú": "Giao đủ chứng từ",
    "Số hóa đơn đầu vào": "INV-2026-001",
    "Tổng tiền hàng": 240000,
    "Giảm giá phiếu nhập": 10000,
    "VAT nhập hàng": 5,
    "VAT phiếu nhập": 11500,
    "Cần trả NCC": 241500,
    "Tiền đã trả NCC": 40000,
    "Trạng thái": "Đã nhập hàng",
    "Mã hàng": "ALT-001",
    "Tên hàng": "Sản phẩm hộp",
    ĐVT: "Hộp",
    "Số lượng": 2,
    "Giá nhập": 120000,
    "Giảm giá": 0,
    "Thành tiền": 240000,
    "Ghi chú hàng hóa": "Hàng dễ vỡ",
  },
  {
    "Mã nhập hàng": "PN-002",
    "Thời gian": "30/08/2026 11:00:00",
    "Mã nhà cung cấp": "",
    "Ghi chú": null,
    "Số hóa đơn đầu vào": "",
    "Tổng tiền hàng": 50000,
    "Giảm giá phiếu nhập": 0,
    "VAT nhập hàng": 0,
    "VAT phiếu nhập": 0,
    "Cần trả NCC": 50000,
    "Tiền đã trả NCC": 0,
    "Trạng thái": "Phiếu tạm",
    "Mã hàng": "BASE-001",
    "Tên hàng": "Sản phẩm lẻ",
    ĐVT: "Cái",
    "Số lượng": 1,
    "Giá nhập": 50000,
    "Giảm giá": 0,
    "Thành tiền": 50000,
    "Ghi chú hàng hóa": null,
  },
];

const resolvedSuppliers = [{ code: "NCC-001", supplierId: "supplier-001" }];
const resolvedProducts = [
  { sku: "ALT-001", productId: "product-001", unitName: "Hộp", sourceUnitName: "Hộp", unitMultiplier: 12, resolutionSource: "alternate_unit" as const },
  { sku: "BASE-001", productId: "product-002", unitName: "Cái", sourceUnitName: "Cái", unitMultiplier: 1, resolutionSource: "current_base" as const },
];
const suppliedBundleDirectory = process.env.KIOTVIET_BUNDLE_DIR;
const suppliedBundleTest = suppliedBundleDirectory ? test : test.skip;

function plan(input: Partial<Parameters<typeof planKiotVietPurchaseSync>[0]> = {}) {
  return planKiotVietPurchaseSync({
    storeId: "store-001",
    sourceRows,
    current: [],
    mappings: [],
    lineMappings: [],
    existingLines: [],
    resolvedSuppliers,
    unknownSupplierId: "supplier-unknown",
    resolvedProducts,
    ...input,
  });
}

function task6StyleWorkbookResolutions(
  rows: Record<string, unknown>[],
  snapshot: ReturnType<typeof parseKiotVietProductRows>,
): { resolvedProducts: KiotVietResolvedPurchaseProduct[]; currentBase: number; alternateUnit: number; unresolved: number } {
  const resolver = createKiotVietHistoryProductResolver({
    currentBaseProducts: snapshot.products.map((product) => ({
      id: `product:${product.sku}`,
      sku: product.sku,
      baseUnit: product.baseUnit,
    })),
    productUnits: snapshot.units.map((unit) => ({
      productId: `product:${unit.baseSku}`,
      sku: unit.sku,
      unitName: unit.unitName,
      multiplier: unit.multiplier,
    })),
    archivedSourceMappings: [],
    approvedHistoricalPlaceholders: [],
  });
  let currentBase = 0;
  let alternateUnit = 0;
  let unresolved = 0;
  const bySourceIdentity = new Map<string, KiotVietResolvedPurchaseProduct | null>();
  for (const row of rows) {
    const sku = String(row["Mã hàng"] ?? "");
    const sourceUnitName = String(row.ĐVT ?? "");
    const resolution = resolver.resolve({ sku, unitName: sourceUnitName });
    const key = `${sku.trim()}\u0000${sourceUnitName.trim().toLocaleLowerCase("vi")}`;
    if (resolution.status !== "resolved") {
      unresolved += 1;
      bySourceIdentity.set(key, null);
      continue;
    }
    if (resolution.source === "current_base") currentBase += 1;
    if (resolution.source === "alternate_unit") alternateUnit += 1;
    bySourceIdentity.set(key, {
      sku: resolution.sourceSku,
      productId: resolution.productId,
      unitName: resolution.unitName,
      sourceUnitName: resolution.sourceUnitName,
      unitMultiplier: resolution.unitMultiplier,
      resolutionSource: resolution.source,
    });
  }
  return {
    resolvedProducts: [...bySourceIdentity.values()].filter((value): value is KiotVietResolvedPurchaseProduct => value != null),
    currentBase,
    alternateUnit,
    unresolved,
  };
}

describe("KiotViet purchase receipt synchronization", () => {
  test("requires an explicit nonblank store scope", () => {
    expect(() => plan({ storeId: " " })).toThrow("KiotViet purchase store ID cannot be blank");
  });

  test("plans receipt totals, tax, supplier, invoice number, alternate-unit costs, and draft status", () => {
    const result = plan();

    expect(result.blockers).toEqual([]);
    expect(result.summary).toMatchObject({ documents: 2, lines: 2, creates: 2, subtotalRepairs: 0 });
    expect(result.writes).toEqual([
      {
        action: "create",
        externalId: "PN-001",
        purchase: {
          code: "PN-001",
          status: "received",
          supplierId: "supplier-001",
          createdAt: new Date("2026-08-30T03:15:00.000Z"),
          subtotal: 240000,
          discount: 10000,
          vatRate: 5,
          tax: 11500,
          total: 241500,
          amountPaid: 40000,
          invoiceNumber: "INV-2026-001",
          note: "Giao đủ chứng từ",
          lines: [{
            action: "create",
            adoptionMethod: "created",
            externalId: "PN-001|ALT-001|hộp|1",
            line: {
              productId: "product-001",
              sourceSku: "ALT-001",
              productName: "Sản phẩm hộp",
              unitName: "Hộp",
              unitMultiplier: 12,
              quantity: 2,
              unitCost: 120000,
              discount: 0,
              total: 240000,
            },
          }],
          preservedLineIds: [],
        },
      },
      {
        action: "create",
        externalId: "PN-002",
        purchase: expect.objectContaining({
          status: "draft",
          supplierId: "supplier-unknown",
          invoiceNumber: null,
        }),
      },
    ]);
  });

  test("adopts a zero-subtotal legacy receipt and only updates its proven matching child", () => {
    const result = plan({
      sourceRows: [sourceRows[0]!],
      current: [{ localId: "purchase-001", code: "PN-001", fingerprint: "outdated", subtotal: 0, legacyImported: true }],
      existingLines: [
        {
          localId: "legacy-line", purchaseOrderId: "purchase-001", legacyImported: true,
          sourceSku: "ALT-001", unitName: "Hộp", quantity: 2, unitCost: 120000,
          discount: 0, total: 240000,
        },
        { localId: "luma-line", purchaseOrderId: "purchase-001", legacyImported: false },
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(result.summary).toMatchObject({ adopts: 1, subtotalRepairs: 1, preservedLines: 1 });
    expect(result.writes[0]).toMatchObject({
      action: "adopt",
      localId: "purchase-001",
      purchase: {
        lines: [{ action: "adopt", adoptionMethod: "legacy_adopted", localId: "legacy-line", externalId: "PN-001|ALT-001|hộp|1" }],
        preservedLineIds: ["luma-line"],
      },
    });
  });

  test("adopts the actual legacy importer line shape using its joined product SKU", () => {
    const result = plan({
      sourceRows: [sourceRows[0]!],
      current: [{ localId: "purchase-001", code: "PN-001", fingerprint: "outdated", subtotal: 0, legacyImported: true }],
      existingLines: [{
        // The legacy importer persisted only product ID + quantity/cost/total.
        // The loader supplies this SKU by joining that product ID to products.
        localId: "legacy-import-line",
        purchaseOrderId: "purchase-001",
        legacyImported: true,
        legacyProductSku: "ALT-001",
        quantity: 2,
        unitCost: 120000,
        total: 240000,
      }],
    });

    expect(result.blockers).toEqual([]);
    expect(result.writes[0]?.purchase.lines).toMatchObject([{
      action: "adopt",
      adoptionMethod: "legacy_adopted",
      localId: "legacy-import-line",
      externalId: "PN-001|ALT-001|hộp|1",
    }]);
    expect(result.writes[0]?.purchase.preservedLineIds).toEqual([]);
  });

  test("backfills child provenance for an exact bootstrap receipt and preserves Luma children", () => {
    const source = plan({ sourceRows: [sourceRows[0]!] }).purchases[0]!;
    const result = plan({
      sourceRows: [sourceRows[0]!],
      current: [{
        localId: "purchase-001",
        code: "PN-001",
        fingerprint: kiotVietPurchaseFingerprint(source),
        subtotal: 240000,
        legacyImported: false,
      }],
      existingLines: [{
        localId: "bootstrap-line",
        purchaseOrderId: "purchase-001",
        legacyAdoptionEligible: true,
        legacyProductSku: "ALT-001",
        quantity: 2,
        unitCost: 120000,
        discount: 0,
        total: 240000,
      }, {
        localId: "luma-line",
        purchaseOrderId: "purchase-001",
        legacyImported: false,
      }],
    });

    expect(result.blockers).toEqual([]);
    expect(result.writes).toMatchObject([{
      action: "adopt",
      localId: "purchase-001",
      purchase: {
        lines: [{
          action: "adopt",
          adoptionMethod: "legacy_adopted",
          localId: "bootstrap-line",
        }],
        preservedLineIds: ["luma-line"],
      },
    }]);
  });

  test("blocks an adopted legacy receipt when a recoverable legacy line SKU cannot match the source", () => {
    const result = plan({
      sourceRows: [sourceRows[0]!],
      current: [{ localId: "purchase-001", code: "PN-001", fingerprint: "outdated", subtotal: 0, legacyImported: true }],
      existingLines: [{
        localId: "legacy-mismatched-line",
        purchaseOrderId: "purchase-001",
        legacyImported: true,
        legacyProductSku: "WRONG-SKU",
        quantity: 2,
        unitCost: 120000,
        total: 240000,
      }],
    });

    expect(result.writes).toEqual([]);
    expect(result.blockers).toEqual([{
      documentCode: "PN-001",
      reference: "PN-001|ALT-001|hộp|1",
      reason: "legacy_line_unmatched",
    }]);
    expect(result.entityPlan.preserves).toEqual([]);
    expect(result.preservedLineIds).toEqual(["legacy-mismatched-line"]);
  });

  test("matches legacy children globally so source row order cannot block a later safe match", () => {
    const legacyRow = {
      ...sourceRows[0]!,
      "Tổng tiền hàng": 240001,
      "Cần trả NCC": 241501,
    };
    const newRow = {
      ...legacyRow,
      "Mã hàng": "BASE-001",
      "Tên hàng": "Sản phẩm lẻ",
      ĐVT: "Cái",
      "Số lượng": 1,
      "Giá nhập": 1,
      "Thành tiền": 1,
      "Ghi chú hàng hóa": null,
    };
    const common = {
      current: [{ localId: "purchase-001", code: "PN-001", fingerprint: "outdated", subtotal: 0, legacyImported: true }],
      existingLines: [{
        localId: "legacy-alt-line",
        purchaseOrderId: "purchase-001",
        legacyImported: true,
        legacyProductSku: "ALT-001",
        quantity: 2,
        unitCost: 120000,
        total: 240000,
      }],
    };
    const plans = [[legacyRow, newRow], [newRow, legacyRow]].map((rows) => plan({ ...common, sourceRows: rows }));

    expect(plans.map((result) => result.blockers)).toEqual([[], []]);
    expect(plans.map((result) => result.preservedLineIds)).toEqual([[], []]);
    expect(plans.map((result) => result.purchases[0]?.lines.map((line) => line.externalId))).toEqual([
      ["PN-001|ALT-001|hộp|1", "PN-001|BASE-001|cái|1"],
      ["PN-001|ALT-001|hộp|1", "PN-001|BASE-001|cái|1"],
    ]);
    expect(plans.map((result) => result.writes[0]?.purchase.lines
      .map((line) => ({ action: line.action, externalId: line.externalId, localId: line.localId }))
      .sort((left, right) => left.externalId.localeCompare(right.externalId)))).toEqual([
      [
        { action: "adopt", externalId: "PN-001|ALT-001|hộp|1", localId: "legacy-alt-line" },
        { action: "create", externalId: "PN-001|BASE-001|cái|1", localId: undefined },
      ],
      [
        { action: "adopt", externalId: "PN-001|ALT-001|hộp|1", localId: "legacy-alt-line" },
        { action: "create", externalId: "PN-001|BASE-001|cái|1", localId: undefined },
      ],
    ]);
  });

  test("assigns stable occurrence IDs and legacy children to same-SKU/unit rows regardless of source order", () => {
    const oneUnitRow = {
      ...sourceRows[1]!,
      "Tổng tiền hàng": 3,
      "Cần trả NCC": 3,
      "Số lượng": 1,
      "Giá nhập": 1,
      "Thành tiền": 1,
      "Ghi chú hàng hóa": "one unit",
    };
    const twoUnitRow = {
      ...oneUnitRow,
      "Số lượng": 2,
      "Thành tiền": 2,
      "Ghi chú hàng hóa": "two units",
    };
    const common = {
      current: [{ localId: "purchase-002", code: "PN-002", fingerprint: "outdated", subtotal: 0, legacyImported: true }],
      existingLines: [
        {
          localId: "legacy-one-unit",
          purchaseOrderId: "purchase-002",
          legacyImported: true,
          legacyProductSku: "BASE-001",
          quantity: 1,
          unitCost: 1,
          total: 1,
        },
        {
          localId: "legacy-two-units",
          purchaseOrderId: "purchase-002",
          legacyImported: true,
          legacyProductSku: "BASE-001",
          quantity: 2,
          unitCost: 1,
          total: 2,
        },
      ],
    };
    const forward = plan({ ...common, sourceRows: [oneUnitRow, twoUnitRow] });
    const reversed = plan({ ...common, sourceRows: [twoUnitRow, oneUnitRow] });

    expect(forward.blockers).toEqual([]);
    expect(reversed.blockers).toEqual([]);
    expect(reversed.purchases).toEqual(forward.purchases);
    expect(reversed.writes).toEqual(forward.writes);
    expect(forward.writes[0]?.purchase.lines.map(({ externalId, localId }) => ({ externalId, localId }))).toEqual([
      { externalId: "PN-002|BASE-001|cái|1", localId: expect.any(String) },
      { externalId: "PN-002|BASE-001|cái|2", localId: expect.any(String) },
    ]);
    expect(forward.writes[0]?.purchase.lines.map((line) => line.localId).sort()).toEqual([
      "legacy-one-unit",
      "legacy-two-units",
    ]);
  });

  test("reserves mapped child IDs before a legacy fallback can reuse them", () => {
    const duplicateRows = [
      { ...sourceRows[1]!, "Tổng tiền hàng": 2, "Cần trả NCC": 2, "Thành tiền": 1, "Giá nhập": 1, "Ghi chú hàng hóa": "one" },
      { ...sourceRows[1]!, "Tổng tiền hàng": 2, "Cần trả NCC": 2, "Thành tiền": 1, "Giá nhập": 1, "Ghi chú hàng hóa": "two" },
    ];
    const reserved = plan({
      sourceRows: duplicateRows,
      current: [{ localId: "purchase-002", code: "PN-002", fingerprint: "outdated", subtotal: 2, legacyImported: true }],
      lineMappings: [{ externalId: "PN-002|BASE-001|cái|2", localId: "mapped-line" }],
      existingLines: [{
        localId: "mapped-line", purchaseOrderId: "purchase-002", legacyImported: true,
        sourceSku: "BASE-001", unitName: "Cái", quantity: 1, unitCost: 1, discount: 0, total: 1,
      }],
    });
    expect(reserved.blockers).toEqual([]);
    expect(reserved.writes[0]?.purchase.lines).toMatchObject([
      { action: "create", externalId: "PN-002|BASE-001|cái|1" },
      { action: "update", localId: "mapped-line", externalId: "PN-002|BASE-001|cái|2" },
    ]);
  });

  test("blocks ambiguous legacy and invalid mapped line identities instead of duplicating a source child", () => {
    const ambiguous = plan({
      sourceRows: [sourceRows[0]!],
      current: [{ localId: "purchase-001", code: "PN-001", fingerprint: "outdated", subtotal: 1, legacyImported: true }],
      existingLines: ["legacy-a", "legacy-b"].map((localId) => ({
        localId, purchaseOrderId: "purchase-001", legacyImported: true,
        sourceSku: "ALT-001", unitName: "Hộp", quantity: 2, unitCost: 120000,
        discount: 0, total: 240000,
      })),
    });
    expect(ambiguous.writes).toEqual([]);
    expect(ambiguous.blockers).toEqual([{
      documentCode: "PN-001", reference: "PN-001|ALT-001|hộp|1", reason: "ambiguous_legacy_line_match",
    }]);

    const duplicateMapped = plan({
      sourceRows: [sourceRows[0]!],
      current: [{ localId: "purchase-001", code: "PN-001", fingerprint: "outdated", subtotal: 1, legacyImported: true }],
      lineMappings: [{ externalId: "PN-001|ALT-001|hộp|1", localId: "same-line" }],
      existingLines: [{ localId: "same-line", purchaseOrderId: "other-purchase" }],
    });
    expect(duplicateMapped.writes).toEqual([]);
    expect(duplicateMapped.blockers).toEqual([{
      documentCode: "PN-001", reference: "PN-001|ALT-001|hộp|1", reason: "mapped_line_parent_mismatch",
    }]);

    const duplicateRows = [
      { ...sourceRows[1]!, "Tổng tiền hàng": 2, "Cần trả NCC": 2, "Thành tiền": 1, "Giá nhập": 1, "Ghi chú hàng hóa": "one" },
      { ...sourceRows[1]!, "Tổng tiền hàng": 2, "Cần trả NCC": 2, "Thành tiền": 1, "Giá nhập": 1, "Ghi chú hàng hóa": "two" },
    ];
    const duplicateLocalId = plan({
      sourceRows: duplicateRows,
      current: [{ localId: "purchase-002", code: "PN-002", fingerprint: "outdated", subtotal: 2, legacyImported: true }],
      lineMappings: [
        { externalId: "PN-002|BASE-001|cái|1", localId: "same-line" },
        { externalId: "PN-002|BASE-001|cái|2", localId: "same-line" },
      ],
      existingLines: [{ localId: "same-line", purchaseOrderId: "purchase-002" }],
    });
    expect(duplicateLocalId.writes).toEqual([]);
    expect(duplicateLocalId.blockers).toEqual([{
      documentCode: "PN-002", reference: "PN-002|BASE-001|cái|2", reason: "duplicate_local_child_write",
    }]);
  });

  test("blocks unresolved nonblank suppliers, unresolved product units, and Luma-native same-code collisions", () => {
    expect(plan({ resolvedSuppliers: [] }).blockers).toEqual([{
      documentCode: "PN-001", reference: "NCC-001", reason: "unresolved_supplier",
    }]);
    expect(plan({ sourceRows: [sourceRows[0]!], resolvedProducts: [{ ...resolvedProducts[0]!, sourceUnitName: "Thùng" }] }).blockers).toEqual([{
      documentCode: "PN-001", reference: "ALT-001", reason: "unresolved_product_unit",
    }]);
    const collision = plan({
      sourceRows: [sourceRows[1]!],
      current: [{ localId: "luma-purchase", code: "PN-002", fingerprint: "luma", subtotal: 50000, legacyImported: false }],
    });
    expect(collision.writes).toEqual([]);
    expect(collision.entityPlan.conflicts).toEqual([{
      externalId: "PN-002", localId: "luma-purchase", reason: "code_collision",
    }]);
  });

  test("plans the reviewed 1,091 legacy adoptions, 78 creates, 4,611 lines, and 1,089 subtotal repairs without operational effects", () => {
    const receipts = Array.from({ length: 1169 }, (_, index) => {
      const code = `PN-${String(index + 1).padStart(4, "0")}`;
      const lineCount = index < 1104 ? 4 : 3;
      return Array.from({ length: lineCount }, (_, lineIndex) => ({
        ...sourceRows[1]!, "Mã nhập hàng": code, "Tổng tiền hàng": lineCount,
        "Cần trả NCC": lineCount, "Thành tiền": 1, "Giá nhập": 1,
        "Ghi chú hàng hóa": `Line ${lineIndex + 1}`,
      }));
    }).flat();
    const result = plan({
      sourceRows: receipts,
      current: Array.from({ length: 1091 }, (_, index) => ({
        localId: `purchase-${index + 1}`,
        code: `PN-${String(index + 1).padStart(4, "0")}`,
        fingerprint: "legacy", subtotal: index < 1089 ? 0 : 4, legacyImported: true,
      })),
    });

    expect(result.summary).toMatchObject({ documents: 1169, lines: 4611, creates: 78, adopts: 1091, subtotalRepairs: 1089 });
    expect(result.writes).toHaveLength(1169);
    expect(result.writes.every((write) => !("stockReceipts" in write.purchase))).toBe(true);
    expect(result.writes.every((write) => !("stockLots" in write.purchase))).toBe(true);
    expect(result.writes.every((write) => !("stockMovements" in write.purchase))).toBe(true);
    expect(result.writes.every((write) => !("supplierDebtChanges" in write.purchase))).toBe(true);
    expect(result.writes.every((write) => !("cashbookRows" in write.purchase))).toBe(true);
    expect(result.writes.every((write) => !("notifications" in write.purchase))).toBe(true);
  });

  suppliedBundleTest("classifies purchase source units through Task 6 and blocks the unresolved workbook occurrences", () => {
    const source = readKiotVietDataBundle(suppliedBundleDirectory!).sources.find((item) => item.phase === "purchases")!;
    const productWorkbook = XLSX.readFile(join(
      suppliedBundleDirectory!,
      "DanhSachSanPham_KV30082026-224750-732.xlsx",
    ));
    const productSnapshot = parseKiotVietProductRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(
      productWorkbook.Sheets[productWorkbook.SheetNames[0]!],
      { defval: null },
    ));
    const supplierCodes = [...new Set(source.rows.map((row) => String(row["Mã nhà cung cấp"] ?? "").trim()))].filter(Boolean);
    const resolutions = task6StyleWorkbookResolutions(source.rows, productSnapshot);
    const result = plan({
      sourceRows: source.rows,
      resolvedSuppliers: supplierCodes.map((code) => ({ code, supplierId: `supplier:${code}` })),
      resolvedProducts: resolutions.resolvedProducts,
    });

    expect(resolutions).toMatchObject({ currentBase: 4063, alternateUnit: 339, unresolved: 209 });
    expect(result.writes).toEqual([]);
    expect(result.summary).toMatchObject({ documents: 1169, lines: 4402, creates: 1169, unresolvedProducts: 209 });
    expect(result.blockers.filter((blocker) => blocker.reason === "unresolved_product")).toHaveLength(209);
  });
});
