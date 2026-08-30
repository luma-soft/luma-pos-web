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

const INVOICE_CODE = "Mã hóa đơn";
const BOOKING_CODE = "Mã đặt hàng";
const PAYMENT_CHANNELS = [
  ["Tiền mặt", "cash", "cash"],
  ["Thẻ", "card", "card"],
  ["Chuyển khoản", "bank_transfer", "bank_transfer"],
  ["Ví", "wallet", "momo"],
] as const;

type KiotVietPaymentMethod = "cash" | "card" | "bank_transfer" | "momo";
type KiotVietPaymentChannel = "cash" | "card" | "bank_transfer" | "wallet";

export interface KiotVietResolvedSaleCustomer {
  code: string;
  customerId: string;
}

export interface KiotVietResolvedSaleProduct {
  sku: string;
  productId: string;
  unitName: string;
  unitMultiplier: number;
}

export interface KiotVietResolvedSaleBooking {
  code: string;
  bookingId: string;
}

export interface KiotVietSaleCurrent {
  localId: string;
  code: string | null;
  fingerprint: string;
  legacyImported: boolean;
}

export interface KiotVietSaleCurrentChild {
  localId: string;
  orderId: string;
}

export interface KiotVietSaleLineSnapshot {
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

export interface KiotVietSalePaymentSnapshot {
  externalId: string;
  channel: KiotVietPaymentChannel;
  method: KiotVietPaymentMethod;
  amount: number;
}

export interface KiotVietSaleSnapshot {
  code: string;
  documentType: "sale";
  status: "completed";
  paymentStatus: "unpaid" | "deposit" | "paid";
  customerId: string | null;
  sourceOrderId: string | null;
  createdAt: Date;
  subtotal: number;
  discount: number;
  tax: number;
  shippingFee: number;
  total: number;
  amountPaid: number;
  note: string | null;
  lines: KiotVietSaleLineSnapshot[];
  payments: KiotVietSalePaymentSnapshot[];
}

export interface KiotVietSaleLineWrite {
  action: "create" | "update";
  externalId: string;
  localId?: string;
  line: Omit<KiotVietSaleLineSnapshot, "externalId">;
}

export interface KiotVietSalePaymentWrite {
  action: "create" | "update";
  externalId: string;
  localId?: string;
  payment: Omit<KiotVietSalePaymentSnapshot, "externalId">;
}

export interface KiotVietSaleWriteSnapshot extends Omit<KiotVietSaleSnapshot, "lines" | "payments"> {
  lines: KiotVietSaleLineWrite[];
  payments: KiotVietSalePaymentWrite[];
  preservedLineIds: string[];
  preservedPaymentIds: string[];
}

export type KiotVietSaleWrite = {
  action: "create" | "adopt" | "update";
  externalId: string;
  localId?: string;
  sale: KiotVietSaleWriteSnapshot;
};

type KiotVietSaleBlockerReason =
  | "unresolved_customer"
  | "unresolved_product"
  | "unresolved_booking"
  | "mapped_line_missing"
  | "mapped_payment_missing"
  | "mapped_line_parent_mismatch"
  | "mapped_payment_parent_mismatch";

export interface KiotVietSalesSyncPlan {
  sales: KiotVietSaleSnapshot[];
  entityPlan: KiotVietEntitySyncPlan;
  writes: KiotVietSaleWrite[];
  blockers: Array<{
    documentCode: string;
    reference: string;
    reason: KiotVietSaleBlockerReason;
  }>;
  summary: {
    documents: number;
    lines: number;
    payments: number;
    creates: number;
    adopts: number;
    updates: number;
    unchanged: number;
    conflicts: number;
    preserves: number;
    unresolvedCustomers: number;
    unresolvedProducts: number;
    unresolvedBookings: number;
    preservedLines: number;
    preservedPayments: number;
  };
}

function nullableText(value: unknown): string | null {
  return normalizeKiotVietText(value) || null;
}

function anonymousCustomerCode(code: string): boolean {
  return !code || code.toLocaleLowerCase("vi") === "khách lẻ";
}

function saleStatus(value: unknown): "completed" {
  const status = normalizeKiotVietText(value).toLocaleLowerCase("vi");
  if (status === "hoàn thành") return "completed";
  throw new Error(`Unsupported KiotViet sale status: ${normalizeKiotVietText(value)}`);
}

function missingChildReason(kind: "line" | "payment"): KiotVietSaleBlockerReason {
  return kind === "line" ? "mapped_line_missing" : "mapped_payment_missing";
}

function mismatchedChildParentReason(kind: "line" | "payment"): KiotVietSaleBlockerReason {
  return kind === "line" ? "mapped_line_parent_mismatch" : "mapped_payment_parent_mismatch";
}

function paymentStatus(total: number, amountPaid: number): KiotVietSaleSnapshot["paymentStatus"] {
  if (total <= 0 || amountPaid >= total) return "paid";
  return amountPaid > 0 ? "deposit" : "unpaid";
}

function uniqueByKey<T>(values: T[], keyOf: (value: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = normalizeKiotVietText(keyOf(value));
    if (!key) throw new Error(`KiotViet sale ${label} cannot be blank`);
    if (result.has(key)) throw new Error(`Duplicate KiotViet sale ${label}: ${key}`);
    result.set(key, value);
  }
  return result;
}

function sourceSaleFingerprint(sale: KiotVietSaleSnapshot): string {
  return stableKiotVietFingerprint(sale);
}

function assertReconciledSales(rows: KiotVietDataRow[]): void {
  assertKiotVietDocumentReconciliation(rows, {
    codeColumn: INVOICE_CODE,
    headerTotalColumn: "Tổng tiền hàng",
    lineTotalColumn: "Thành tiền",
    payableColumn: "Khách cần trả",
    subtractHeaderColumns: ["Giảm giá hóa đơn"],
    addHeaderColumns: ["VAT", "Thu khác"],
    paidColumn: "Khách đã trả",
    paymentColumns: PAYMENT_CHANNELS.map(([column]) => column),
  });
}

function saleSourceRows(input: {
  sourceRows: KiotVietDataRow[];
  customersByCode: Map<string, KiotVietResolvedSaleCustomer>;
  productsBySku: Map<string, KiotVietResolvedSaleProduct>;
  bookingsByCode: Map<string, KiotVietResolvedSaleBooking>;
  blockers: KiotVietSalesSyncPlan["blockers"];
}): KiotVietSaleSnapshot[] {
  return groupKiotVietDocumentRows(input.sourceRows, {
    codeColumn: INVOICE_CODE,
    consistentHeaderColumns: [
      BOOKING_CODE,
      "Thời gian",
      "Mã khách hàng",
      "Ghi chú",
      "Tổng tiền hàng",
      "Giảm giá hóa đơn",
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
    const customer = anonymousCustomerCode(customerCode) ? null : input.customersByCode.get(customerCode);
    if (!anonymousCustomerCode(customerCode) && !customer) {
      input.blockers.push({ documentCode: code, reference: customerCode, reason: "unresolved_customer" });
    }
    const bookingCode = normalizeKiotVietText(header[BOOKING_CODE]);
    const booking = bookingCode ? input.bookingsByCode.get(bookingCode) : null;
    if (bookingCode && !booking) {
      input.blockers.push({ documentCode: code, reference: bookingCode, reason: "unresolved_booking" });
    }

    const occurrences = new Map<string, number>();
    const lines = rows.flatMap((row) => {
      const sourceSku = normalizeKiotVietText(row["Mã hàng"]);
      const product = input.productsBySku.get(sourceSku);
      if (!product) {
        input.blockers.push({ documentCode: code, reference: sourceSku, reason: "unresolved_product" });
        return [];
      }
      if (!Number.isFinite(product.unitMultiplier) || product.unitMultiplier <= 0) {
        throw new Error(`KiotViet sale ${code} has invalid product unit multiplier for ${sourceSku}`);
      }
      const occurrenceKey = `${sourceSku}\u0000${product.unitName.toLocaleLowerCase("vi")}`;
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      return [{
        externalId: buildKiotVietChildExternalId({
          documentCode: code,
          sku: sourceSku,
          unitName: product.unitName,
          occurrence,
        }),
        productId: product.productId,
        sourceSku,
        productName: nullableText(row["Tên hàng"]) ?? sourceSku,
        unitName: product.unitName,
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
      documentType: "sale" as const,
      status: saleStatus(header["Trạng thái"]),
      paymentStatus: paymentStatus(total, amountPaid),
      customerId: customer?.customerId ?? null,
      sourceOrderId: booking?.bookingId ?? null,
      createdAt: normalizeKiotVietDate(header["Thời gian"]),
      subtotal: normalizeKiotVietNumber(header["Tổng tiền hàng"]),
      discount: normalizeKiotVietNumber(header["Giảm giá hóa đơn"]),
      tax: normalizeKiotVietNumber(header.VAT),
      shippingFee: normalizeKiotVietNumber(header["Thu khác"]),
      total,
      amountPaid,
      note: nullableText(header["Ghi chú"]),
      lines,
      payments,
    };
  });
}

function childWrites<T extends { externalId: string }>(input: {
  documentCode: string;
  parentId: string | undefined;
  values: T[];
  mappings: Map<string, KiotVietEntityMappingSnapshot>;
  currentById: Map<string, KiotVietSaleCurrentChild>;
  kind: "line" | "payment";
  blockers: KiotVietSalesSyncPlan["blockers"];
}): { writes: Array<{ externalId: string; localId?: string; value: Omit<T, "externalId"> }>; preservedIds: string[] } {
  if (!input.parentId) {
    for (const value of input.values) {
      const mapping = input.mappings.get(value.externalId);
      if (!mapping) continue;
      const current = input.currentById.get(mapping.localId);
      input.blockers.push({
        documentCode: input.documentCode,
        reference: value.externalId,
        reason: current ? mismatchedChildParentReason(input.kind) : missingChildReason(input.kind),
      });
    }
    return {
      writes: input.values.map(({ externalId, ...value }) => ({ externalId, value })),
      preservedIds: [],
    };
  }

  const selectedIds = new Set<string>();
  const writes = input.values.map(({ externalId, ...value }) => {
    const mapping = input.mappings.get(externalId);
    if (!mapping) return { externalId, value };
    const current = input.currentById.get(mapping.localId);
    if (!current) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: externalId,
        reason: missingChildReason(input.kind),
      });
      return { externalId, value };
    }
    if (current.orderId !== input.parentId) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: externalId,
        reason: mismatchedChildParentReason(input.kind),
      });
      return { externalId, value };
    }
    selectedIds.add(current.localId);
    return { externalId, localId: current.localId, value };
  });
  const preservedIds = [...input.currentById.values()]
    .filter((current) => current.orderId === input.parentId && !selectedIds.has(current.localId))
    .map((current) => current.localId)
    .sort((left, right) => left.localeCompare(right));
  return { writes, preservedIds };
}

export function planKiotVietSalesSync(input: {
  storeId: string;
  sourceRows: KiotVietDataRow[];
  current: KiotVietSaleCurrent[];
  mappings: KiotVietEntityMappingSnapshot[];
  lineMappings: KiotVietEntityMappingSnapshot[];
  paymentMappings: KiotVietEntityMappingSnapshot[];
  existingLines: KiotVietSaleCurrentChild[];
  existingPayments: KiotVietSaleCurrentChild[];
  resolvedCustomers: KiotVietResolvedSaleCustomer[];
  resolvedProducts: KiotVietResolvedSaleProduct[];
  resolvedBookings: KiotVietResolvedSaleBooking[];
}): KiotVietSalesSyncPlan {
  if (!normalizeKiotVietText(input.storeId)) {
    throw new Error("KiotViet sale store ID cannot be blank");
  }
  assertReconciledSales(input.sourceRows);
  const customersByCode = uniqueByKey(input.resolvedCustomers, (customer) => customer.code, "customer code");
  const productsBySku = uniqueByKey(input.resolvedProducts, (product) => product.sku, "product SKU");
  const bookingsByCode = uniqueByKey(input.resolvedBookings, (booking) => booking.code, "booking code");
  const lineMappings = uniqueByKey(input.lineMappings, (mapping) => mapping.externalId, "line mapping identity");
  const paymentMappings = uniqueByKey(input.paymentMappings, (mapping) => mapping.externalId, "payment mapping identity");
  const existingLines = uniqueByKey(input.existingLines, (line) => line.localId, "current line identity");
  const existingPayments = uniqueByKey(input.existingPayments, (payment) => payment.localId, "current payment identity");
  const blockers: KiotVietSalesSyncPlan["blockers"] = [];
  const sales = saleSourceRows({
    sourceRows: input.sourceRows,
    customersByCode,
    productsBySku,
    bookingsByCode,
    blockers,
  });
  const entityPlan = planKiotVietEntities({
    sources: sales.map((sale) => ({ externalId: sale.code, fingerprint: sourceSaleFingerprint(sale) })),
    current: input.current.map((sale) => ({
      localId: sale.localId,
      code: sale.code,
      fingerprint: sale.fingerprint,
      legacyImported: sale.legacyImported,
    })),
    mappings: input.mappings,
  });
  const salesByCode = new Map(sales.map((sale) => [sale.code, sale]));
  const parentWrites: Array<{
    action: "create" | "adopt" | "update";
    externalId: string;
    localId?: string;
  }> = [
    ...entityPlan.creates.map(({ externalId }) => ({ action: "create" as const, externalId })),
    ...entityPlan.adopts.filter((item) => item.needsUpdate).map(({ externalId, localId }) => ({
      action: "adopt" as const,
      externalId,
      localId,
    })),
    ...entityPlan.updates.map(({ externalId, localId }) => ({ action: "update" as const, externalId, localId })),
  ];
  const writes = parentWrites.map(({ action, externalId, localId }) => {
    const sale = salesByCode.get(externalId)!;
    const lines = childWrites({
      documentCode: externalId,
      parentId: localId,
      values: sale.lines,
      mappings: lineMappings,
      currentById: existingLines,
      kind: "line",
      blockers,
    });
    const payments = childWrites({
      documentCode: externalId,
      parentId: localId,
      values: sale.payments,
      mappings: paymentMappings,
      currentById: existingPayments,
      kind: "payment",
      blockers,
    });
    return {
      action,
      externalId,
      ...(localId ? { localId } : {}),
      sale: {
        ...sale,
        lines: lines.writes.map(({ externalId: childExternalId, localId: childLocalId, value }) => ({
          action: childLocalId ? "update" as const : "create" as const,
          externalId: childExternalId,
          ...(childLocalId ? { localId: childLocalId } : {}),
          line: value,
        })),
        payments: payments.writes.map(({ externalId: childExternalId, localId: childLocalId, value }) => ({
          action: childLocalId ? "update" as const : "create" as const,
          externalId: childExternalId,
          ...(childLocalId ? { localId: childLocalId } : {}),
          payment: value,
        })),
        preservedLineIds: lines.preservedIds,
        preservedPaymentIds: payments.preservedIds,
      },
    };
  });

  return {
    sales,
    entityPlan,
    writes: blockers.length > 0 ? [] : writes,
    blockers,
    summary: {
      documents: sales.length,
      lines: sales.reduce((sum, sale) => sum + sale.lines.length, 0),
      payments: sales.reduce((sum, sale) => sum + sale.payments.length, 0),
      creates: entityPlan.creates.length,
      adopts: entityPlan.adopts.length,
      updates: entityPlan.updates.length,
      unchanged: entityPlan.unchanged.length,
      conflicts: entityPlan.conflicts.length,
      preserves: entityPlan.preserves.length,
      unresolvedCustomers: blockers.filter((blocker) => blocker.reason === "unresolved_customer").length,
      unresolvedProducts: blockers.filter((blocker) => blocker.reason === "unresolved_product").length,
      unresolvedBookings: blockers.filter((blocker) => blocker.reason === "unresolved_booking").length,
      preservedLines: writes.reduce((sum, write) => sum + write.sale.preservedLineIds.length, 0),
      preservedPayments: writes.reduce((sum, write) => sum + write.sale.preservedPaymentIds.length, 0),
    },
  };
}
