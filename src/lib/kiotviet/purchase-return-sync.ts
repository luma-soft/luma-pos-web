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

const PURCHASE_RETURN_CODE = "Mã trả hàng nhập";

export type KiotVietPurchaseReturnProductResolutionSource =
  | "current_base"
  | "alternate_unit"
  | "archived_mapping"
  | "approved_historical_placeholder";

export interface KiotVietResolvedPurchaseReturnSupplier {
  code: string;
  supplierId: string;
}

export interface KiotVietResolvedPurchaseReturnProduct {
  sku: string;
  productId: string;
  unitName: string;
  sourceUnitName: string;
  unitMultiplier: number;
  resolutionSource: KiotVietPurchaseReturnProductResolutionSource;
}

export interface KiotVietPurchaseReturnCurrent {
  localId: string;
  code: string | null;
  fingerprint: string;
  settlementStatus: "unsettled" | "partial" | "settled";
  legacyImported: boolean;
  /** Exact old-importer parent + complete-child evidence, reconstructed by the loader. */
  legacyBootstrapFingerprint?: string;
}

export interface KiotVietPurchaseReturnCurrentLine {
  localId: string;
  purchaseReturnId: string;
  legacyImported?: boolean;
  legacyAdoptionEligible?: boolean;
  /** Supplied by the loader by joining the legacy row to its product. */
  legacyProductSku?: string;
  sourceSku?: string;
  quantity?: number | string;
  unitCost?: number | string;
  returnUnitCost?: number | string;
  total?: number | string;
}

export interface KiotVietPurchaseReturnLineSnapshot {
  externalId: string;
  purchaseOrderItemId: null;
  productId: string;
  sourceSku: string;
  productName: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  unitCost: number;
  returnUnitCost: number;
  total: number;
}

export interface KiotVietPurchaseReturnSnapshot {
  code: string;
  purchaseOrderId: null;
  supplierId: string;
  status: "completed" | "draft";
  settlementStatus: "unsettled" | "partial" | "settled";
  subtotal: number;
  discount: number;
  vatRate: number;
  tax: number;
  totalRefund: number;
  refundAmount: number;
  refundMethod: "cash" | null;
  debtAmount: number;
  note: string | null;
  createdAt: Date;
  lines: KiotVietPurchaseReturnLineSnapshot[];
}

export interface KiotVietPurchaseReturnLineWrite {
  action: "create" | "adopt" | "update";
  adoptionMethod: "created" | "legacy_adopted" | "mapped";
  externalId: string;
  localId?: string;
  line: Omit<KiotVietPurchaseReturnLineSnapshot, "externalId">;
}

export interface KiotVietPurchaseReturnWrite {
  action: "create" | "adopt" | "update";
  externalId: string;
  localId?: string;
  purchaseReturn: Omit<KiotVietPurchaseReturnSnapshot, "lines"> & {
    lines: KiotVietPurchaseReturnLineWrite[];
    preservedLineIds: string[];
  };
}

type KiotVietPurchaseReturnBlockerReason =
  | "unresolved_supplier"
  | "unresolved_product"
  | "unresolved_product_unit"
  | "parent_identity_conflict"
  | "mapped_line_missing"
  | "mapped_line_parent_mismatch"
  | "duplicate_local_child_write"
  | "ambiguous_legacy_line_match"
  | "legacy_line_unmatched";

export interface KiotVietPurchaseReturnSyncPlan {
  returns: KiotVietPurchaseReturnSnapshot[];
  entityPlan: KiotVietEntitySyncPlan;
  writes: KiotVietPurchaseReturnWrite[];
  preservedLineIds: string[];
  blockers: Array<{
    documentCode: string;
    reference: string;
    reason: KiotVietPurchaseReturnBlockerReason;
  }>;
  /** Supplier-return history is ledger-only and never emits operational work. */
  operationalEffects: readonly [];
  summary: {
    documents: number;
    sourceLines: number;
    lines: number;
    creates: number;
    adopts: number;
    updates: number;
    unchanged: number;
    conflicts: number;
    preserves: number;
    unresolvedSuppliers: number;
    unresolvedProducts: number;
    preservedLines: number;
    settlementStatusRepairs: number;
  };
}

function nullableText(value: unknown): string | null {
  return normalizeKiotVietText(value) || null;
}

function uniqueByKey<T>(values: T[], keyOf: (value: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = normalizeKiotVietText(keyOf(value));
    if (!key) throw new Error(`KiotViet purchase return ${label} cannot be blank`);
    if (result.has(key)) throw new Error(`Duplicate KiotViet purchase return ${label}: ${key}`);
    result.set(key, value);
  }
  return result;
}

function sourceProductKey(sku: string, sourceUnitName: string): string {
  const normalizedSku = normalizeKiotVietText(sku);
  const normalizedUnit = normalizeKiotVietText(sourceUnitName).toLocaleLowerCase("vi");
  if (!normalizedSku || !normalizedUnit) {
    throw new Error("KiotViet purchase return requires source SKU and source unit");
  }
  return `${normalizedSku}\u0000${normalizedUnit}`;
}

function purchaseReturnStatus(value: unknown): KiotVietPurchaseReturnSnapshot["status"] {
  const status = normalizeKiotVietText(value).toLocaleLowerCase("vi");
  if (status === "đã trả hàng" || status === "hoàn thành") return "completed";
  if (status === "đã hủy" || status === "phiếu tạm") return "draft";
  throw new Error(`Unsupported KiotViet purchase return status: ${normalizeKiotVietText(value)}`);
}

function settlementStatus(total: number, paid: number): KiotVietPurchaseReturnSnapshot["settlementStatus"] {
  if (paid <= 0) return "unsettled";
  if (paid < total) return "partial";
  return "settled";
}

export function kiotVietPurchaseReturnFingerprint(value: KiotVietPurchaseReturnSnapshot): string {
  const { lines, ...parent } = value;
  const normalizedLines = lines.map(withoutKiotVietExternalId)
    .sort((left, right) => stableKiotVietFingerprint(left).localeCompare(stableKiotVietFingerprint(right)));
  return stableKiotVietFingerprint({ ...parent, lines: normalizedLines });
}

export function kiotVietPurchaseReturnLegacyBootstrapFingerprint(
  value: KiotVietPurchaseReturnSnapshot,
): string {
  const normalizedLines = value.lines.map(withoutKiotVietExternalId)
    .sort((left, right) => stableKiotVietFingerprint(left).localeCompare(stableKiotVietFingerprint(right)));
  return stableKiotVietFingerprint({
    code: value.code,
    purchaseOrderId: value.purchaseOrderId,
    supplierId: value.supplierId,
    status: value.status,
    settlementStatus: value.settlementStatus,
    subtotal: value.subtotal,
    discount: value.discount,
    vatRate: value.vatRate,
    tax: value.tax,
    totalRefund: value.totalRefund,
    refundAmount: value.refundAmount,
    refundMethod: value.refundMethod,
    debtAmount: value.debtAmount,
    createdAt: value.createdAt,
    sourceNoteWasBlank: value.note == null,
    lines: normalizedLines,
  });
}

function sourceLineFingerprint(value: KiotVietPurchaseReturnLineSnapshot): string {
  return stableKiotVietFingerprint({
    sourceSku: value.sourceSku,
    quantity: value.quantity,
    unitCost: value.unitCost,
    returnUnitCost: value.returnUnitCost,
    total: value.total,
  });
}

function currentLineFingerprint(value: KiotVietPurchaseReturnCurrentLine): string | null {
  const sourceSku = nullableText(value.legacyProductSku) ?? nullableText(value.sourceSku);
  if (
    (!value.legacyImported && !value.legacyAdoptionEligible)
    || !sourceSku
    || value.quantity == null
    || value.unitCost == null
    || value.returnUnitCost == null
    || value.total == null
  ) return null;
  return stableKiotVietFingerprint({
    sourceSku,
    quantity: normalizeKiotVietNumber(value.quantity),
    unitCost: normalizeKiotVietNumber(value.unitCost),
    returnUnitCost: normalizeKiotVietNumber(value.returnUnitCost),
    total: normalizeKiotVietNumber(value.total),
  });
}

function assertReconciledPurchaseReturns(rows: KiotVietDataRow[]): void {
  assertKiotVietDocumentReconciliation(rows, {
    codeColumn: PURCHASE_RETURN_CODE,
    headerTotalColumn: "Tổng tiền hàng trả",
    lineTotalColumn: "Thành tiền",
    payableColumn: "NCC cần trả",
    subtractHeaderColumns: ["Giảm giá"],
    addHeaderColumns: ["VAT trả hàng nhập"],
  });
}

function sourceReturns(input: {
  sourceRows: KiotVietDataRow[];
  suppliersByCode: Map<string, KiotVietResolvedPurchaseReturnSupplier>;
  productsBySourceKey: Map<string, KiotVietResolvedPurchaseReturnProduct>;
  blockers: KiotVietPurchaseReturnSyncPlan["blockers"];
}): KiotVietPurchaseReturnSnapshot[] {
  return groupKiotVietDocumentRows(input.sourceRows, {
    codeColumn: PURCHASE_RETURN_CODE,
    consistentHeaderColumns: [
      "Thời gian", "Mã nhà cung cấp", "Tổng tiền hàng trả", "Giảm giá",
      "VAT trả hàng nhập", "NCC cần trả", "Tiền NCC trả", "Trạng thái", "Ghi chú",
    ],
  }).map(({ externalId: code, rows }) => {
    const header = rows[0]!;
    const supplierCode = normalizeKiotVietText(header["Mã nhà cung cấp"]);
    const supplier = input.suppliersByCode.get(supplierCode);
    if (!supplier) {
      input.blockers.push({
        documentCode: code,
        reference: supplierCode || "__blank_supplier__",
        reason: "unresolved_supplier",
      });
    }

    const canonicalLines = rows.flatMap((row) => {
      const sourceSku = normalizeKiotVietText(row["Mã hàng"]);
      const sourceUnitName = normalizeKiotVietText(row.ĐVT);
      if (!sourceSku || !sourceUnitName) {
        throw new Error("KiotViet purchase return requires source SKU and source unit");
      }
      const product = input.productsBySourceKey.get(sourceProductKey(sourceSku, sourceUnitName));
      if (!product) {
        const hasSkuResolution = [...input.productsBySourceKey.values()]
          .some((candidate) => normalizeKiotVietText(candidate.sku) === sourceSku);
        input.blockers.push({
          documentCode: code,
          reference: sourceSku,
          reason: hasSkuResolution ? "unresolved_product_unit" : "unresolved_product",
        });
        return [];
      }
      if (!Number.isFinite(product.unitMultiplier) || product.unitMultiplier <= 0) {
        throw new Error(`KiotViet purchase return ${code} has invalid product unit multiplier for ${sourceSku}`);
      }
      const returnUnitCost = normalizeKiotVietNumber(row["Giá trả lại"]);
      const sourceLine = {
        purchaseOrderItemId: null,
        productId: product.productId,
        sourceSku,
        productName: nullableText(row["Tên hàng"]) ?? sourceSku,
        unitName: sourceUnitName,
        unitMultiplier: product.unitMultiplier,
        quantity: normalizeKiotVietNumber(row["Số lượng"]),
        unitCost: returnUnitCost,
        returnUnitCost,
        total: normalizeKiotVietNumber(row["Thành tiền"]),
      };
      return [{
        occurrenceKey: sourceProductKey(sourceSku, sourceUnitName),
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

    const totalRefund = normalizeKiotVietNumber(header["NCC cần trả"]);
    const refundAmount = normalizeKiotVietNumber(header["Tiền NCC trả"]);
    return {
      code,
      purchaseOrderId: null,
      supplierId: supplier?.supplierId ?? "",
      status: purchaseReturnStatus(header["Trạng thái"]),
      settlementStatus: settlementStatus(totalRefund, refundAmount),
      subtotal: normalizeKiotVietNumber(header["Tổng tiền hàng trả"]),
      discount: normalizeKiotVietNumber(header["Giảm giá"]),
      vatRate: 0,
      tax: normalizeKiotVietNumber(header["VAT trả hàng nhập"]),
      totalRefund,
      refundAmount,
      refundMethod: refundAmount > 0 ? "cash" : null,
      debtAmount: Math.max(0, totalRefund - refundAmount),
      note: nullableText(header["Ghi chú"]),
      createdAt: normalizeKiotVietDate(header["Thời gian"]),
      lines,
    };
  });
}

function childWrites(input: {
  documentCode: string;
  parentId: string | undefined;
  values: KiotVietPurchaseReturnLineSnapshot[];
  mappings: Map<string, KiotVietEntityMappingSnapshot>;
  currentById: Map<string, KiotVietPurchaseReturnCurrentLine>;
  allowLegacyAdoption: boolean;
  blockers: KiotVietPurchaseReturnSyncPlan["blockers"];
}): {
  writes: Array<{
    action: "create" | "adopt" | "update";
    adoptionMethod: "created" | "legacy_adopted" | "mapped";
    externalId: string;
    localId?: string;
    line: Omit<KiotVietPurchaseReturnLineSnapshot, "externalId">;
  }>;
  preservedIds: string[];
} {
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
    return {
      writes: input.values.map(({ externalId, ...line }) => ({
        action: "create" as const,
        adoptionMethod: "created" as const,
        externalId,
        line,
      })),
      preservedIds: [],
    };
  }

  const selectedIds = new Set<string>();
  const reservedMappedIds = new Set<string>();
  const sourceExternalIds = new Set(input.values.map((value) => value.externalId));
  for (const [externalId, mapping] of [...input.mappings.entries()]
    .sort(([left], [right]) => left.localeCompare(right))) {
    if (sourceExternalIds.has(externalId)) continue;
    const current = input.currentById.get(mapping.localId);
    if (current?.purchaseReturnId === input.parentId) {
      reservedMappedIds.add(current.localId);
    }
  }
  const mappedCurrentByExternalId = new Map<string, KiotVietPurchaseReturnCurrentLine>();
  let childIdentityFailure = false;
  for (const value of input.values) {
    const mapping = input.mappings.get(value.externalId);
    if (!mapping) continue;
    const current = input.currentById.get(mapping.localId);
    if (!current) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: value.externalId,
        reason: "mapped_line_missing",
      });
      childIdentityFailure = true;
      continue;
    }
    if (current.purchaseReturnId !== input.parentId) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: value.externalId,
        reason: "mapped_line_parent_mismatch",
      });
      childIdentityFailure = true;
      continue;
    }
    if (selectedIds.has(current.localId)) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: value.externalId,
        reason: "duplicate_local_child_write",
      });
      childIdentityFailure = true;
      continue;
    }
    selectedIds.add(current.localId);
    mappedCurrentByExternalId.set(value.externalId, current);
  }

  const legacyCurrentByExternalId = new Map<string, KiotVietPurchaseReturnCurrentLine>();
  const unmatchedSourceExternalIds: string[] = [];
  if (input.allowLegacyAdoption) {
    for (const value of input.values) {
      if (mappedCurrentByExternalId.has(value.externalId) || input.mappings.has(value.externalId)) continue;
      const fingerprint = sourceLineFingerprint(value);
      const candidates = [...input.currentById.values()].filter((current) => (
        current.purchaseReturnId === input.parentId
        && !selectedIds.has(current.localId)
        && !reservedMappedIds.has(current.localId)
        && currentLineFingerprint(current) === fingerprint
      ));
      if (candidates.length > 1) {
        input.blockers.push({
          documentCode: input.documentCode,
          reference: value.externalId,
          reason: "ambiguous_legacy_line_match",
        });
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
      .filter((current) => (
        current.purchaseReturnId === input.parentId
        && !selectedIds.has(current.localId)
        && !reservedMappedIds.has(current.localId)
        && current.legacyImported === true
      ))
      .map((current) => current.localId)
      .sort((left, right) => left.localeCompare(right));
    if (!childIdentityFailure && unmatchedLegacyIds.length > 0) {
      input.blockers.push({
        documentCode: input.documentCode,
        reference: unmatchedSourceExternalIds.sort((left, right) => left.localeCompare(right))[0]
          ?? unmatchedLegacyIds[0]!,
        reason: "legacy_line_unmatched",
      });
    }
  }

  const writes = input.values.map(({ externalId, ...line }) => {
    const mapped = mappedCurrentByExternalId.get(externalId);
    if (mapped) {
      return {
        action: "update" as const,
        adoptionMethod: "mapped" as const,
        externalId,
        localId: mapped.localId,
        line,
      };
    }
    const legacy = legacyCurrentByExternalId.get(externalId);
    if (legacy) {
      return {
        action: "adopt" as const,
        adoptionMethod: "legacy_adopted" as const,
        externalId,
        localId: legacy.localId,
        line,
      };
    }
    return {
      action: "create" as const,
      adoptionMethod: "created" as const,
      externalId,
      line,
    };
  });
  const preservedIds = [...input.currentById.values()]
    .filter((current) => current.purchaseReturnId === input.parentId && !selectedIds.has(current.localId))
    .map((current) => current.localId)
    .sort((left, right) => left.localeCompare(right));
  return { writes, preservedIds };
}

export function planKiotVietPurchaseReturnSync(input: {
  storeId: string;
  sourceRows: KiotVietDataRow[];
  current: KiotVietPurchaseReturnCurrent[];
  mappings: KiotVietEntityMappingSnapshot[];
  lineMappings: KiotVietEntityMappingSnapshot[];
  existingLines: KiotVietPurchaseReturnCurrentLine[];
  resolvedSuppliers: KiotVietResolvedPurchaseReturnSupplier[];
  resolvedProducts: KiotVietResolvedPurchaseReturnProduct[];
}): KiotVietPurchaseReturnSyncPlan {
  if (!normalizeKiotVietText(input.storeId)) {
    throw new Error("KiotViet purchase return store ID cannot be blank");
  }
  assertReconciledPurchaseReturns(input.sourceRows);
  const suppliersByCode = uniqueByKey(
    input.resolvedSuppliers,
    (supplier) => supplier.code,
    "supplier code",
  );
  const productsBySourceKey = uniqueByKey(
    input.resolvedProducts,
    (product) => sourceProductKey(product.sku, product.sourceUnitName),
    "product source identity",
  );
  const lineMappings = uniqueByKey(
    input.lineMappings,
    (mapping) => mapping.externalId,
    "line mapping identity",
  );
  const existingLines = uniqueByKey(
    input.existingLines,
    (line) => line.localId,
    "current line identity",
  );
  const blockers: KiotVietPurchaseReturnSyncPlan["blockers"] = [];
  const returns = sourceReturns({
    sourceRows: input.sourceRows,
    suppliersByCode,
    productsBySourceKey,
    blockers,
  });
  const returnsByCode = new Map(returns.map((value) => [value.code, value]));
  const entityPlan = planKiotVietEntities({
    sources: returns.map((value) => ({
      externalId: value.code,
      fingerprint: kiotVietPurchaseReturnFingerprint(value),
    })),
    current: input.current.map((value) => ({
      ...value,
      legacyImported: value.legacyImported || (() => {
        const source = value.code == null ? undefined : returnsByCode.get(value.code);
        return source != null
          && value.legacyBootstrapFingerprint != null
          && value.legacyBootstrapFingerprint === kiotVietPurchaseReturnLegacyBootstrapFingerprint(source);
      })(),
    })),
    mappings: input.mappings,
  });
  for (const conflict of entityPlan.conflicts) {
    blockers.push({
      documentCode: conflict.externalId,
      reference: conflict.localId,
      reason: "parent_identity_conflict",
    });
  }
  const currentById = new Map(input.current.map((value) => [value.localId, value]));
  const needsChildProvenance = (externalId: string): boolean => (
    returnsByCode.get(externalId)?.lines.some((line) => !lineMappings.has(line.externalId)) ?? false
  );
  const parents: Array<{
    action: "create" | "adopt" | "update";
    externalId: string;
    localId?: string;
    emitWrite: boolean;
  }> = [
    ...entityPlan.creates.map(({ externalId }) => ({
      action: "create" as const, externalId, emitWrite: true,
    })),
    ...entityPlan.adopts
      .map(({ externalId, localId, needsUpdate }) => ({
        action: "adopt" as const,
        externalId,
        localId,
        emitWrite: needsUpdate || needsChildProvenance(externalId),
      })),
    ...entityPlan.updates
      .map(({ externalId, localId }) => ({
        action: "update" as const, externalId, localId, emitWrite: true,
      })),
    ...entityPlan.unchanged
      .map(({ externalId, localId }) => ({
        action: "update" as const,
        externalId,
        localId,
        emitWrite: needsChildProvenance(externalId),
      })),
  ];
  const candidateWrites = parents.map(({ action, externalId, localId, emitWrite }) => {
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
      emitWrite,
      action,
      externalId,
      ...(localId ? { localId } : {}),
      purchaseReturn: {
        ...snapshot,
        lines: lines.writes,
        preservedLineIds: lines.preservedIds,
      },
    };
  });
  const writes = candidateWrites
    .filter((write) => write.emitWrite)
    .map(({ action, externalId, localId, purchaseReturn }) => ({
      action,
      externalId,
      ...(localId ? { localId } : {}),
      purchaseReturn,
    }));
  const preservedLineIds = candidateWrites
    .flatMap((write) => write.purchaseReturn.preservedLineIds)
    .sort((left, right) => left.localeCompare(right));
  const settlementStatusRepairs = parents.filter((parent) => {
    if (!parent.localId) return false;
    const current = currentById.get(parent.localId);
    const source = returnsByCode.get(parent.externalId);
    return current != null && source != null
      && current.settlementStatus !== source.settlementStatus;
  }).length;

  return {
    returns,
    entityPlan,
    writes: blockers.length > 0 ? [] : writes,
    preservedLineIds,
    blockers,
    operationalEffects: [],
    summary: {
      documents: returns.length,
      sourceLines: input.sourceRows.length,
      lines: returns.reduce((sum, value) => sum + value.lines.length, 0),
      creates: entityPlan.creates.length,
      adopts: entityPlan.adopts.length,
      updates: entityPlan.updates.length,
      unchanged: entityPlan.unchanged.length,
      conflicts: entityPlan.conflicts.length,
      preserves: entityPlan.preserves.length,
      unresolvedSuppliers: blockers.filter((value) => value.reason === "unresolved_supplier").length,
      unresolvedProducts: blockers.filter((value) => (
        value.reason === "unresolved_product" || value.reason === "unresolved_product_unit"
      )).length,
      preservedLines: preservedLineIds.length,
      settlementStatusRepairs,
    },
  };
}
