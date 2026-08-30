import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { readKiotVietDataBundle } from "@/lib/kiotviet/data-sync-files";
import { parseKiotVietProductRows } from "@/lib/kiotviet/product-sync";
import { createKiotVietHistoryProductResolver } from "@/lib/kiotviet/history-product-resolver";
import {
  auditKiotVietSaleProductResolutions,
  kiotVietSaleFingerprint,
  planKiotVietSalesSync,
  type KiotVietResolvedSaleProduct,
} from "@/lib/kiotviet/sales-sync";

const sourceRows = [
  {
    "Mã hóa đơn": "HD-001",
    "Mã đặt hàng": "DH-001",
    "Thời gian": "30/08/2026 10:15:00",
    "Mã khách hàng": "KH-001",
    "Ghi chú": "Giao buổi chiều",
    "Tổng tiền hàng": 240000,
    "Giảm giá hóa đơn": 10000,
    VAT: 5000,
    "Thu khác": 3000,
    "Khách cần trả": 238000,
    "Khách đã trả": 38000,
    "Tiền mặt": 8000,
    Thẻ: 0,
    "Chuyển khoản": 30000,
    Ví: 0,
    "Trạng thái": "Hoàn thành",
    "Mã hàng": "ALT-001",
    "Tên hàng": "Sản phẩm hộp",
    ĐVT: "Hộp",
    "Số lượng": 2,
    "Đơn giá": 120000,
    "Giảm giá": 0,
    "Thành tiền": 240000,
    "Ghi chú hàng hóa": "Hàng dễ vỡ",
  },
  {
    "Mã hóa đơn": "HD-001",
    "Mã đặt hàng": "DH-001",
    "Thời gian": "30/08/2026 10:15:00",
    "Mã khách hàng": "KH-001",
    "Ghi chú": "Giao buổi chiều",
    "Tổng tiền hàng": 240000,
    "Giảm giá hóa đơn": 10000,
    VAT: 5000,
    "Thu khác": 3000,
    "Khách cần trả": 238000,
    "Khách đã trả": 38000,
    "Tiền mặt": 8000,
    Thẻ: 0,
    "Chuyển khoản": 30000,
    Ví: 0,
    "Trạng thái": "Hoàn thành",
    "Mã hàng": "ALT-001",
    "Tên hàng": "Sản phẩm hộp",
    ĐVT: "Hộp",
    "Số lượng": 1,
    "Đơn giá": 0,
    "Giảm giá": 0,
    "Thành tiền": 0,
    "Ghi chú hàng hóa": null,
  },
  {
    "Mã hóa đơn": "HD-002",
    "Mã đặt hàng": "",
    "Thời gian": "30/08/2026 11:00:00",
    "Mã khách hàng": "Khách lẻ",
    "Ghi chú": null,
    "Tổng tiền hàng": 50000,
    "Giảm giá hóa đơn": 0,
    VAT: 0,
    "Thu khác": 0,
    "Khách cần trả": 50000,
    "Khách đã trả": 0,
    "Tiền mặt": 0,
    Thẻ: 0,
    "Chuyển khoản": 0,
    Ví: 0,
    "Trạng thái": "Hoàn thành",
    "Mã hàng": "BASE-001",
    "Tên hàng": "Sản phẩm lẻ",
    ĐVT: "Cái",
    "Số lượng": 1,
    "Đơn giá": 50000,
    "Giảm giá": 0,
    "Thành tiền": 50000,
    "Ghi chú hàng hóa": null,
  },
];

const resolvedCustomers = [{ code: "KH-001", customerId: "customer-001" }];
const resolvedProducts = [
  { sku: "ALT-001", productId: "product-001", unitName: "Hộp", sourceUnitName: "Hộp", unitMultiplier: 12, resolutionSource: "alternate_unit" as const },
  { sku: "BASE-001", productId: "product-002", unitName: "Cái", sourceUnitName: "Cái", unitMultiplier: 1, resolutionSource: "current_base" as const },
];

const suppliedBundleDirectory = process.env.KIOTVIET_BUNDLE_DIR;
const suppliedBundleTest = suppliedBundleDirectory ? test : test.skip;

function planSales(input: Partial<Parameters<typeof planKiotVietSalesSync>[0]> = {}) {
  return planKiotVietSalesSync({
    storeId: "store-001",
    sourceRows,
    current: [],
    mappings: [],
    lineMappings: [],
    paymentMappings: [],
    existingLines: [],
    existingPayments: [],
    resolvedCustomers,
    resolvedProducts,
    resolvedBookings: [{ code: "DH-001", bookingId: "booking-001" }],
    ...input,
  });
}

function task6StyleWorkbookResolutions(
  sourceRows: Record<string, unknown>[],
  snapshot: ReturnType<typeof parseKiotVietProductRows>,
): KiotVietResolvedSaleProduct[] {
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
  const resolutionBySourceIdentity = new Map<string, KiotVietResolvedSaleProduct | null>();
  for (const row of sourceRows) {
    const sku = String(row["Mã hàng"] ?? "");
    const sourceUnitName = String(row.ĐVT ?? "");
    const resolution = resolver.resolve({ sku, unitName: sourceUnitName });
    const key = `${sku}\u0000${sourceUnitName.trim().toLocaleLowerCase("vi")}`;
    resolutionBySourceIdentity.set(key, resolution.status === "resolved" ? {
      sku: resolution.sourceSku,
      productId: resolution.productId,
      unitName: resolution.unitName,
      sourceUnitName: resolution.sourceUnitName,
      unitMultiplier: resolution.unitMultiplier,
      resolutionSource: resolution.source,
    } : null);
  }
  return [...resolutionBySourceIdentity.values()]
    .filter((resolution): resolution is KiotVietResolvedSaleProduct => resolution != null);
}

describe("KiotViet sales invoice synchronization", () => {
  test("requires an explicit nonblank store scope", () => {
    expect(() => planKiotVietSalesSync({
      storeId: " ",
      sourceRows: [],
      current: [],
      mappings: [],
      lineMappings: [],
      paymentMappings: [],
      existingLines: [],
      existingPayments: [],
      resolvedCustomers: [],
      resolvedProducts: [],
      resolvedBookings: [],
    })).toThrow("KiotViet sale store ID cannot be blank");
  });

  test("plans completed sale snapshots with exact booking links, anonymous customers, zero-price lines, and mixed payments", () => {
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows,
      current: [],
      mappings: [],
      lineMappings: [],
      paymentMappings: [],
      existingLines: [],
      existingPayments: [],
      resolvedCustomers,
      resolvedProducts,
      resolvedBookings: [{ code: "DH-001", bookingId: "booking-001" }],
    });

    expect(plan.summary).toEqual({
      documents: 2,
      lines: 3,
      payments: 2,
      creates: 2,
      adopts: 0,
      updates: 0,
      unchanged: 0,
      conflicts: 0,
      preserves: 0,
      unresolvedCustomers: 0,
      unresolvedProducts: 0,
      unresolvedBookings: 0,
      preservedLines: 0,
      preservedPayments: 0,
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.writes[0]).toMatchObject({
      action: "create",
      externalId: "HD-001",
      sale: {
        code: "HD-001",
        documentType: "sale",
        status: "completed",
        paymentStatus: "deposit",
        customerId: "customer-001",
        sourceOrderId: "booking-001",
        createdAt: new Date("2026-08-30T03:15:00.000Z"),
        subtotal: 240000,
        discount: 10000,
        tax: 5000,
        shippingFee: 3000,
        total: 238000,
        amountPaid: 38000,
        note: "Giao buổi chiều",
      },
    });
    expect(plan.writes[0]?.sale.lines).toEqual([
      {
        action: "create",
        adoptionMethod: "created",
        externalId: "HD-001|ALT-001|hộp|1",
        line: {
          productId: "product-001",
          sourceSku: "ALT-001",
          productName: "Sản phẩm hộp",
          unitName: "Hộp",
          unitMultiplier: 12,
          quantity: 2,
          unitPrice: 120000,
          discount: 0,
          total: 240000,
          note: "Hàng dễ vỡ",
        },
      },
      {
        action: "create",
        adoptionMethod: "created",
        externalId: "HD-001|ALT-001|hộp|2",
        line: {
          productId: "product-001",
          sourceSku: "ALT-001",
          productName: "Sản phẩm hộp",
          unitName: "Hộp",
          unitMultiplier: 12,
          quantity: 1,
          unitPrice: 0,
          discount: 0,
          total: 0,
          note: null,
        },
      },
    ]);
    expect(plan.writes[0]?.sale.payments).toEqual([
      {
        action: "create",
        adoptionMethod: "created",
        externalId: "HD-001|payment|cash|1",
        payment: { channel: "cash", method: "cash", amount: 8000 },
      },
      {
        action: "create",
        adoptionMethod: "created",
        externalId: "HD-001|payment|bank_transfer|1",
        payment: { channel: "bank_transfer", method: "bank_transfer", amount: 30000 },
      },
    ]);
    expect(plan.writes[1]?.sale).toMatchObject({
      documentType: "sale",
      status: "completed",
      paymentStatus: "unpaid",
      customerId: null,
      sourceOrderId: null,
    });
  });

  test("keeps mapped child IDs and preserves Luma-native child rows while blocking unresolved source identities", () => {
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [sourceRows[0]!],
      current: [{
        localId: "sale-001",
        code: "HD-001",
        fingerprint: "outdated-source-fingerprint",
        legacyImported: true,
      }],
      mappings: [],
      lineMappings: [{ externalId: "HD-001|ALT-001|hộp|1", localId: "line-001" }],
      paymentMappings: [{ externalId: "HD-001|payment|cash|1", localId: "payment-001" }],
      existingLines: [
        { localId: "line-001", orderId: "sale-001" },
        { localId: "luma-line", orderId: "sale-001" },
      ],
      existingPayments: [
        { localId: "payment-001", orderId: "sale-001" },
        { localId: "luma-payment", orderId: "sale-001" },
      ],
      resolvedCustomers,
      resolvedProducts,
      resolvedBookings: [],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.blockers).toEqual([
      { documentCode: "HD-001", reference: "DH-001", reason: "unresolved_booking" },
    ]);

    const reconciled = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [sourceRows[0]!],
      current: [{
        localId: "sale-001",
        code: "HD-001",
        fingerprint: "outdated-source-fingerprint",
        legacyImported: true,
      }],
      mappings: [],
      lineMappings: [{ externalId: "HD-001|ALT-001|hộp|1", localId: "line-001" }],
      paymentMappings: [{ externalId: "HD-001|payment|cash|1", localId: "payment-001" }],
      existingLines: [
        { localId: "line-001", orderId: "sale-001" },
        { localId: "luma-line", orderId: "sale-001" },
      ],
      existingPayments: [
        { localId: "payment-001", orderId: "sale-001" },
        { localId: "luma-payment", orderId: "sale-001" },
      ],
      resolvedCustomers,
      resolvedProducts,
      resolvedBookings: [{ code: "DH-001", bookingId: "booking-001" }],
    });

    expect(reconciled.writes).toMatchObject([{
      action: "adopt",
      localId: "sale-001",
      sale: {
        lines: [
          { action: "update", externalId: "HD-001|ALT-001|hộp|1", localId: "line-001" },
        ],
        payments: [
          { action: "update", externalId: "HD-001|payment|cash|1", localId: "payment-001" },
          { action: "create", externalId: "HD-001|payment|bank_transfer|1" },
        ],
        preservedLineIds: ["luma-line"],
        preservedPaymentIds: ["luma-payment"],
      },
    }]);
    expect(reconciled.entityPlan.preserves).toEqual([]);
    expect(reconciled.summary).toMatchObject({ adopts: 1, preservedLines: 1, preservedPayments: 1 });
  });

  test("adopts exact legacy child snapshots one-to-one before creating invoice children", () => {
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [sourceRows[0]!],
      current: [{
        localId: "sale-001",
        code: "HD-001",
        fingerprint: "outdated-source-fingerprint",
        legacyImported: true,
      }],
      mappings: [],
      lineMappings: [],
      paymentMappings: [],
      existingLines: [
        {
          localId: "legacy-line",
          orderId: "sale-001",
          sourceSku: "ALT-001",
          productId: "product-001",
          productName: "Sản phẩm hộp",
          unitName: "Hộp",
          unitMultiplier: 12,
          quantity: 2,
          unitPrice: 120000,
          discount: 0,
          total: 240000,
          note: "Hàng dễ vỡ",
          legacyImported: true,
        },
        {
          localId: "luma-line",
          orderId: "sale-001",
          productId: "luma-product",
          productName: "Luma-native row",
          unitName: "Cái",
          unitMultiplier: 1,
          quantity: 1,
          unitPrice: 1,
          discount: 0,
          total: 1,
          note: null,
          legacyImported: false,
        },
      ],
      existingPayments: [
        { localId: "legacy-cash", orderId: "sale-001", method: "cash", amount: 8000, legacyImported: true },
        { localId: "legacy-bank", orderId: "sale-001", method: "bank_transfer", amount: 30000, legacyImported: true },
        { localId: "luma-payment", orderId: "sale-001", method: "card", amount: 12, legacyImported: false },
      ],
      resolvedCustomers,
      resolvedProducts,
      resolvedBookings: [{ code: "DH-001", bookingId: "booking-001" }],
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.writes[0]?.sale.lines).toMatchObject([
      { action: "adopt", adoptionMethod: "legacy_adopted", externalId: "HD-001|ALT-001|hộp|1", localId: "legacy-line" },
    ]);
    expect(plan.writes[0]?.sale.payments).toMatchObject([
      { action: "adopt", adoptionMethod: "legacy_adopted", externalId: "HD-001|payment|cash|1", localId: "legacy-cash" },
      { action: "adopt", adoptionMethod: "legacy_adopted", externalId: "HD-001|payment|bank_transfer|1", localId: "legacy-bank" },
    ]);
    expect(plan.writes[0]?.sale.preservedLineIds).toEqual(["luma-line"]);
    expect(plan.writes[0]?.sale.preservedPaymentIds).toEqual(["luma-payment"]);
  });

  test("backfills child provenance for an exact bootstrap parent while preserving unrelated Luma children", () => {
    const source = planKiotVietSalesSync({
      storeId: "store-001", sourceRows: [sourceRows[0]!], current: [], mappings: [], lineMappings: [], paymentMappings: [],
      existingLines: [], existingPayments: [], resolvedCustomers, resolvedProducts,
      resolvedBookings: [{ code: "DH-001", bookingId: "booking-001" }],
    }).sales[0]!;
    const plan = planKiotVietSalesSync({
      storeId: "store-001", sourceRows: [sourceRows[0]!],
      current: [{ localId: "sale-bootstrap", code: "HD-001", fingerprint: kiotVietSaleFingerprint(source), legacyImported: false }],
      mappings: [], lineMappings: [], paymentMappings: [],
      existingLines: [{ ...source.lines[0]!, localId: "legacy-line", orderId: "sale-bootstrap", legacyImported: false, legacyAdoptionEligible: true },
        { localId: "luma-line", orderId: "sale-bootstrap", legacyImported: false }],
      existingPayments: source.payments.map((payment, index) => ({
        ...payment, localId: `legacy-payment-${index}`, orderId: "sale-bootstrap", legacyImported: false, legacyAdoptionEligible: true,
      })),
      resolvedCustomers, resolvedProducts, resolvedBookings: [{ code: "DH-001", bookingId: "booking-001" }],
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ action: "adopt", externalId: "HD-001", localId: "sale-bootstrap" });
    expect(plan.writes[0]?.sale.lines[0]).toMatchObject({
      action: "adopt", adoptionMethod: "legacy_adopted", localId: "legacy-line",
    });
    expect(plan.writes[0]?.sale.preservedLineIds).toEqual(["luma-line"]);
  });

  test("adopts the legacy importer alternate-unit placeholder and aggregate payment without duplication", () => {
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [sourceRows[0]!],
      current: [{
        localId: "sale-001",
        code: "HD-001",
        fingerprint: "outdated-source-fingerprint",
        legacyImported: true,
      }],
      mappings: [],
      lineMappings: [],
      paymentMappings: [],
      existingLines: [{
        localId: "legacy-alt-line",
        orderId: "sale-001",
        legacyImported: true,
        sourceSku: "ALT-001",
        productId: "historical-placeholder-product",
        productName: "Sản phẩm hộp",
        unitName: "Hộp",
        unitMultiplier: 1,
        quantity: 2,
        unitPrice: 120000,
        discount: 0,
        total: 240000,
        note: "Hàng dễ vỡ",
      }],
      existingPayments: [{
        localId: "legacy-aggregate-bank",
        orderId: "sale-001",
        legacyImported: true,
        method: "bank_transfer",
        amount: 38000,
        note: "Import lịch sử KiotViet",
      }],
      resolvedCustomers,
      resolvedProducts,
      resolvedBookings: [{ code: "DH-001", bookingId: "booking-001" }],
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.writes[0]?.sale.lines).toMatchObject([
      { action: "adopt", adoptionMethod: "legacy_adopted", externalId: "HD-001|ALT-001|hộp|1", localId: "legacy-alt-line" },
    ]);
    expect(plan.writes[0]?.sale.payments).toMatchObject([
      { action: "create", adoptionMethod: "created", externalId: "HD-001|payment|cash|1" },
      { action: "adopt", adoptionMethod: "legacy_adopted", externalId: "HD-001|payment|bank_transfer|1", localId: "legacy-aggregate-bank" },
    ]);
    expect(plan.writes[0]?.sale.preservedLineIds).toEqual([]);
    expect(plan.writes[0]?.sale.preservedPaymentIds).toEqual([]);
  });

  test("reserves every mapped child ID before legacy fallback adoption", () => {
    const duplicateHeader = {
      ...sourceRows[2]!,
      "Tổng tiền hàng": 2,
      "Khách cần trả": 2,
      "Thành tiền": 1,
      "Đơn giá": 1,
      "Ghi chú hàng hóa": "occurrence one",
    };
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [
        duplicateHeader,
        { ...duplicateHeader, "Ghi chú hàng hóa": "occurrence two" },
      ],
      current: [{
        localId: "sale-002",
        code: "HD-002",
        fingerprint: "outdated-source-fingerprint",
        legacyImported: true,
      }],
      mappings: [],
      lineMappings: [{ externalId: "HD-002|BASE-001|cái|2", localId: "mapped-line" }],
      paymentMappings: [],
      existingLines: [{
        localId: "mapped-line",
        orderId: "sale-002",
        legacyImported: true,
        sourceSku: "BASE-001",
        productId: "product-002",
        productName: "Sản phẩm lẻ",
        unitName: "Cái",
        unitMultiplier: 1,
        quantity: 1,
        unitPrice: 1,
        discount: 0,
        total: 1,
        note: "occurrence one",
      }],
      existingPayments: [],
      resolvedCustomers,
      resolvedProducts,
      resolvedBookings: [],
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.writes[0]?.sale.lines).toMatchObject([
      { action: "create", externalId: "HD-002|BASE-001|cái|1" },
      { action: "update", externalId: "HD-002|BASE-001|cái|2", localId: "mapped-line" },
    ]);
  });

  test("blocks duplicate mapped local child IDs instead of emitting two writes", () => {
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [sourceRows[0]!],
      current: [{
        localId: "sale-001",
        code: "HD-001",
        fingerprint: "outdated-source-fingerprint",
        legacyImported: true,
      }],
      mappings: [],
      lineMappings: [],
      paymentMappings: [
        { externalId: "HD-001|payment|cash|1", localId: "duplicate-payment" },
        { externalId: "HD-001|payment|bank_transfer|1", localId: "duplicate-payment" },
      ],
      existingLines: [],
      existingPayments: [{ localId: "duplicate-payment", orderId: "sale-001" }],
      resolvedCustomers,
      resolvedProducts,
      resolvedBookings: [{ code: "DH-001", bookingId: "booking-001" }],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.blockers).toEqual([{
      documentCode: "HD-001",
      reference: "HD-001|payment|bank_transfer|1",
      reason: "duplicate_local_child_write",
    }]);
  });

  test("preserves a normalized source unit after the catalog unit is renamed", () => {
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [{ ...sourceRows[2]!, ĐVT: " Cây cũ " }],
      current: [],
      mappings: [],
      lineMappings: [],
      paymentMappings: [],
      existingLines: [],
      existingPayments: [],
      resolvedCustomers,
      resolvedProducts: [{
        sku: "BASE-001",
        productId: "product-002",
        unitName: "Cây mới",
        sourceUnitName: "Cây cũ",
        unitMultiplier: 1,
        resolutionSource: "archived_mapping",
      }],
      resolvedBookings: [],
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.writes[0]?.sale.lines).toMatchObject([{
      externalId: "HD-002|BASE-001|cây cũ|1",
      line: { unitName: "Cây cũ", unitMultiplier: 1 },
    }]);
  });

  test("blocks a source unit that disagrees with an explicit Task 6 resolution", () => {
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [{ ...sourceRows[2]!, ĐVT: "Cây cũ" }],
      current: [],
      mappings: [],
      lineMappings: [],
      paymentMappings: [],
      existingLines: [],
      existingPayments: [],
      resolvedCustomers,
      resolvedProducts: [{
        sku: "BASE-001",
        productId: "product-002",
        unitName: "Cây mới",
        sourceUnitName: "Hộp đã phê duyệt",
        unitMultiplier: 1,
        resolutionSource: "archived_mapping",
      }],
      resolvedBookings: [],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.blockers).toEqual([{
      documentCode: "HD-002",
      reference: "BASE-001",
      reason: "unresolved_product_unit",
    }]);
  });

  test("blocks ambiguous exact legacy child matches instead of reusing either ID", () => {
    const legacyLine = {
      orderId: "sale-001",
      sourceSku: "ALT-001",
      productId: "product-001",
      productName: "Sản phẩm hộp",
      unitName: "Hộp",
      unitMultiplier: 12,
      quantity: 2,
      unitPrice: 120000,
      discount: 0,
      total: 240000,
      note: "Hàng dễ vỡ",
      legacyImported: true,
    };
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [sourceRows[0]!],
      current: [{
        localId: "sale-001",
        code: "HD-001",
        fingerprint: "outdated-source-fingerprint",
        legacyImported: true,
      }],
      mappings: [],
      lineMappings: [],
      paymentMappings: [],
      existingLines: [
        { localId: "legacy-line-a", ...legacyLine },
        { localId: "legacy-line-b", ...legacyLine },
      ],
      existingPayments: [],
      resolvedCustomers,
      resolvedProducts,
      resolvedBookings: [{ code: "DH-001", bookingId: "booking-001" }],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.blockers).toEqual([{
      documentCode: "HD-001",
      reference: "HD-001|ALT-001|hộp|1",
      reason: "ambiguous_legacy_line_match",
    }]);
  });

  test("blocks same-code collisions instead of adopting a Luma-native order", () => {
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [sourceRows[2]!],
      current: [{
        localId: "luma-sale",
        code: "HD-002",
        fingerprint: "unrelated-luma-fingerprint",
        legacyImported: false,
      }],
      mappings: [],
      lineMappings: [],
      paymentMappings: [],
      existingLines: [],
      existingPayments: [],
      resolvedCustomers,
      resolvedProducts,
      resolvedBookings: [],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.entityPlan.conflicts).toEqual([{
      externalId: "HD-002",
      localId: "luma-sale",
      reason: "code_collision",
    }]);
  });

  test("preserves only returned lifecycle status and repairs other mapped sale drift", () => {
    const source = planSales({ sourceRows: [sourceRows[0]!] }).sales[0]!;
    const completedFingerprint = kiotVietSaleFingerprint(source);
    const returned = planSales({
      sourceRows: [sourceRows[0]!],
      current: [{
        localId: "sale-001", code: source.code, status: "returned",
        fingerprint: "actual-returned-fingerprint", completedFingerprint, legacyImported: true,
      }],
      mappings: [{ externalId: source.code, localId: "sale-001" }],
      lineMappings: source.lines.map((line, index) => ({
        externalId: line.externalId, localId: `line-${index}`,
      })),
      paymentMappings: source.payments.map((payment, index) => ({
        externalId: payment.externalId, localId: `payment-${index}`,
      })),
      existingLines: source.lines.map((_, index) => ({ localId: `line-${index}`, orderId: "sale-001" })),
      existingPayments: source.payments.map((_, index) => ({ localId: `payment-${index}`, orderId: "sale-001" })),
    });
    expect(returned.entityPlan.unchanged).toEqual([{ externalId: source.code, localId: "sale-001" }]);
    expect(returned.writes).toEqual([]);

    const draft = planSales({
      sourceRows: [sourceRows[0]!],
      current: [{
        localId: "sale-001", code: source.code, status: "draft",
        fingerprint: "actual-draft-fingerprint", completedFingerprint, legacyImported: true,
      }],
      mappings: [{ externalId: source.code, localId: "sale-001" }],
    });
    expect(draft.entityPlan.updates).toEqual([{ externalId: source.code, localId: "sale-001" }]);
    expect(draft.writes[0]).toMatchObject({ action: "update", localId: "sale-001" });
  });

  test("blocks a child mapping whose parent invoice cannot be safely adopted", () => {
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: [sourceRows[2]!],
      current: [],
      mappings: [],
      lineMappings: [{ externalId: "HD-002|BASE-001|cái|1", localId: "line-orphan" }],
      paymentMappings: [],
      existingLines: [{ localId: "line-orphan", orderId: "other-sale" }],
      existingPayments: [],
      resolvedCustomers,
      resolvedProducts,
      resolvedBookings: [],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.blockers).toEqual([{
      documentCode: "HD-002",
      reference: "HD-002|BASE-001|cái|1",
      reason: "mapped_line_parent_mismatch",
    }]);
  });

  test("plans the reviewed 2,640 legacy adoptions and 199 missing invoices across 9,305 source lines", () => {
    const invoices = Array.from({ length: 2839 }, (_, index) => {
      const code = `HD-${String(index + 1).padStart(4, "0")}`;
      const lineCount = index < 788 ? 4 : 3;
      return Array.from({ length: lineCount }, (_, lineIndex) => ({
        "Mã hóa đơn": code,
        "Mã đặt hàng": "",
        "Thời gian": "30/08/2026 11:00:00",
        "Mã khách hàng": "Khách lẻ",
        "Ghi chú": null,
        "Tổng tiền hàng": lineCount,
        "Giảm giá hóa đơn": 0,
        VAT: 0,
        "Thu khác": 0,
        "Khách cần trả": lineCount,
        "Khách đã trả": 0,
        "Tiền mặt": 0,
        Thẻ: 0,
        "Chuyển khoản": 0,
        Ví: 0,
        "Trạng thái": "Hoàn thành",
        "Mã hàng": "BASE-001",
        "Tên hàng": "Sản phẩm lẻ",
        ĐVT: "Cái",
        "Số lượng": 1,
        "Đơn giá": 1,
        "Giảm giá": 0,
        "Thành tiền": 1,
        "Ghi chú hàng hóa": `Dòng ${lineIndex + 1}`,
      }));
    }).flat();
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: invoices,
      current: Array.from({ length: 2640 }, (_, index) => ({
        localId: `sale-${index + 1}`,
        code: `HD-${String(index + 1).padStart(4, "0")}`,
        fingerprint: "legacy-fingerprint",
        legacyImported: true,
      })),
      mappings: [],
      lineMappings: [],
      paymentMappings: [],
      existingLines: [],
      existingPayments: [],
      resolvedCustomers: [],
      resolvedProducts: [{
        sku: "BASE-001",
        productId: "product-002",
        unitName: "Cái",
        sourceUnitName: "Cái",
        unitMultiplier: 1,
        resolutionSource: "current_base",
      }],
      resolvedBookings: [],
    });

    expect(plan.summary).toMatchObject({
      documents: 2839,
      lines: 9305,
      creates: 199,
      adopts: 2640,
      conflicts: 0,
    });
    expect(plan.writes).toHaveLength(2839);
    expect(plan.writes.filter((write) => write.action === "adopt")).toHaveLength(2640);
    expect(plan.writes.filter((write) => write.action === "create")).toHaveLength(199);
  });

  suppliedBundleTest("blocks the workbook's 374 missing-master occurrences until Task 6 evidence resolves them", () => {
    const source = readKiotVietDataBundle(suppliedBundleDirectory!).sources
      .find((candidate) => candidate.phase === "sales")!;
    const productWorkbook = XLSX.readFile(join(
      suppliedBundleDirectory!,
      "DanhSachSanPham_KV30082026-224750-732.xlsx",
    ));
    const productSnapshot = parseKiotVietProductRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(
      productWorkbook.Sheets[productWorkbook.SheetNames[0]!],
      { defval: null },
    ));
    const plan = planKiotVietSalesSync({
      storeId: "store-001",
      sourceRows: source.rows,
      current: [],
      mappings: [],
      lineMappings: [],
      paymentMappings: [],
      existingLines: [],
      existingPayments: [],
      resolvedCustomers: [...new Set(source.rows.map((row) => String(row["Mã khách hàng"] ?? "").trim()))]
        .filter((code) => code && code !== "Khách lẻ")
        .map((code) => ({ code, customerId: `customer:${code}` })),
      resolvedProducts: task6StyleWorkbookResolutions(source.rows, productSnapshot),
      resolvedBookings: [...new Set(source.rows.map((row) => String(row["Mã đặt hàng"] ?? "").trim()))]
        .filter(Boolean)
        .map((code) => ({ code, bookingId: `booking:${code}` })),
    });

    expect(plan.writes).toEqual([]);
    expect(plan.summary).toMatchObject({ documents: 2839, lines: 8931, creates: 2839, unresolvedProducts: 374 });
    expect(plan.blockers.filter((blocker) => blocker.reason === "unresolved_product")).toHaveLength(374);
  });

  suppliedBundleTest("audits 374 missing-master occurrences as unresolved without archived or approved evidence", () => {
    const source = readKiotVietDataBundle(suppliedBundleDirectory!).sources
      .find((candidate) => candidate.phase === "sales")!;
    const productWorkbook = XLSX.readFile(join(
      suppliedBundleDirectory!,
      "DanhSachSanPham_KV30082026-224750-732.xlsx",
    ));
    const productRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      productWorkbook.Sheets[productWorkbook.SheetNames[0]!],
      { defval: null },
    );
    const productSnapshot = parseKiotVietProductRows(productRows);
    const resolvedProducts = task6StyleWorkbookResolutions(source.rows, productSnapshot);

    expect(auditKiotVietSaleProductResolutions({ sourceRows: source.rows, resolvedProducts }).summary).toEqual({
      referenceCount: 9305,
      currentBaseOccurrences: 8273,
      alternateUnitOccurrences: 658,
      archivedMappingOccurrences: 0,
      approvedPlaceholderOccurrences: 0,
      missingMasterOccurrences: 374,
      missingMasterSkuCount: 137,
      unresolvedOccurrences: 374,
    });
  });
});
