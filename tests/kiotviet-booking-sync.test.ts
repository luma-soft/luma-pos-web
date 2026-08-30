import { describe, expect, test } from "bun:test";
import { readKiotVietDataBundle } from "@/lib/kiotviet/data-sync-files";
import { planKiotVietBookingSync } from "@/lib/kiotviet/booking-sync";
import { bookingStatusOptions, resolveBookingStatus } from "@/lib/orders/booking-status-filter";

const sourceRows = [
  {
    "Mã đặt hàng": "DH-001",
    "Thời gian": "30/08/2026 10:15:00",
    "Thời gian giao hàng": "31/08/2026 14:30:00",
    "Mã khách hàng": "KH-001",
    "Ghi chú": "Giao buổi chiều",
    "Tổng tiền hàng": 240000,
    "Giảm giá phiếu đặt": 10000,
    VAT: 5000,
    "Thu khác": 3000,
    "Khách cần trả": 238000,
    "Khách đã trả": 38000,
    "Tiền mặt": 8000,
    Thẻ: 0,
    "Chuyển khoản": 30000,
    Ví: 0,
    Điểm: 0,
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
    "Mã đặt hàng": "DH-001",
    "Thời gian": "30/08/2026 10:15:00",
    "Thời gian giao hàng": "31/08/2026 14:30:00",
    "Mã khách hàng": "KH-001",
    "Ghi chú": "Giao buổi chiều",
    "Tổng tiền hàng": 240000,
    "Giảm giá phiếu đặt": 10000,
    VAT: 5000,
    "Thu khác": 3000,
    "Khách cần trả": 238000,
    "Khách đã trả": 38000,
    "Tiền mặt": 8000,
    Thẻ: 0,
    "Chuyển khoản": 30000,
    Ví: 0,
    Điểm: 0,
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
    "Mã đặt hàng": "DH-002",
    "Thời gian": "30/08/2026 11:00:00",
    "Thời gian giao hàng": null,
    "Mã khách hàng": "Khách lẻ",
    "Ghi chú": null,
    "Tổng tiền hàng": 50000,
    "Giảm giá phiếu đặt": 0,
    VAT: 0,
    "Thu khác": 0,
    "Khách cần trả": 50000,
    "Khách đã trả": 0,
    "Tiền mặt": 0,
    Thẻ: 0,
    "Chuyển khoản": 0,
    Ví: 0,
    Điểm: 0,
    "Trạng thái": "Phiếu tạm",
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

describe("KiotViet booking synchronization", () => {
  test("keeps historical completed and draft bookings visible and directly filterable", () => {
    expect(resolveBookingStatus(undefined)).toBe("all");
    expect(resolveBookingStatus("completed")).toBe("completed");
    expect(resolveBookingStatus("draft")).toBe("draft");
    expect(bookingStatusOptions).toEqual([
      { value: "all", label: "Tất cả" },
      { value: "confirmed", label: "Đang chờ" },
      { value: "completed", label: "Hoàn thành" },
      { value: "draft", label: "Phiếu tạm" },
      { value: "cancelled", label: "Đã hủy" },
    ]);
  });

  test("plans direct booking snapshots with completed lifecycle, source units, payments, and stable child keys", () => {
    const plan = planKiotVietBookingSync({
      sourceRows,
      current: [],
      mappings: [],
      resolvedCustomers,
      resolvedProducts,
    });

    expect(plan.summary).toEqual({
      documents: 2,
      lines: 3,
      payments: 2,
      completed: 1,
      draft: 1,
      creates: 2,
      adopts: 0,
      updates: 0,
      unchanged: 0,
      conflicts: 0,
      preserves: 0,
      unresolvedCustomers: 0,
      unresolvedProducts: 0,
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.writes[0]).toMatchObject({
      action: "create",
      externalId: "DH-001",
      booking: {
        code: "DH-001",
        documentType: "booking",
        status: "completed",
        paymentStatus: "deposit",
        customerId: "customer-001",
        deliveryDate: new Date("2026-08-31T07:30:00.000Z"),
        subtotal: 240000,
        discount: 10000,
        tax: 5000,
        shippingFee: 3000,
        total: 238000,
        amountPaid: 38000,
        note: "Giao buổi chiều",
      },
    });
    expect(plan.writes[0]?.booking.lines).toEqual([
      {
        externalId: "DH-001|ALT-001|hộp|1",
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
      {
        externalId: "DH-001|ALT-001|hộp|2",
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
    ]);
    expect(plan.writes[0]?.booking.payments).toEqual([
      {
        externalId: "DH-001|payment|cash|1",
        channel: "cash",
        method: "cash",
        amount: 8000,
      },
      {
        externalId: "DH-001|payment|bank_transfer|1",
        channel: "bank_transfer",
        method: "bank_transfer",
        amount: 30000,
      },
    ]);
    expect(plan.writes[1]?.booking).toMatchObject({
      documentType: "booking",
      status: "draft",
      paymentStatus: "unpaid",
      customerId: null,
      deliveryDate: null,
    });
  });

  test("blocks unresolved historical customer or product references before an apply payload exists", () => {
    const plan = planKiotVietBookingSync({
      sourceRows: [sourceRows[0]!],
      current: [],
      mappings: [],
      resolvedCustomers: [],
      resolvedProducts: [],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.blockers).toEqual([
      { documentCode: "DH-001", reference: "KH-001", reason: "unresolved_customer" },
      { documentCode: "DH-001", reference: "ALT-001", reason: "unresolved_product" },
    ]);
  });

  test("maps the reviewed workbook's 22 historical completions and one temporary draft without operational actions", () => {
    const source = readKiotVietDataBundle("/Users/cvthien/Downloads").sources
      .find((candidate) => candidate.phase === "bookings")!;
    const plan = planKiotVietBookingSync({
      sourceRows: source.rows,
      current: [],
      mappings: [],
      resolvedCustomers: [...new Set(source.rows.map((row) => String(row["Mã khách hàng"] ?? "").trim()))]
        .filter((code) => code && code !== "Khách lẻ")
        .map((code) => ({ code, customerId: `customer:${code}` })),
      resolvedProducts: [...new Map(source.rows.map((row) => {
        const sku = String(row["Mã hàng"]);
        return [sku, {
          sku,
          productId: `product:${sku}`,
          unitName: String(row.ĐVT),
          unitMultiplier: 1,
        }];
      })).values()],
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.summary).toMatchObject({
      documents: 23,
      lines: 361,
      completed: 22,
      draft: 1,
      creates: 23,
    });
    expect(plan.writes.every((write) => write.booking.documentType === "booking")).toBe(true);
    expect(plan.writes.filter((write) => write.booking.status === "completed")).toHaveLength(22);
    expect(plan.writes.filter((write) => write.booking.status === "draft")).toHaveLength(1);
    expect(plan.writes.some((write) => "stockReservations" in write.booking)).toBe(false);
    expect(plan.writes.some((write) => "stockMovements" in write.booking)).toBe(false);
    expect(plan.writes.some((write) => "cashbookRows" in write.booking)).toBe(false);
    expect(plan.writes.some((write) => "debtChanges" in write.booking)).toBe(false);
    expect(plan.writes.some((write) => "notifications" in write.booking)).toBe(false);
  });
});
