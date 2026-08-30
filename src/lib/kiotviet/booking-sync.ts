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
  withoutKiotVietExternalId,
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

export interface KiotVietBookingCurrentChild {
  localId: string;
  orderId: string;
  legacyImported?: boolean;
  /** Exact-match bootstrap candidate; eligibility alone never makes the row source-owned. */
  legacyAdoptionEligible?: boolean;
  sourceSku?: string;
  unitName?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  discount?: number | string;
  total?: number | string;
  note?: string | null;
  method?: KiotVietBookingPaymentMethod;
  amount?: number | string;
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

export interface KiotVietBookingLineWrite {
  action: "create" | "adopt" | "update";
  adoptionMethod: "created" | "legacy_adopted" | "mapped";
  externalId: string;
  localId?: string;
  line: Omit<KiotVietBookingLineSnapshot, "externalId">;
}

export interface KiotVietBookingPaymentWrite {
  action: "create" | "adopt" | "update";
  adoptionMethod: "created" | "legacy_adopted" | "mapped";
  externalId: string;
  localId?: string;
  payment: Omit<KiotVietBookingPaymentSnapshot, "externalId">;
}

export interface KiotVietBookingWriteSnapshot extends Omit<KiotVietBookingSnapshot, "lines" | "payments"> {
  lines: KiotVietBookingLineWrite[];
  payments: KiotVietBookingPaymentWrite[];
  preservedLineIds: string[];
  preservedPaymentIds: string[];
}

export type KiotVietBookingWrite = {
  action: "create" | "adopt" | "update";
  externalId: string;
  localId?: string;
  booking: KiotVietBookingWriteSnapshot;
};

type KiotVietBookingBlockerReason =
  | "unresolved_customer"
  | "unresolved_product"
  | "mapped_line_missing"
  | "mapped_payment_missing"
  | "mapped_line_parent_mismatch"
  | "mapped_payment_parent_mismatch"
  | "ambiguous_legacy_line_match"
  | "ambiguous_legacy_payment_match"
  | "duplicate_local_child_write";

export interface KiotVietBookingSyncPlan {
  bookings: KiotVietBookingSnapshot[];
  entityPlan: KiotVietEntitySyncPlan;
  writes: KiotVietBookingWrite[];
  blockers: Array<{
    documentCode: string;
    reference: string;
    reason: KiotVietBookingBlockerReason;
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

export function kiotVietBookingFingerprint(booking: KiotVietBookingSnapshot): string {
  const { lines, payments, ...parent } = booking;
  const normalizedLines = lines.map(withoutKiotVietExternalId)
    .sort((left, right) => stableKiotVietFingerprint(left).localeCompare(stableKiotVietFingerprint(right)));
  const normalizedPayments = payments.map(withoutKiotVietExternalId)
    .sort((left, right) => stableKiotVietFingerprint(left).localeCompare(stableKiotVietFingerprint(right)));
  return stableKiotVietFingerprint({
    ...parent,
    lines: normalizedLines,
    payments: normalizedPayments,
  });
}

function sourceLineFingerprint(line: KiotVietBookingLineSnapshot): string {
  return stableKiotVietFingerprint({
    sourceSku: line.sourceSku,
    unitName: line.unitName,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount: line.discount,
    total: line.total,
    note: line.note,
  });
}

function sourcePaymentFingerprint(payment: KiotVietBookingPaymentSnapshot): string {
  return stableKiotVietFingerprint({ method: payment.method, amount: payment.amount });
}

function currentChildFingerprint(
  child: KiotVietBookingCurrentChild,
  kind: "line" | "payment",
): string | null {
  if (!child.legacyImported && !child.legacyAdoptionEligible) return null;
  if (kind === "payment") {
    if (!child.method || child.amount == null) return null;
    return stableKiotVietFingerprint({
      method: child.method,
      amount: normalizeKiotVietNumber(child.amount),
    });
  }
  if (
    !child.sourceSku
    || !child.unitName
    || child.quantity == null
    || child.unitPrice == null
    || child.discount == null
    || child.total == null
  ) return null;
  return stableKiotVietFingerprint({
    sourceSku: child.sourceSku,
    unitName: child.unitName,
    quantity: normalizeKiotVietNumber(child.quantity),
    unitPrice: normalizeKiotVietNumber(child.unitPrice),
    discount: normalizeKiotVietNumber(child.discount),
    total: normalizeKiotVietNumber(child.total),
    note: child.note ?? null,
  });
}

function childReason(
  kind: "line" | "payment",
  suffix: "missing" | "parent_mismatch" | "ambiguous_legacy",
): KiotVietBookingBlockerReason {
  if (suffix === "missing") return kind === "line" ? "mapped_line_missing" : "mapped_payment_missing";
  if (suffix === "parent_mismatch") {
    return kind === "line" ? "mapped_line_parent_mismatch" : "mapped_payment_parent_mismatch";
  }
  return kind === "line" ? "ambiguous_legacy_line_match" : "ambiguous_legacy_payment_match";
}

function childWrites<T extends { externalId: string }>(input: {
  documentCode: string;
  parentId: string | undefined;
  values: T[];
  mappings: Map<string, KiotVietEntityMappingSnapshot>;
  currentById: Map<string, KiotVietBookingCurrentChild>;
  kind: "line" | "payment";
  sourceFingerprint: (value: T) => string;
  blockers: KiotVietBookingSyncPlan["blockers"];
}): {
  writes: Array<{
    externalId: string;
    localId?: string;
    adoptionMethod: "created" | "legacy_adopted" | "mapped";
    value: Omit<T, "externalId">;
  }>;
  preservedIds: string[];
} {
  if (!input.parentId) {
    for (const value of input.values) {
      const mapping = input.mappings.get(value.externalId);
      if (!mapping) continue;
      input.blockers.push({
        documentCode: input.documentCode,
        reference: value.externalId,
        reason: input.currentById.has(mapping.localId)
          ? childReason(input.kind, "parent_mismatch")
          : childReason(input.kind, "missing"),
      });
    }
    return {
      writes: input.values.map(({ externalId, ...value }) => ({
        externalId,
        adoptionMethod: "created" as const,
        value,
      })),
      preservedIds: [],
    };
  }

  const selectedIds = new Set<string>();
  const reservedIds = new Set([...input.mappings.values()].map((mapping) => mapping.localId));
  const mappedByExternalId = new Map<string, KiotVietBookingCurrentChild>();
  for (const value of input.values) {
    const mapping = input.mappings.get(value.externalId);
    if (!mapping) continue;
    const current = input.currentById.get(mapping.localId);
    if (!current) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: value.externalId,
        reason: childReason(input.kind, "missing"),
      });
      continue;
    }
    if (current.orderId !== input.parentId) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: value.externalId,
        reason: childReason(input.kind, "parent_mismatch"),
      });
      continue;
    }
    if (selectedIds.has(current.localId)) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: value.externalId,
        reason: "duplicate_local_child_write",
      });
      continue;
    }
    selectedIds.add(current.localId);
    mappedByExternalId.set(value.externalId, current);
  }

  const writes = input.values.map(({ externalId, ...value }) => {
    const mapped = mappedByExternalId.get(externalId);
    if (mapped) {
      return {
        externalId,
        localId: mapped.localId,
        adoptionMethod: "mapped" as const,
        value,
      };
    }
    if (input.mappings.has(externalId)) {
      return { externalId, adoptionMethod: "created" as const, value };
    }
    const fingerprint = input.sourceFingerprint({ externalId, ...value } as T);
    const candidates = [...input.currentById.values()].filter((current) => (
      current.orderId === input.parentId
      && !selectedIds.has(current.localId)
      && !reservedIds.has(current.localId)
      && currentChildFingerprint(current, input.kind) === fingerprint
    ));
    if (candidates.length > 1) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: externalId,
        reason: childReason(input.kind, "ambiguous_legacy"),
      });
      return { externalId, adoptionMethod: "created" as const, value };
    }
    const legacy = candidates[0];
    if (!legacy) return { externalId, adoptionMethod: "created" as const, value };
    selectedIds.add(legacy.localId);
    return {
      externalId,
      localId: legacy.localId,
      adoptionMethod: "legacy_adopted" as const,
      value,
    };
  });
  const preservedIds = [...input.currentById.values()]
    .filter((current) => current.orderId === input.parentId && !selectedIds.has(current.localId))
    .map((current) => current.localId)
    .sort((left, right) => left.localeCompare(right));
  return { writes, preservedIds };
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
  lineMappings: KiotVietEntityMappingSnapshot[];
  paymentMappings: KiotVietEntityMappingSnapshot[];
  existingLines: KiotVietBookingCurrentChild[];
  existingPayments: KiotVietBookingCurrentChild[];
  resolvedCustomers: KiotVietResolvedBookingCustomer[];
  resolvedProducts: KiotVietResolvedBookingProduct[];
}): KiotVietBookingSyncPlan {
  assertReconciledBookings(input.sourceRows);
  const customersByCode = uniqueByKey(input.resolvedCustomers, (customer) => customer.code, "customer code");
  const productsBySku = uniqueByKey(input.resolvedProducts, (product) => product.sku, "product SKU");
  const lineMappings = uniqueByKey(input.lineMappings, (mapping) => mapping.externalId, "line mapping identity");
  const paymentMappings = uniqueByKey(
    input.paymentMappings,
    (mapping) => mapping.externalId,
    "payment mapping identity",
  );
  const existingLines = uniqueByKey(input.existingLines, (line) => line.localId, "current line identity");
  const existingPayments = uniqueByKey(
    input.existingPayments,
    (payment) => payment.localId,
    "current payment identity",
  );
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
      fingerprint: kiotVietBookingFingerprint(booking),
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
  const needsChildProvenance = (externalId: string): boolean => {
    const booking = bookingByCode.get(externalId);
    return booking?.lines.some((line) => !lineMappings.has(line.externalId)) === true
      || booking?.payments.some((payment) => !paymentMappings.has(payment.externalId)) === true;
  };
  const parents: Array<{
    action: "create" | "adopt" | "update";
    externalId: string;
    localId?: string;
  }> = [
    ...entityPlan.creates.map(({ externalId }) => ({ action: "create" as const, externalId })),
    ...entityPlan.adopts.filter((item) => item.needsUpdate || needsChildProvenance(item.externalId))
      .map(({ externalId, localId }) => ({ action: "adopt" as const, externalId, localId })),
    ...entityPlan.updates.map(({ externalId, localId }) => ({
      action: "update" as const, externalId, localId,
    })),
    ...entityPlan.unchanged.filter((item) => needsChildProvenance(item.externalId))
      .map(({ externalId, localId }) => ({ action: "update" as const, externalId, localId })),
  ];
  const candidateWrites: KiotVietBookingWrite[] = parents.map(({ action, externalId, localId }) => {
    const booking = bookingByCode.get(externalId)!;
    const lines = childWrites({
      documentCode: externalId,
      parentId: localId,
      values: booking.lines,
      mappings: lineMappings,
      currentById: existingLines,
      kind: "line",
      sourceFingerprint: sourceLineFingerprint,
      blockers,
    });
    const payments = childWrites({
      documentCode: externalId,
      parentId: localId,
      values: booking.payments,
      mappings: paymentMappings,
      currentById: existingPayments,
      kind: "payment",
      sourceFingerprint: sourcePaymentFingerprint,
      blockers,
    });
    return {
      action,
      externalId,
      ...(localId ? { localId } : {}),
      booking: {
        ...booking,
        lines: lines.writes.map(({ externalId: childExternalId, localId: childLocalId, adoptionMethod, value }) => ({
          action: adoptionMethod === "legacy_adopted" ? "adopt" as const : childLocalId ? "update" as const : "create" as const,
          adoptionMethod,
          externalId: childExternalId,
          ...(childLocalId ? { localId: childLocalId } : {}),
          line: value,
        })),
        payments: payments.writes.map(({ externalId: childExternalId, localId: childLocalId, adoptionMethod, value }) => ({
          action: adoptionMethod === "legacy_adopted" ? "adopt" as const : childLocalId ? "update" as const : "create" as const,
          adoptionMethod,
          externalId: childExternalId,
          ...(childLocalId ? { localId: childLocalId } : {}),
          payment: value,
        })),
        preservedLineIds: lines.preservedIds,
        preservedPaymentIds: payments.preservedIds,
      },
    };
  });
  const writes = blockers.length > 0 ? [] : candidateWrites;
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
      preservedLines: candidateWrites.reduce((sum, write) => sum + write.booking.preservedLineIds.length, 0),
      preservedPayments: candidateWrites.reduce((sum, write) => sum + write.booking.preservedPaymentIds.length, 0),
    },
  };
}
