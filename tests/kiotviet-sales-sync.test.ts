import { describe, expect, test } from "bun:test";
import { readKiotVietDataBundle } from "@/lib/kiotviet/data-sync-files";
import { planKiotVietSalesSync } from "@/lib/kiotviet/sales-sync";

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
  { sku: "ALT-001", productId: "product-001", unitName: "Hộp", unitMultiplier: 12 },
  { sku: "BASE-001", productId: "product-002", unitName: "Cái", unitMultiplier: 1 },
];

const suppliedBundleDirectory = process.env.KIOTVIET_BUNDLE_DIR;
const suppliedBundleTest = suppliedBundleDirectory ? test : test.skip;

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
        externalId: "HD-001|payment|cash|1",
        payment: { channel: "cash", method: "cash", amount: 8000 },
      },
      {
        action: "create",
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
      resolvedProducts: [{ sku: "BASE-001", productId: "product-002", unitName: "Cái", unitMultiplier: 1 }],
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

  suppliedBundleTest("plans the reviewed workbook's 2,839 source invoices and 9,305 source lines without operational actions", () => {
    const source = readKiotVietDataBundle(suppliedBundleDirectory!).sources
      .find((candidate) => candidate.phase === "sales")!;
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
      resolvedProducts: [...new Map(source.rows.map((row) => {
        const sku = String(row["Mã hàng"]);
        return [sku, { sku, productId: `product:${sku}`, unitName: String(row.ĐVT), unitMultiplier: 1 }];
      })).values()],
      resolvedBookings: [...new Set(source.rows.map((row) => String(row["Mã đặt hàng"] ?? "").trim()))]
        .filter(Boolean)
        .map((code) => ({ code, bookingId: `booking:${code}` })),
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.summary).toMatchObject({ documents: 2839, lines: 9305, creates: 2839 });
    expect(plan.writes.every((write) => write.sale.documentType === "sale")).toBe(true);
    expect(plan.writes.some((write) => "stockMovements" in write.sale)).toBe(false);
    expect(plan.writes.some((write) => "cashbookRows" in write.sale)).toBe(false);
    expect(plan.writes.some((write) => "debtChanges" in write.sale)).toBe(false);
    expect(plan.writes.some((write) => "eInvoice" in write.sale)).toBe(false);
    expect(plan.writes.some((write) => "shiftId" in write.sale)).toBe(false);
    expect(plan.writes.some((write) => "notifications" in write.sale)).toBe(false);
  });
});
