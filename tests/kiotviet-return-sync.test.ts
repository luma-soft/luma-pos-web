import { describe, expect, test } from "bun:test";
import { readKiotVietDataBundle } from "@/lib/kiotviet/data-sync-files";
import { groupKiotVietDocumentRows, normalizeKiotVietNumber, normalizeKiotVietText } from "@/lib/kiotviet/data-sync-plan";
import { planKiotVietReturnSync } from "@/lib/kiotviet/return-sync";

const sourceRows = [
  {
    "Mã trả hàng": "TH-001",
    "Mã hóa đơn": "HD-001",
    "Thời gian": "30/08/2026 10:15:00",
    "Ghi chú": "Hàng lỗi",
    "Tổng tiền hàng trả": 200000,
    "Giảm giá phiếu trả": 10000,
    "VAT hoàn lại": 5000,
    "Thu khác hoàn lại": 3000,
    "Phí trả hàng": 2000,
    "Cần trả khách": 196000,
    "Đã trả khách": 50000,
    "Tiền mặt": 50000,
    "Thẻ": 0,
    "Chuyển khoản": 0,
    "Ví": 0,
    "Điểm": 0,
    "Trạng thái": "Đã trả",
    "Mã hàng": "ALT-001",
    "Tên hàng": "Sản phẩm hộp",
    ĐVT: "Hộp",
    "Số lượng": 2,
    "Giá nhập lại": 100000,
  },
];

const products = [{
  sku: "ALT-001",
  productId: "product-001",
  unitName: "Hộp",
  sourceUnitName: "Hộp",
  unitMultiplier: 12,
  resolutionSource: "alternate_unit" as const,
}];
const suppliedBundleDirectory = process.env.KIOTVIET_BUNDLE_DIR;
const suppliedBundleTest = suppliedBundleDirectory ? test : test.skip;

const sales = [{
  invoiceCode: "HD-001",
  orderId: "order-001",
  customerId: "customer-001",
  status: "completed" as const,
  items: [{
    localId: "sale-line-001",
    sourceSku: "ALT-001",
    unitName: "Hộp",
    quantity: 2,
  }],
}];

function plan(input: Partial<Parameters<typeof planKiotVietReturnSync>[0]> = {}) {
  return planKiotVietReturnSync({
    storeId: "store-001",
    sourceRows,
    current: [],
    mappings: [],
    lineMappings: [],
    existingLines: [],
    resolvedProducts: products,
    sales,
    ...input,
  });
}

describe("KiotViet customer return synchronization", () => {
  test("links an exact invoice and sale item, preserves settlement snapshots, and repairs a fully returned sale", () => {
    const result = plan();

    expect(result.blockers).toEqual([]);
    expect(result.linkageExceptions).toEqual([]);
    expect(result.summary).toMatchObject({
      documents: 1,
      lines: 1,
      creates: 1,
      partialReturns: 0,
      linkedInvoices: 1,
      linkedItems: 1,
    });
    expect(result.writes).toEqual([{
      action: "create",
      externalId: "TH-001",
      return: {
        code: "TH-001",
        invoiceCode: "HD-001",
        orderId: "order-001",
        customerId: "customer-001",
        status: "completed",
        createdAt: new Date("2026-08-30T03:15:00.000Z"),
        subtotal: 200000,
        discount: 10000,
        tax: 5000,
        otherRefund: 3000,
        returnFee: 2000,
        totalRefund: 196000,
        refundAmount: 50000,
        settlementStatus: "partial",
        note: "Hàng lỗi",
        paymentSnapshots: [{ channel: "cash", amount: 50000 }],
        lines: [{
          action: "create",
          externalId: "TH-001|ALT-001|hộp|1",
          line: {
            orderItemId: "sale-line-001",
            productId: "product-001",
            sourceSku: "ALT-001",
            productName: "Sản phẩm hộp",
            unitName: "Hộp",
            unitMultiplier: 12,
            quantity: 2,
            unitPrice: 100000,
            total: 200000,
            restock: false,
          },
        }],
        preservedLineIds: [],
      },
    }]);
    expect(result.saleStatusUpdates).toEqual([{ orderId: "order-001", status: "returned" }]);
  });

  test("keeps a missing invoice and its item unlinked as an inspectable historical exception", () => {
    const result = plan({
      sourceRows: [{ ...sourceRows[0]!, "Mã trả hàng": "TH-404", "Mã hóa đơn": "HD-MISSING" }],
      sales: [],
    });

    expect(result.blockers).toEqual([]);
    expect(result.linkageExceptions).toEqual([{
      documentCode: "TH-404", reference: "HD-MISSING", reason: "missing_invoice",
    }]);
    expect(result.writes[0]?.return).toMatchObject({
      invoiceCode: "HD-MISSING",
      orderId: null,
      customerId: null,
      lines: [{ line: { orderItemId: null, restock: false } }],
    });
  });

  test("reports a blank invoice as an unlinked historical exception", () => {
    const result = plan({
      sourceRows: [{ ...sourceRows[0]!, "Mã trả hàng": "TH-NO-INVOICE", "Mã hóa đơn": "" }],
    });

    expect(result.linkageExceptions).toEqual([{
      documentCode: "TH-NO-INVOICE", reference: "__blank_invoice__", reason: "missing_invoice",
    }]);
    expect(result.writes[0]?.return.orderId).toBeNull();
  });

  test("keeps cumulative partial returns completed and repairs an incorrectly returned sale", () => {
    const partialRow = (code: string) => ({
      ...sourceRows[0]!,
      "Mã trả hàng": code,
      "Tổng tiền hàng trả": 100000,
      "Giảm giá phiếu trả": 0,
      "VAT hoàn lại": 0,
      "Thu khác hoàn lại": 0,
      "Phí trả hàng": 0,
      "Cần trả khách": 100000,
      "Đã trả khách": 0,
      "Tiền mặt": 0,
      "Số lượng": 1,
    });
    const result = plan({
      sourceRows: [partialRow("TH-002"), partialRow("TH-003")],
      sales: [{ ...sales[0]!, status: "returned", items: [{ ...sales[0]!.items[0]!, quantity: 3 }] }],
    });

    expect(result.blockers).toEqual([]);
    expect(result.summary.partialReturns).toBe(2);
    expect(result.saleStatusUpdates).toEqual([{ orderId: "order-001", status: "completed" }]);
  });

  test("removes a cancelled return's former quantity before recomputing its parent sale", () => {
    const result = plan({
      sourceRows: [{ ...sourceRows[0]!, "Trạng thái": "Đã hủy" }],
      current: [{ localId: "return-001", code: "TH-001", fingerprint: "outdated", legacyImported: true }],
      existingLines: [{
        localId: "legacy-return-line",
        returnId: "return-001",
        active: true,
        legacyImported: true,
        legacyProductSku: "ALT-001",
        orderItemId: "sale-line-001",
        quantity: 2,
        unitPrice: 100000,
        total: 200000,
      }],
      sales: [{ ...sales[0]!, status: "returned" }],
    });

    expect(result.blockers).toEqual([]);
    expect(result.writes[0]?.return.status).toBe("cancelled");
    expect(result.saleStatusUpdates).toEqual([{ orderId: "order-001", status: "completed" }]);
  });

  test("adopts the actual legacy item shape and preserves Luma-native return children", () => {
    const result = plan({
      current: [{ localId: "return-001", code: "TH-001", fingerprint: "outdated", legacyImported: true }],
      existingLines: [
        {
          localId: "legacy-return-line",
          returnId: "return-001",
          legacyImported: true,
          legacyProductSku: "ALT-001",
          quantity: 2,
          unitPrice: 100000,
          total: 200000,
        },
        { localId: "luma-return-line", returnId: "return-001", legacyImported: false },
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(result.writes[0]).toMatchObject({
      action: "adopt",
      localId: "return-001",
      return: {
        lines: [{ action: "update", localId: "legacy-return-line" }],
        preservedLineIds: ["luma-return-line"],
      },
    });
    expect(result.preservedLineIds).toEqual(["luma-return-line"]);
  });

  test("assigns duplicate source occurrences deterministically regardless of worksheet row order", () => {
    const second = {
      ...sourceRows[0]!,
      "Tổng tiền hàng trả": 400000,
      "Cần trả khách": 396000,
      "Tên hàng": "Sản phẩm hộp B",
    };
    const first = { ...second, "Tên hàng": "Sản phẩm hộp A" };
    const input = {
      sourceRows: [first, second],
      sales: [{ ...sales[0]!, items: [{ ...sales[0]!.items[0]!, quantity: 4 }] }],
    };

    const forward = plan(input);
    const reverse = plan({ ...input, sourceRows: [...input.sourceRows].reverse() });

    expect(reverse.returns).toEqual(forward.returns);
    expect(reverse.writes).toEqual(forward.writes);
  });

  test("emits direct ledger snapshots without operational refund or inventory side effects", () => {
    const result = plan();
    const snapshot = result.writes[0]!.return as Record<string, unknown>;

    expect(snapshot).not.toHaveProperty("stockReceipts");
    expect(snapshot).not.toHaveProperty("stockLots");
    expect(snapshot).not.toHaveProperty("stockMovements");
    expect(snapshot).not.toHaveProperty("operationalRefunds");
    expect(snapshot).not.toHaveProperty("customerDebtChanges");
    expect(snapshot).not.toHaveProperty("cashbookRows");
    expect(snapshot).not.toHaveProperty("notifications");
    expect(result.writes[0]!.return.lines.every((line) => line.line.restock === false)).toBe(true);
  });

  test("plans the reviewed 104 legacy adoptions, 9 creates, 440 lines, 70 partial returns, and 63 parent repairs", () => {
    const documents = Array.from({ length: 113 }, (_, index) => {
      const documentNumber = index + 1;
      const lineCount = index < 101 ? 4 : 3;
      const code = `TH-${String(documentNumber).padStart(3, "0")}`;
      const invoiceCode = `HD-${String(documentNumber).padStart(3, "0")}`;
      return Array.from({ length: lineCount }, () => ({
        "Mã trả hàng": code,
        "Mã hóa đơn": invoiceCode,
        "Thời gian": "30/08/2026 10:15:00",
        "Ghi chú": null,
        "Tổng tiền hàng trả": lineCount,
        "Giảm giá phiếu trả": 0,
        "VAT hoàn lại": 0,
        "Thu khác hoàn lại": 0,
        "Phí trả hàng": 0,
        "Cần trả khách": lineCount,
        "Đã trả khách": 0,
        "Tiền mặt": 0,
        "Thẻ": 0,
        "Chuyển khoản": 0,
        "Ví": 0,
        "Điểm": 0,
        "Trạng thái": "Đã trả",
        "Mã hàng": "BULK-001",
        "Tên hàng": "Hàng lịch sử",
        ĐVT: "Cái",
        "Số lượng": 1,
        "Giá nhập lại": 1,
      }));
    }).flat();
    const result = plan({
      sourceRows: documents,
      current: Array.from({ length: 104 }, (_, index) => ({
        localId: `return-${index + 1}`,
        code: `TH-${String(index + 1).padStart(3, "0")}`,
        fingerprint: "legacy",
        legacyImported: true,
      })),
      resolvedProducts: [{
        sku: "BULK-001", productId: "bulk-product", unitName: "Cái", sourceUnitName: "Cái",
        unitMultiplier: 1, resolutionSource: "current_base",
      }],
      sales: Array.from({ length: 113 }, (_, index) => {
        const documentNumber = index + 1;
        const lineCount = index < 101 ? 4 : 3;
        const partial = index < 70;
        return {
          invoiceCode: `HD-${String(documentNumber).padStart(3, "0")}`,
          orderId: `order-${documentNumber}`,
          customerId: null,
          status: !partial || index < 63 ? "returned" as const : "completed" as const,
          items: [{ localId: `sale-line-${documentNumber}`, sourceSku: "BULK-001", unitName: "Cái", quantity: partial ? lineCount + 1 : lineCount }],
        };
      }),
    });

    expect(result.blockers).toEqual([]);
    expect(result.summary).toMatchObject({ documents: 113, lines: 440, adopts: 104, creates: 9, partialReturns: 70, parentStatusUpdates: 63 });
    expect(result.writes).toHaveLength(113);
    expect(result.saleStatusUpdates).toHaveLength(63);
  });

  suppliedBundleTest("preserves the supplied return export's aggregate source facts without exposing customer data", () => {
    const bundle = readKiotVietDataBundle(suppliedBundleDirectory!);
    const returnSource = bundle.sources.find((source) => source.phase === "returns")!;
    const saleSource = bundle.sources.find((source) => source.phase === "sales")!;
    const returnGroups = groupKiotVietDocumentRows(returnSource.rows, {
      codeColumn: "Mã trả hàng",
      consistentHeaderColumns: [],
    });
    const saleCodes = new Set(groupKiotVietDocumentRows(saleSource.rows, {
      codeColumn: "Mã hóa đơn",
      consistentHeaderColumns: [],
    }).map((group) => group.externalId));
    const settlement = { unsettled: 0, partial: 0, settled: 0 };
    for (const group of returnGroups) {
      const header = group.rows[0]!;
      const payable = normalizeKiotVietNumber(header["Cần trả khách"]);
      const paid = Math.abs(normalizeKiotVietNumber(header["Đã trả khách"]));
      if (payable <= 0 || paid >= payable) settlement.settled += 1;
      else if (paid > 0) settlement.partial += 1;
      else settlement.unsettled += 1;
    }

    expect({ documents: returnGroups.length, lines: returnSource.rows.length }).toEqual({ documents: 113, lines: 440 });
    expect(returnGroups.filter((group) => !saleCodes.has(normalizeKiotVietText(group.rows[0]!["Mã hóa đơn"])))).toHaveLength(38);
    expect(settlement).toEqual({ unsettled: 74, partial: 0, settled: 39 });
  });
});
