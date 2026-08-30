import type {
  KiotVietDataRow,
  KiotVietEntityMappingSnapshot,
  KiotVietEntitySyncPlan,
} from "./data-sync-types";
import {
  assertKiotVietDocumentReconciliation,
  buildKiotVietChildExternalId,
  groupKiotVietDocumentRows,
  normalizeKiotVietDate,
  normalizeKiotVietNumber,
  normalizeKiotVietText,
  planKiotVietEntities,
  stableKiotVietFingerprint,
} from "./data-sync-plan";

const BOOKING_CODE = "Mã đặt hàng";
const PAYMENT_CHANNELS = [
  ["Tiền mặt", "cash", "cash"],
  ["Thẻ", "card", "card"],
  ["Chuyển khoản", "bank_transfer", "bank_transfer"],
  ["Ví", "wallet", "momo"],
  ["Điểm", "points", "credit"],
] as const;

type KiotVietBookingStatus = "completed" | "draft";
type KiotVietBookingPaymentMethod = "cash" | "card" | "bank_transfer" | "momo" | "credit";

export interface KiotVietResolvedBookingCustomer {
  code: string;
  customerId: string;
}

export interface KiotVietResolvedBookingProduct {
  sku: string;
  productId: string;
  unitName: string;
  unitMultiplier: number;
}

export interface KiotVietBookingCurrent {
  localId: string;
  code: string | null;
  fingerprint: string;
  legacyImported: boolean;
}

export interface KiotVietBookingLineSnapshot {
  externalId: string;
  productId: string;
  sourceSku: string;
  productName: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  note: string | null;
}

export interface KiotVietBookingPaymentSnapshot {
  externalId: string;
  channel: "cash" | "card" | "bank_transfer" | "wallet" | "points";
  method: KiotVietBookingPaymentMethod;
  amount: number;
}

export interface KiotVietBookingSnapshot {
  code: string;
  documentType: "booking";
  status: KiotVietBookingStatus;
  paymentStatus: "unpaid" | "deposit" | "paid";
  customerId: string | null;
  deliveryDate: Date | null;
  createdAt: Date;
  subtotal: number;
  discount: number;
  tax: number;
  shippingFee: number;
  total: number;
  amountPaid: number;
  note: string | null;
  lines: KiotVietBookingLineSnapshot[];
  payments: KiotVietBookingPaymentSnapshot[];
}

export type KiotVietBookingWrite = {
  action: "create" | "adopt" | "update";
  externalId: string;
  localId?: string;
  booking: KiotVietBookingSnapshot;
};

export interface KiotVietBookingSyncPlan {
  bookings: KiotVietBookingSnapshot[];
  entityPlan: KiotVietEntitySyncPlan;
  writes: KiotVietBookingWrite[];
  blockers: Array<{
    documentCode: string;
    reference: string;
    reason: "unresolved_customer" | "unresolved_product";
  }>;
  summary: {
    documents: number;
    lines: number;
    payments: number;
    completed: number;
    draft: number;
    creates: number;
    adopts: number;
    updates: number;
    unchanged: number;
    conflicts: number;
    preserves: number;
    unresolvedCustomers: number;
    unresolvedProducts: number;
  };
}

function nullableText(value: unknown): string | null {
  return normalizeKiotVietText(value) || null;
}

function anonymousCustomerCode(code: string): boolean {
  return !code || code.toLocaleLowerCase("vi") === "khách lẻ";
}

function bookingStatus(value: unknown): KiotVietBookingStatus {
  const status = normalizeKiotVietText(value).toLocaleLowerCase("vi");
  if (status === "hoàn thành") return "completed";
  if (status === "phiếu tạm") return "draft";
  throw new Error(`Unsupported KiotViet booking status: ${normalizeKiotVietText(value)}`);
}

function paymentStatus(total: number, amountPaid: number): KiotVietBookingSnapshot["paymentStatus"] {
  if (total <= 0 || amountPaid >= total) return "paid";
  return amountPaid > 0 ? "deposit" : "unpaid";
}

function uniqueByKey<T>(values: T[], keyOf: (value: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = normalizeKiotVietText(keyOf(value));
    if (!key) throw new Error(`KiotViet booking ${label} cannot be blank`);
    if (result.has(key)) throw new Error(`Duplicate KiotViet booking ${label}: ${key}`);
    result.set(key, value);
  }
  return result;
}

function sourceBookingFingerprint(booking: KiotVietBookingSnapshot): string {
  return stableKiotVietFingerprint(booking);
}

function assertReconciledBookings(rows: KiotVietDataRow[]): void {
  assertKiotVietDocumentReconciliation(rows, {
    codeColumn: BOOKING_CODE,
    headerTotalColumn: "Tổng tiền hàng",
    lineTotalColumn: "Thành tiền",
    payableColumn: "Khách cần trả",
    subtractHeaderColumns: ["Giảm giá phiếu đặt"],
    addHeaderColumns: ["VAT", "Thu khác"],
    paidColumn: "Khách đã trả",
    paymentColumns: PAYMENT_CHANNELS.map(([column]) => column),
  });
}

export function planKiotVietBookingSync(input: {
  sourceRows: KiotVietDataRow[];
  current: KiotVietBookingCurrent[];
  mappings: KiotVietEntityMappingSnapshot[];
  resolvedCustomers: KiotVietResolvedBookingCustomer[];
  resolvedProducts: KiotVietResolvedBookingProduct[];
}): KiotVietBookingSyncPlan {
  assertReconciledBookings(input.sourceRows);
  const customersByCode = uniqueByKey(input.resolvedCustomers, (customer) => customer.code, "customer code");
  const productsBySku = uniqueByKey(input.resolvedProducts, (product) => product.sku, "product SKU");
  const blockers: KiotVietBookingSyncPlan["blockers"] = [];
  const bookings = groupKiotVietDocumentRows(input.sourceRows, {
    codeColumn: BOOKING_CODE,
    consistentHeaderColumns: [
      "Thời gian",
      "Thời gian giao hàng",
      "Mã khách hàng",
      "Ghi chú",
      "Tổng tiền hàng",
      "Giảm giá phiếu đặt",
      "VAT",
      "Thu khác",
      "Khách cần trả",
      "Khách đã trả",
      ...PAYMENT_CHANNELS.map(([column]) => column),
      "Trạng thái",
    ],
  }).map(({ externalId: code, rows }) => {
    const header = rows[0]!;
    const customerCode = normalizeKiotVietText(header["Mã khách hàng"]);
    const customer = anonymousCustomerCode(customerCode) ? null : customersByCode.get(customerCode);
    if (!anonymousCustomerCode(customerCode) && !customer) {
      blockers.push({ documentCode: code, reference: customerCode, reason: "unresolved_customer" });
    }

    const occurrences = new Map<string, number>();
    const lines = rows.flatMap((row) => {
      const sourceSku = normalizeKiotVietText(row["Mã hàng"]);
      const product = productsBySku.get(sourceSku);
      if (!product) {
        blockers.push({ documentCode: code, reference: sourceSku, reason: "unresolved_product" });
        return [];
      }
      if (!Number.isFinite(product.unitMultiplier) || product.unitMultiplier <= 0) {
        throw new Error(`KiotViet booking ${code} has invalid product unit multiplier for ${sourceSku}`);
      }
      const sourceUnit = nullableText(row.ĐVT) ?? product.unitName;
      const occurrenceKey = `${sourceSku}\u0000${sourceUnit.toLocaleLowerCase("vi")}`;
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      return [{
        externalId: buildKiotVietChildExternalId({
          documentCode: code,
          sku: sourceSku,
          unitName: sourceUnit,
          occurrence,
        }),
        productId: product.productId,
        sourceSku,
        productName: nullableText(row["Tên hàng"]) ?? sourceSku,
        unitName: sourceUnit,
        unitMultiplier: product.unitMultiplier,
        quantity: normalizeKiotVietNumber(row["Số lượng"]),
        unitPrice: normalizeKiotVietNumber(row["Đơn giá"]),
        discount: normalizeKiotVietNumber(row["Giảm giá"]),
        total: normalizeKiotVietNumber(row["Thành tiền"]),
        note: nullableText(row["Ghi chú hàng hóa"]),
      }];
    });
    const payments = PAYMENT_CHANNELS.flatMap(([column, channel, method]) => {
      const amount = normalizeKiotVietNumber(header[column]);
      if (amount === 0) return [];
      return [{
        externalId: buildKiotVietChildExternalId({
          documentCode: code,
          sku: "payment",
          unitName: channel,
          occurrence: 1,
        }),
        channel,
        method,
        amount,
      }];
    });
    const total = normalizeKiotVietNumber(header["Khách cần trả"]);
    const amountPaid = normalizeKiotVietNumber(header["Khách đã trả"]);
    return {
      code,
      documentType: "booking" as const,
      status: bookingStatus(header["Trạng thái"]),
      paymentStatus: paymentStatus(total, amountPaid),
      customerId: customer?.customerId ?? null,
      deliveryDate: header["Thời gian giao hàng"] == null || normalizeKiotVietText(header["Thời gian giao hàng"]) === ""
        ? null
        : normalizeKiotVietDate(header["Thời gian giao hàng"]),
      createdAt: normalizeKiotVietDate(header["Thời gian"]),
      subtotal: normalizeKiotVietNumber(header["Tổng tiền hàng"]),
      discount: normalizeKiotVietNumber(header["Giảm giá phiếu đặt"]),
      tax: normalizeKiotVietNumber(header.VAT),
      shippingFee: normalizeKiotVietNumber(header["Thu khác"]),
      total,
      amountPaid,
      note: nullableText(header["Ghi chú"]),
      lines,
      payments,
    };
  });

  const entityPlan = planKiotVietEntities({
    sources: bookings.map((booking) => ({
      externalId: booking.code,
      fingerprint: sourceBookingFingerprint(booking),
    })),
    current: input.current.map((booking) => ({
      localId: booking.localId,
      code: booking.code,
      fingerprint: booking.fingerprint,
      legacyImported: booking.legacyImported,
    })),
    mappings: input.mappings,
  });
  const bookingByCode = new Map(bookings.map((booking) => [booking.code, booking]));
  const writes: KiotVietBookingWrite[] = blockers.length > 0 ? [] : [
    ...entityPlan.creates.map(({ externalId }) => ({
      action: "create" as const,
      externalId,
      booking: bookingByCode.get(externalId)!,
    })),
    ...entityPlan.adopts.filter((item) => item.needsUpdate).map(({ externalId, localId }) => ({
      action: "adopt" as const,
      externalId,
      localId,
      booking: bookingByCode.get(externalId)!,
    })),
    ...entityPlan.updates.map(({ externalId, localId }) => ({
      action: "update" as const,
      externalId,
      localId,
      booking: bookingByCode.get(externalId)!,
    })),
  ];
  const completed = bookings.filter((booking) => booking.status === "completed").length;
  const draft = bookings.filter((booking) => booking.status === "draft").length;

  return {
    bookings,
    entityPlan,
    writes,
    blockers,
    summary: {
      documents: bookings.length,
      lines: bookings.reduce((sum, booking) => sum + booking.lines.length, 0),
      payments: bookings.reduce((sum, booking) => sum + booking.payments.length, 0),
      completed,
      draft,
      creates: entityPlan.creates.length,
      adopts: entityPlan.adopts.length,
      updates: entityPlan.updates.length,
      unchanged: entityPlan.unchanged.length,
      conflicts: entityPlan.conflicts.length,
      preserves: entityPlan.preserves.length,
      unresolvedCustomers: blockers.filter((blocker) => blocker.reason === "unresolved_customer").length,
      unresolvedProducts: blockers.filter((blocker) => blocker.reason === "unresolved_product").length,
    },
  };
}
