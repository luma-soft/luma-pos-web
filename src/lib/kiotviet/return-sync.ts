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

const RETURN_CODE = "Mã trả hàng";

export type KiotVietReturnProductResolutionSource =
  | "current_base"
  | "alternate_unit"
  | "archived_mapping"
  | "approved_historical_placeholder";

export interface KiotVietResolvedReturnProduct {
  sku: string;
  productId: string;
  unitName: string;
  sourceUnitName: string;
  unitMultiplier: number;
  resolutionSource: KiotVietReturnProductResolutionSource;
}

export interface KiotVietReturnSaleItem {
  localId: string;
  sourceSku: string;
  unitName: string;
  quantity: number | string;
}

export interface KiotVietReturnSale {
  invoiceCode: string;
  orderId: string;
  customerId: string | null;
  status: "completed" | "returned";
  items: KiotVietReturnSaleItem[];
}

export interface KiotVietReturnCurrent {
  localId: string;
  code: string | null;
  fingerprint: string;
  legacyImported: boolean;
}

export interface KiotVietReturnCurrentLine {
  localId: string;
  returnId: string;
  active?: boolean;
  legacyImported?: boolean;
  /** Supplied by the loader when the historical row only persisted product ID. */
  legacyProductSku?: string;
  sourceSku?: string;
  orderItemId?: string | null;
  quantity?: number | string;
  unitPrice?: number | string;
  total?: number | string;
}

export interface KiotVietReturnPaymentSnapshot {
  channel: "cash" | "card" | "bank_transfer" | "wallet" | "points";
  amount: number;
}

export interface KiotVietReturnLineSnapshot {
  externalId: string;
  orderItemId: string | null;
  productId: string;
  sourceSku: string;
  productName: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Historical snapshots must not cause a stock operation when applied. */
  restock: false;
}

export interface KiotVietReturnSnapshot {
  code: string;
  invoiceCode: string | null;
  orderId: string | null;
  customerId: string | null;
  status: "completed" | "cancelled";
  createdAt: Date;
  subtotal: number;
  discount: number;
  tax: number;
  otherRefund: number;
  returnFee: number;
  totalRefund: number;
  refundAmount: number;
  settlementStatus: "unsettled" | "partial" | "settled";
  note: string | null;
  paymentSnapshots: KiotVietReturnPaymentSnapshot[];
  lines: KiotVietReturnLineSnapshot[];
}

export interface KiotVietReturnLineWrite {
  action: "create" | "update";
  externalId: string;
  localId?: string;
  line: Omit<KiotVietReturnLineSnapshot, "externalId">;
}

export interface KiotVietReturnWrite {
  action: "create" | "adopt" | "update";
  externalId: string;
  localId?: string;
  return: Omit<KiotVietReturnSnapshot, "lines"> & {
    lines: KiotVietReturnLineWrite[];
    preservedLineIds: string[];
  };
}

type KiotVietReturnBlockerReason =
  | "unresolved_product"
  | "unresolved_product_unit"
  | "mapped_line_missing"
  | "mapped_line_parent_mismatch"
  | "duplicate_local_child_write"
  | "ambiguous_legacy_line_match"
  | "legacy_line_unmatched"
  | "over_returned_sale_item";

export interface KiotVietReturnSyncPlan {
  returns: KiotVietReturnSnapshot[];
  entityPlan: KiotVietEntitySyncPlan;
  writes: KiotVietReturnWrite[];
  preservedLineIds: string[];
  linkageExceptions: Array<{
    documentCode: string;
    reference: string;
    reason: "missing_invoice" | "unsafe_item_match" | "ambiguous_item_match";
  }>;
  blockers: Array<{ documentCode: string; reference: string; reason: KiotVietReturnBlockerReason }>;
  saleStatusUpdates: Array<{ orderId: string; status: "completed" | "returned" }>;
  summary: {
    documents: number;
    lines: number;
    creates: number;
    adopts: number;
    updates: number;
    unchanged: number;
    conflicts: number;
    preserves: number;
    unresolvedProducts: number;
    linkageExceptions: number;
    linkedInvoices: number;
    linkedItems: number;
    partialReturns: number;
    preservedLines: number;
    parentStatusUpdates: number;
  };
}

function nullableText(value: unknown): string | null {
  return normalizeKiotVietText(value) || null;
}

function uniqueByKey<T>(values: T[], keyOf: (value: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = normalizeKiotVietText(keyOf(value));
    if (!key) throw new Error(`KiotViet return ${label} cannot be blank`);
    if (result.has(key)) throw new Error(`Duplicate KiotViet return ${label}: ${key}`);
    result.set(key, value);
  }
  return result;
}

function sourceProductKey(sku: string, sourceUnitName: string): string {
  const normalizedSku = normalizeKiotVietText(sku);
  const normalizedUnit = normalizeKiotVietText(sourceUnitName).toLocaleLowerCase("vi");
  if (!normalizedSku || !normalizedUnit) {
    throw new Error("KiotViet return product resolution requires source SKU and source unit");
  }
  return `${normalizedSku}\u0000${normalizedUnit}`;
}

function productForSourceRow(input: {
  productsBySourceKey: Map<string, KiotVietResolvedReturnProduct>;
  sku: string;
  sourceUnitName: string | null;
}): KiotVietResolvedReturnProduct | undefined {
  if (input.sourceUnitName) {
    return input.productsBySourceKey.get(sourceProductKey(input.sku, input.sourceUnitName));
  }
  const candidates = [...input.productsBySourceKey.values()].filter((candidate) => candidate.sku === input.sku);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function returnStatus(value: unknown): KiotVietReturnSnapshot["status"] {
  const status = normalizeKiotVietText(value).toLocaleLowerCase("vi");
  if (status === "hoàn thành" || status === "đã trả") return "completed";
  if (status === "đã hủy") return "cancelled";
  throw new Error(`Unsupported KiotViet return status: ${normalizeKiotVietText(value)}`);
}

function settlementStatus(payable: number, paid: number): KiotVietReturnSnapshot["settlementStatus"] {
  if (payable <= 0 || paid >= payable) return "settled";
  return paid > 0 ? "partial" : "unsettled";
}

function paymentSnapshots(row: KiotVietDataRow): KiotVietReturnPaymentSnapshot[] {
  const channels = [
    ["Tiền mặt", "cash"],
    ["Thẻ", "card"],
    ["Chuyển khoản", "bank_transfer"],
    ["Ví", "wallet"],
    ["Điểm", "points"],
  ] as const;
  return channels.flatMap(([column, channel]) => {
    const amount = Math.abs(normalizeKiotVietNumber(row[column]));
    return amount > 0 ? [{ channel, amount }] : [];
  });
}

function sourceReturnFingerprint(value: KiotVietReturnSnapshot): string {
  return stableKiotVietFingerprint(value);
}

function sourceLineFingerprint(value: KiotVietReturnLineSnapshot): string {
  return stableKiotVietFingerprint({
    sourceSku: value.sourceSku,
    quantity: value.quantity,
    unitPrice: value.unitPrice,
    total: value.total,
  });
}

function currentLineFingerprint(value: KiotVietReturnCurrentLine): string | null {
  const sourceSku = nullableText(value.legacyProductSku) ?? nullableText(value.sourceSku);
  if (!value.legacyImported || !sourceSku || value.quantity == null || value.unitPrice == null || value.total == null) {
    return null;
  }
  return stableKiotVietFingerprint({
    sourceSku,
    quantity: normalizeKiotVietNumber(value.quantity),
    unitPrice: normalizeKiotVietNumber(value.unitPrice),
    total: normalizeKiotVietNumber(value.total),
  });
}

function assertReconciledReturns(rows: KiotVietDataRow[]): void {
  assertKiotVietDocumentReconciliation(rows, {
    codeColumn: RETURN_CODE,
    headerTotalColumn: "Tổng tiền hàng trả",
    lineQuantityColumn: "Số lượng",
    lineUnitPriceColumn: "Giá nhập lại",
    roundEachLine: true,
    payableColumn: "Cần trả khách",
    subtractHeaderColumns: ["Giảm giá phiếu trả", "Phí trả hàng"],
    addHeaderColumns: ["VAT hoàn lại", "Thu khác hoàn lại"],
    paidColumn: "Đã trả khách",
    paymentColumns: ["Tiền mặt", "Thẻ", "Chuyển khoản", "Ví", "Điểm"],
    paymentAbsolute: true,
  });
}

function exactOrderItem(input: {
  sale: KiotVietReturnSale | undefined;
  sourceSku: string;
  sourceUnitName: string;
}): { itemId: string | null; exception?: "unsafe_item_match" | "ambiguous_item_match" } {
  if (!input.sale) return { itemId: null };
  const candidates = input.sale.items.filter((item) => (
    normalizeKiotVietText(item.sourceSku) === input.sourceSku
    && normalizeKiotVietText(item.unitName).toLocaleLowerCase("vi")
      === normalizeKiotVietText(input.sourceUnitName).toLocaleLowerCase("vi")
  ));
  if (candidates.length === 1) return { itemId: candidates[0]!.localId };
  return { itemId: null, exception: candidates.length === 0 ? "unsafe_item_match" : "ambiguous_item_match" };
}

function returnSourceRows(input: {
  sourceRows: KiotVietDataRow[];
  productsBySourceKey: Map<string, KiotVietResolvedReturnProduct>;
  salesByInvoice: Map<string, KiotVietReturnSale>;
  blockers: KiotVietReturnSyncPlan["blockers"];
  linkageExceptions: KiotVietReturnSyncPlan["linkageExceptions"];
}): KiotVietReturnSnapshot[] {
  return groupKiotVietDocumentRows(input.sourceRows, {
    codeColumn: RETURN_CODE,
    consistentHeaderColumns: [
      "Mã hóa đơn", "Thời gian", "Ghi chú", "Tổng tiền hàng trả", "Giảm giá phiếu trả",
      "VAT hoàn lại", "Thu khác hoàn lại", "Phí trả hàng", "Cần trả khách", "Đã trả khách",
      "Tiền mặt", "Thẻ", "Chuyển khoản", "Ví", "Điểm", "Trạng thái",
    ],
  }).map(({ externalId: code, rows }) => {
    const header = rows[0]!;
    const invoiceCode = nullableText(header["Mã hóa đơn"]);
    const sale = invoiceCode ? input.salesByInvoice.get(invoiceCode) : undefined;
    if (!invoiceCode) {
      input.linkageExceptions.push({ documentCode: code, reference: "__blank_invoice__", reason: "missing_invoice" });
    } else if (!sale) {
      input.linkageExceptions.push({ documentCode: code, reference: invoiceCode, reason: "missing_invoice" });
    }

    const canonicalLines = rows.flatMap((row) => {
      const sourceSku = normalizeKiotVietText(row["Mã hàng"]);
      const suppliedSourceUnitName = nullableText(row.ĐVT);
      const product = productForSourceRow({
        productsBySourceKey: input.productsBySourceKey,
        sku: sourceSku,
        sourceUnitName: suppliedSourceUnitName,
      });
      if (!product) {
        const hasSkuResolution = [...input.productsBySourceKey.values()].some((candidate) => candidate.sku === sourceSku);
        input.blockers.push({
          documentCode: code,
          reference: sourceSku,
          reason: hasSkuResolution ? "unresolved_product_unit" : "unresolved_product",
        });
        return [];
      }
      if (!Number.isFinite(product.unitMultiplier) || product.unitMultiplier <= 0) {
        throw new Error(`KiotViet return ${code} has invalid product unit multiplier for ${sourceSku}`);
      }
      const unitName = suppliedSourceUnitName ?? product.sourceUnitName;
      const orderItem = exactOrderItem({ sale, sourceSku, sourceUnitName: unitName });
      if (orderItem.exception) {
        input.linkageExceptions.push({ documentCode: code, reference: sourceSku, reason: orderItem.exception });
      }
      const sourceLine = {
        orderItemId: orderItem.itemId,
        productId: product.productId,
        sourceSku,
        productName: nullableText(row["Tên hàng"]) ?? sourceSku,
        unitName,
        unitMultiplier: product.unitMultiplier,
        quantity: normalizeKiotVietNumber(row["Số lượng"]),
        unitPrice: normalizeKiotVietNumber(row["Giá nhập lại"]),
        total: Math.round(normalizeKiotVietNumber(row["Số lượng"]) * normalizeKiotVietNumber(row["Giá nhập lại"])),
        restock: false as const,
      };
      return [{
        occurrenceKey: sourceProductKey(sourceSku, unitName),
        occurrenceFingerprint: stableKiotVietFingerprint(sourceLine),
        sourceLine,
      }];
    });
    canonicalLines.sort((left, right) => (
      left.occurrenceKey.localeCompare(right.occurrenceKey)
      || left.occurrenceFingerprint.localeCompare(right.occurrenceFingerprint)
    ));
    const occurrences = new Map<string, number>();
    const lines = canonicalLines.map(({ occurrenceKey, sourceLine }) => {
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      return {
        externalId: buildKiotVietChildExternalId({
          documentCode: code,
          sku: sourceLine.sourceSku,
          unitName: sourceLine.unitName,
          occurrence,
        }),
        ...sourceLine,
      };
    }).sort((left, right) => left.externalId.localeCompare(right.externalId));
    const payable = normalizeKiotVietNumber(header["Cần trả khách"]);
    const paid = Math.abs(normalizeKiotVietNumber(header["Đã trả khách"]));
    return {
      code,
      invoiceCode,
      orderId: sale?.orderId ?? null,
      customerId: sale?.customerId ?? null,
      status: returnStatus(header["Trạng thái"]),
      createdAt: normalizeKiotVietDate(header["Thời gian"]),
      subtotal: normalizeKiotVietNumber(header["Tổng tiền hàng trả"]),
      discount: normalizeKiotVietNumber(header["Giảm giá phiếu trả"]),
      tax: normalizeKiotVietNumber(header["VAT hoàn lại"]),
      otherRefund: normalizeKiotVietNumber(header["Thu khác hoàn lại"]),
      returnFee: normalizeKiotVietNumber(header["Phí trả hàng"]),
      totalRefund: payable,
      refundAmount: paid,
      settlementStatus: settlementStatus(payable, paid),
      note: nullableText(header["Ghi chú"]),
      paymentSnapshots: paymentSnapshots(header),
      lines,
    };
  });
}

function childWrites(input: {
  documentCode: string;
  parentId: string | undefined;
  values: KiotVietReturnLineSnapshot[];
  mappings: Map<string, KiotVietEntityMappingSnapshot>;
  currentById: Map<string, KiotVietReturnCurrentLine>;
  allowLegacyAdoption: boolean;
  blockers: KiotVietReturnSyncPlan["blockers"];
}): { writes: Array<{ externalId: string; localId?: string; line: Omit<KiotVietReturnLineSnapshot, "externalId"> }>; preservedIds: string[] } {
  if (!input.parentId) {
    for (const value of input.values) {
      const mapping = input.mappings.get(value.externalId);
      if (!mapping) continue;
      const current = input.currentById.get(mapping.localId);
      input.blockers.push({
        documentCode: input.documentCode,
        reference: value.externalId,
        reason: current ? "mapped_line_parent_mismatch" : "mapped_line_missing",
      });
    }
    return { writes: input.values.map(({ externalId, ...line }) => ({ externalId, line })), preservedIds: [] };
  }

  const selectedIds = new Set<string>();
  const mappedCurrentByExternalId = new Map<string, KiotVietReturnCurrentLine>();
  let childIdentityFailure = false;
  for (const value of input.values) {
    const mapping = input.mappings.get(value.externalId);
    if (!mapping) continue;
    const current = input.currentById.get(mapping.localId);
    if (!current) {
      input.blockers.push({ documentCode: input.documentCode, reference: value.externalId, reason: "mapped_line_missing" });
      childIdentityFailure = true;
      continue;
    }
    if (current.returnId !== input.parentId) {
      input.blockers.push({ documentCode: input.documentCode, reference: value.externalId, reason: "mapped_line_parent_mismatch" });
      childIdentityFailure = true;
      continue;
    }
    if (selectedIds.has(current.localId)) {
      input.blockers.push({ documentCode: input.documentCode, reference: value.externalId, reason: "duplicate_local_child_write" });
      childIdentityFailure = true;
      continue;
    }
    selectedIds.add(current.localId);
    mappedCurrentByExternalId.set(value.externalId, current);
  }

  const legacyCurrentByExternalId = new Map<string, KiotVietReturnCurrentLine>();
  const unmatchedSourceExternalIds: string[] = [];
  if (input.allowLegacyAdoption) {
    for (const value of [...input.values].sort((left, right) => left.externalId.localeCompare(right.externalId))) {
      if (mappedCurrentByExternalId.has(value.externalId) || input.mappings.has(value.externalId)) continue;
      const candidates = [...input.currentById.values()].filter((current) => (
        current.returnId === input.parentId
        && !selectedIds.has(current.localId)
        && currentLineFingerprint(current) === sourceLineFingerprint(value)
      ));
      if (candidates.length > 1) {
        input.blockers.push({ documentCode: input.documentCode, reference: value.externalId, reason: "ambiguous_legacy_line_match" });
        childIdentityFailure = true;
        continue;
      }
      const legacy = candidates[0];
      if (!legacy) {
        unmatchedSourceExternalIds.push(value.externalId);
        continue;
      }
      selectedIds.add(legacy.localId);
      legacyCurrentByExternalId.set(value.externalId, legacy);
    }
    const unmatchedLegacyIds = [...input.currentById.values()]
      .filter((current) => current.returnId === input.parentId && !selectedIds.has(current.localId) && currentLineFingerprint(current) != null)
      .map((current) => current.localId)
      .sort((left, right) => left.localeCompare(right));
    if (!childIdentityFailure && unmatchedLegacyIds.length > 0) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: unmatchedSourceExternalIds.sort((left, right) => left.localeCompare(right))[0] ?? unmatchedLegacyIds[0]!,
        reason: "legacy_line_unmatched",
      });
    }
  }
  const writes = input.values.map(({ externalId, ...line }) => {
    const current = mappedCurrentByExternalId.get(externalId) ?? legacyCurrentByExternalId.get(externalId);
    return current ? { externalId, localId: current.localId, line } : { externalId, line };
  });
  const preservedIds = [...input.currentById.values()]
    .filter((current) => current.returnId === input.parentId && !selectedIds.has(current.localId))
    .map((current) => current.localId)
    .sort((left, right) => left.localeCompare(right));
  return { writes, preservedIds };
}

function saleStatusUpdates(input: {
  sales: KiotVietReturnSale[];
  existingLines: KiotVietReturnCurrentLine[];
  writes: KiotVietReturnWrite[];
  blockers: KiotVietReturnSyncPlan["blockers"];
}): Array<{ orderId: string; status: "completed" | "returned" }> {
  const contributionByLineId = new Map<string, { orderItemId: string; quantity: number }>();
  for (const line of input.existingLines) {
    if (line.active === false || !line.orderItemId || line.quantity == null) continue;
    contributionByLineId.set(line.localId, {
      orderItemId: line.orderItemId,
      quantity: normalizeKiotVietNumber(line.quantity),
    });
  }
  const returnedBySaleItem = new Map<string, number>();
  for (const contribution of contributionByLineId.values()) {
    returnedBySaleItem.set(
      contribution.orderItemId,
      (returnedBySaleItem.get(contribution.orderItemId) ?? 0) + contribution.quantity,
    );
  }
  for (const write of input.writes) {
    for (const line of write.return.lines) {
      if (line.localId) {
        const old = contributionByLineId.get(line.localId);
        if (old) returnedBySaleItem.set(old.orderItemId, (returnedBySaleItem.get(old.orderItemId) ?? 0) - old.quantity);
      }
      if (write.return.status !== "completed") continue;
      if (!line.line.orderItemId) continue;
      returnedBySaleItem.set(
        line.line.orderItemId,
        (returnedBySaleItem.get(line.line.orderItemId) ?? 0) + line.line.quantity,
      );
    }
  }
  const updates: Array<{ orderId: string; status: "completed" | "returned" }> = [];
  for (const sale of input.sales) {
    let fullyReturned = sale.items.length > 0;
    for (const item of sale.items) {
      const returned = returnedBySaleItem.get(item.localId) ?? 0;
      const sold = normalizeKiotVietNumber(item.quantity);
      if (returned > sold + 0.0001) {
        input.blockers.push({ documentCode: sale.invoiceCode, reference: item.localId, reason: "over_returned_sale_item" });
      }
      if (returned < sold - 0.0001 || returned > sold + 0.0001) fullyReturned = false;
    }
    const status = fullyReturned ? "returned" as const : "completed" as const;
    if (sale.status !== status) updates.push({ orderId: sale.orderId, status });
  }
  return updates.sort((left, right) => left.orderId.localeCompare(right.orderId));
}

export function planKiotVietReturnSync(input: {
  storeId: string;
  sourceRows: KiotVietDataRow[];
  current: KiotVietReturnCurrent[];
  mappings: KiotVietEntityMappingSnapshot[];
  lineMappings: KiotVietEntityMappingSnapshot[];
  existingLines: KiotVietReturnCurrentLine[];
  resolvedProducts: KiotVietResolvedReturnProduct[];
  sales: KiotVietReturnSale[];
}): KiotVietReturnSyncPlan {
  if (!normalizeKiotVietText(input.storeId)) throw new Error("KiotViet return store ID cannot be blank");
  assertReconciledReturns(input.sourceRows);
  const productsBySourceKey = uniqueByKey(input.resolvedProducts, (product) => sourceProductKey(product.sku, product.sourceUnitName), "product source identity");
  const salesByInvoice = uniqueByKey(input.sales, (sale) => sale.invoiceCode, "sale invoice identity");
  const lineMappings = uniqueByKey(input.lineMappings, (mapping) => mapping.externalId, "line mapping identity");
  const existingLines = uniqueByKey(input.existingLines, (line) => line.localId, "current line identity");
  const blockers: KiotVietReturnSyncPlan["blockers"] = [];
  const linkageExceptions: KiotVietReturnSyncPlan["linkageExceptions"] = [];
  const returns = returnSourceRows({
    sourceRows: input.sourceRows,
    productsBySourceKey,
    salesByInvoice,
    blockers,
    linkageExceptions,
  });
  const entityPlan = planKiotVietEntities({
    sources: returns.map((value) => ({ externalId: value.code, fingerprint: sourceReturnFingerprint(value) })),
    current: input.current.map((value) => ({
      localId: value.localId,
      code: value.code,
      fingerprint: value.fingerprint,
      legacyImported: value.legacyImported,
    })),
    mappings: input.mappings,
  });
  const returnsByCode = new Map(returns.map((value) => [value.code, value]));
  const parents: Array<{ action: "create" | "adopt" | "update"; externalId: string; localId?: string }> = [
    ...entityPlan.creates.map(({ externalId }) => ({ action: "create" as const, externalId })),
    ...entityPlan.adopts.filter((value) => value.needsUpdate).map(({ externalId, localId }) => ({ action: "adopt" as const, externalId, localId })),
    ...entityPlan.updates.map(({ externalId, localId }) => ({ action: "update" as const, externalId, localId })),
  ];
  const writes = parents.map(({ action, externalId, localId }) => {
    const snapshot = returnsByCode.get(externalId)!;
    const lines = childWrites({
      documentCode: externalId,
      parentId: localId,
      values: snapshot.lines,
      mappings: lineMappings,
      currentById: existingLines,
      allowLegacyAdoption: action === "adopt",
      blockers,
    });
    return {
      action,
      externalId,
      ...(localId ? { localId } : {}),
      return: {
        ...snapshot,
        lines: lines.writes.map(({ externalId: childExternalId, localId: childLocalId, line }) => ({
          action: childLocalId ? "update" as const : "create" as const,
          externalId: childExternalId,
          ...(childLocalId ? { localId: childLocalId } : {}),
          line,
        })),
        preservedLineIds: lines.preservedIds,
      },
    };
  });
  const statusUpdates = saleStatusUpdates({ sales: input.sales, existingLines: input.existingLines, writes, blockers });
  const preservedLineIds = writes.flatMap((write) => write.return.preservedLineIds)
    .sort((left, right) => left.localeCompare(right));
  const linkedInvoices = returns.filter((value) => value.orderId != null).length;
  const linkedItems = returns.flatMap((value) => value.lines).filter((line) => line.orderItemId != null).length;
  const partialReturns = returns.filter((value) => {
    if (value.status !== "completed" || !value.orderId) return false;
    const sale = salesByInvoice.get(value.invoiceCode ?? "");
    if (!sale) return false;
    const returnedByItem = new Map<string, number>();
    for (const line of value.lines) {
      if (!line.orderItemId) continue;
      returnedByItem.set(line.orderItemId, (returnedByItem.get(line.orderItemId) ?? 0) + line.quantity);
    }
    return sale.items.some((item) => (
      (returnedByItem.get(item.localId) ?? 0) < normalizeKiotVietNumber(item.quantity)
    ));
  }).length;
  return {
    returns,
    entityPlan,
    writes: blockers.length > 0 ? [] : writes,
    preservedLineIds,
    linkageExceptions,
    blockers,
    saleStatusUpdates: blockers.length > 0 ? [] : statusUpdates,
    summary: {
      documents: returns.length,
      lines: returns.reduce((sum, value) => sum + value.lines.length, 0),
      creates: entityPlan.creates.length,
      adopts: entityPlan.adopts.length,
      updates: entityPlan.updates.length,
      unchanged: entityPlan.unchanged.length,
      conflicts: entityPlan.conflicts.length,
      preserves: entityPlan.preserves.length,
      unresolvedProducts: blockers.filter((value) => value.reason === "unresolved_product" || value.reason === "unresolved_product_unit").length,
      linkageExceptions: linkageExceptions.length,
      linkedInvoices,
      linkedItems,
      partialReturns,
      preservedLines: preservedLineIds.length,
      parentStatusUpdates: blockers.length > 0 ? 0 : statusUpdates.length,
    },
  };
}
