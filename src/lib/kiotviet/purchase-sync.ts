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

const PURCHASE_CODE = "Mã nhập hàng";

export type KiotVietPurchaseProductResolutionSource =
  | "current_base"
  | "alternate_unit"
  | "archived_mapping"
  | "approved_historical_placeholder";

export interface KiotVietResolvedPurchaseSupplier {
  code: string;
  supplierId: string;
}

export interface KiotVietResolvedPurchaseProduct {
  sku: string;
  productId: string;
  unitName: string;
  sourceUnitName: string;
  unitMultiplier: number;
  resolutionSource: KiotVietPurchaseProductResolutionSource;
}

export interface KiotVietPurchaseCurrent {
  localId: string;
  code: string | null;
  fingerprint: string;
  subtotal: number | string;
  legacyImported: boolean;
  /** Exact old-importer parent + complete-child evidence, reconstructed by the loader. */
  legacyBootstrapFingerprint?: string;
}

export interface KiotVietPurchaseCurrentLine {
  localId: string;
  purchaseOrderId: string;
  legacyImported?: boolean;
  legacyAdoptionEligible?: boolean;
  /** SKU supplied by a store-loader join to the legacy line's product row. */
  legacyProductSku?: string;
  legacyProductName?: string;
  sourceSku?: string;
  unitName?: string;
  quantity?: number | string;
  unitCost?: number | string;
  discount?: number | string;
  total?: number | string;
}

export interface KiotVietPurchaseLineSnapshot {
  externalId: string;
  productId: string;
  sourceSku: string;
  productName: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  unitCost: number;
  discount: number;
  total: number;
}

export interface KiotVietPurchaseSnapshot {
  code: string;
  status: "received" | "draft";
  supplierId: string;
  createdAt: Date;
  subtotal: number;
  discount: number;
  vatRate: number;
  tax: number;
  total: number;
  amountPaid: number;
  invoiceNumber: string | null;
  note: string | null;
  lines: KiotVietPurchaseLineSnapshot[];
}

export interface KiotVietPurchaseLineWrite {
  action: "create" | "adopt" | "update";
  adoptionMethod: "created" | "legacy_adopted" | "mapped";
  externalId: string;
  localId?: string;
  line: Omit<KiotVietPurchaseLineSnapshot, "externalId">;
}

export interface KiotVietPurchaseWriteSnapshot extends Omit<KiotVietPurchaseSnapshot, "lines"> {
  lines: KiotVietPurchaseLineWrite[];
  preservedLineIds: string[];
}

export interface KiotVietPurchaseWrite {
  action: "create" | "adopt" | "update";
  externalId: string;
  localId?: string;
  purchase: KiotVietPurchaseWriteSnapshot;
}

type KiotVietPurchaseBlockerReason =
  | "unresolved_supplier"
  | "unresolved_unknown_supplier"
  | "unresolved_product"
  | "unresolved_product_unit"
  | "mapped_line_missing"
  | "mapped_line_parent_mismatch"
  | "ambiguous_legacy_line_match"
  | "legacy_line_unmatched"
  | "duplicate_local_child_write";

export interface KiotVietPurchaseSyncPlan {
  purchases: KiotVietPurchaseSnapshot[];
  entityPlan: KiotVietEntitySyncPlan;
  writes: KiotVietPurchaseWrite[];
  /** Child IDs intentionally left untouched when a write is blocked. */
  preservedLineIds: string[];
  blockers: Array<{ documentCode: string; reference: string; reason: KiotVietPurchaseBlockerReason }>;
  summary: {
    documents: number;
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
    subtotalRepairs: number;
  };
}

function nullableText(value: unknown): string | null {
  return normalizeKiotVietText(value) || null;
}

function uniqueByKey<T>(values: T[], keyOf: (value: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = normalizeKiotVietText(keyOf(value));
    if (!key) throw new Error(`KiotViet purchase ${label} cannot be blank`);
    if (result.has(key)) throw new Error(`Duplicate KiotViet purchase ${label}: ${key}`);
    result.set(key, value);
  }
  return result;
}

function sourceProductKey(sku: string, sourceUnitName: string): string {
  const normalizedSku = normalizeKiotVietText(sku);
  const normalizedUnit = normalizeKiotVietText(sourceUnitName).toLocaleLowerCase("vi");
  if (!normalizedSku || !normalizedUnit) {
    throw new Error("KiotViet purchase product resolution requires source SKU and source unit");
  }
  return `${normalizedSku}\u0000${normalizedUnit}`;
}

function productForSourceRow(input: {
  productsBySourceKey: Map<string, KiotVietResolvedPurchaseProduct>;
  sku: string;
  sourceUnitName: string | null;
}): KiotVietResolvedPurchaseProduct | undefined {
  if (input.sourceUnitName) {
    return input.productsBySourceKey.get(sourceProductKey(input.sku, input.sourceUnitName));
  }
  const candidates = [...input.productsBySourceKey.values()].filter((candidate) => candidate.sku === input.sku);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function purchaseStatus(value: unknown): KiotVietPurchaseSnapshot["status"] {
  const status = normalizeKiotVietText(value).toLocaleLowerCase("vi");
  if (status === "đã nhập hàng") return "received";
  if (status === "phiếu tạm") return "draft";
  throw new Error(`Unsupported KiotViet purchase status: ${normalizeKiotVietText(value)}`);
}

export function kiotVietPurchaseFingerprint(purchase: KiotVietPurchaseSnapshot): string {
  const { lines, ...parent } = purchase;
  const normalizedLines = lines.map(withoutKiotVietExternalId)
    .sort((left, right) => stableKiotVietFingerprint(left).localeCompare(stableKiotVietFingerprint(right)));
  return stableKiotVietFingerprint({ ...parent, lines: normalizedLines });
}

export function kiotVietPurchaseLegacyBootstrapFingerprint(
  purchase: Pick<KiotVietPurchaseSnapshot,
    "code" | "status" | "supplierId" | "createdAt" | "total" | "amountPaid" | "note"
  > & {
    lines: Array<Pick<KiotVietPurchaseLineSnapshot, "sourceSku" | "quantity" | "unitCost" | "total">>;
  },
): string {
  const lines = purchase.lines.map((line) => ({
    sourceSku: line.sourceSku,
    quantity: line.quantity,
    unitCost: line.unitCost,
    total: line.total,
  })).sort((left, right) => (
    stableKiotVietFingerprint(left).localeCompare(stableKiotVietFingerprint(right))
  ));
  return stableKiotVietFingerprint({
    code: purchase.code,
    status: purchase.status,
    supplierId: purchase.supplierId,
    createdAt: purchase.createdAt,
    total: purchase.total,
    amountPaid: purchase.amountPaid,
    note: purchase.note,
    lines,
  });
}

function sourceLineFingerprint(line: KiotVietPurchaseLineSnapshot): string {
  return stableKiotVietFingerprint({
    sourceSku: line.sourceSku,
    quantity: line.quantity,
    unitCost: line.unitCost,
    total: line.total,
  });
}

function sourceLineOccurrenceFingerprint(
  line: Omit<KiotVietPurchaseLineSnapshot, "externalId" | "productId">,
): string {
  return stableKiotVietFingerprint(line);
}

function currentLineFingerprint(line: KiotVietPurchaseCurrentLine): string | null {
  const sourceSku = nullableText(line.legacyProductSku) ?? nullableText(line.sourceSku);
  if (
    !line.legacyImported && !line.legacyAdoptionEligible
    || !sourceSku
    || line.quantity == null
    || line.unitCost == null
    || line.total == null
  ) return null;
  return stableKiotVietFingerprint({
    sourceSku,
    quantity: normalizeKiotVietNumber(line.quantity),
    unitCost: normalizeKiotVietNumber(line.unitCost),
    total: normalizeKiotVietNumber(line.total),
  });
}

function assertReconciledPurchases(rows: KiotVietDataRow[]): void {
  assertKiotVietDocumentReconciliation(rows, {
    codeColumn: PURCHASE_CODE,
    headerTotalColumn: "Tổng tiền hàng",
    lineTotalColumn: "Thành tiền",
    payableColumn: "Cần trả NCC",
    subtractHeaderColumns: ["Giảm giá phiếu nhập"],
    addHeaderColumns: ["VAT phiếu nhập"],
  });
}

function purchaseSourceRows(input: {
  sourceRows: KiotVietDataRow[];
  suppliersByCode: Map<string, KiotVietResolvedPurchaseSupplier>;
  unknownSupplierId: string | null;
  productsBySourceKey: Map<string, KiotVietResolvedPurchaseProduct>;
  blockers: KiotVietPurchaseSyncPlan["blockers"];
}): KiotVietPurchaseSnapshot[] {
  return groupKiotVietDocumentRows(input.sourceRows, {
    codeColumn: PURCHASE_CODE,
    consistentHeaderColumns: [
      "Thời gian", "Mã nhà cung cấp", "Ghi chú", "Số hóa đơn đầu vào",
      "Tổng tiền hàng", "Giảm giá phiếu nhập", "VAT nhập hàng", "VAT phiếu nhập",
      "Cần trả NCC", "Tiền đã trả NCC", "Trạng thái",
    ],
  }).map(({ externalId: code, rows }) => {
    const header = rows[0]!;
    const supplierCode = normalizeKiotVietText(header["Mã nhà cung cấp"]);
    const supplier = supplierCode ? input.suppliersByCode.get(supplierCode) : null;
    if (supplierCode && !supplier) {
      input.blockers.push({ documentCode: code, reference: supplierCode, reason: "unresolved_supplier" });
    }
    if (!supplierCode && !input.unknownSupplierId) {
      input.blockers.push({ documentCode: code, reference: "__kiotviet_unknown_supplier__", reason: "unresolved_unknown_supplier" });
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
        throw new Error(`KiotViet purchase ${code} has invalid product unit multiplier for ${sourceSku}`);
      }
      const sourceUnitName = suppliedSourceUnitName ?? product.sourceUnitName;
      const sourceLine = {
        sourceSku,
        productName: nullableText(row["Tên hàng"]) ?? sourceSku,
        unitName: sourceUnitName,
        unitMultiplier: product.unitMultiplier,
        quantity: normalizeKiotVietNumber(row["Số lượng"]),
        unitCost: normalizeKiotVietNumber(row["Giá nhập"]),
        discount: normalizeKiotVietNumber(row["Giảm giá"]),
        total: normalizeKiotVietNumber(row["Thành tiền"]),
      };
      return [{
        occurrenceKey: sourceProductKey(sourceSku, sourceUnitName),
        occurrenceFingerprint: sourceLineOccurrenceFingerprint(sourceLine),
        productId: product.productId,
        sourceLine,
      }];
    });
    canonicalLines.sort((left, right) => (
      left.occurrenceKey.localeCompare(right.occurrenceKey)
      || left.occurrenceFingerprint.localeCompare(right.occurrenceFingerprint)
    ));
    const occurrences = new Map<string, number>();
    const lines = canonicalLines.map(({ occurrenceKey, productId, sourceLine }) => {
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      return {
        externalId: buildKiotVietChildExternalId({
          documentCode: code,
          sku: sourceLine.sourceSku,
          unitName: sourceLine.unitName,
          occurrence,
        }),
        productId,
        ...sourceLine,
      };
    });
    lines.sort((left, right) => left.externalId.localeCompare(right.externalId));
    return {
      code,
      status: purchaseStatus(header["Trạng thái"]),
      supplierId: supplier?.supplierId ?? input.unknownSupplierId ?? "",
      createdAt: normalizeKiotVietDate(header["Thời gian"]),
      subtotal: normalizeKiotVietNumber(header["Tổng tiền hàng"]),
      discount: normalizeKiotVietNumber(header["Giảm giá phiếu nhập"]),
      vatRate: normalizeKiotVietNumber(header["VAT nhập hàng"]),
      tax: normalizeKiotVietNumber(header["VAT phiếu nhập"]),
      total: normalizeKiotVietNumber(header["Cần trả NCC"]),
      amountPaid: normalizeKiotVietNumber(header["Tiền đã trả NCC"]),
      invoiceNumber: nullableText(header["Số hóa đơn đầu vào"]),
      note: nullableText(header["Ghi chú"]),
      lines,
    };
  });
}

function childWrites(input: {
  documentCode: string;
  parentId: string | undefined;
  values: KiotVietPurchaseLineSnapshot[];
  mappings: Map<string, KiotVietEntityMappingSnapshot>;
  currentById: Map<string, KiotVietPurchaseCurrentLine>;
  allowLegacyAdoption: boolean;
  blockers: KiotVietPurchaseSyncPlan["blockers"];
}): { writes: Array<{ externalId: string; localId?: string; adoptionMethod: "created" | "legacy_adopted" | "mapped"; line: Omit<KiotVietPurchaseLineSnapshot, "externalId"> }>; preservedIds: string[] } {
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
      writes: input.values.map(({ externalId, ...line }) => ({ externalId, adoptionMethod: "created" as const, line })),
      preservedIds: [],
    };
  }

  // Mapping IDs are reserved before legacy matching so an earlier source
  // occurrence cannot steal an ID mapped to a later occurrence.
  const selectedIds = new Set<string>();
  const mappedCurrentByExternalId = new Map<string, KiotVietPurchaseCurrentLine>();
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
    if (current.purchaseOrderId !== input.parentId) {
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

  // Decide all fallback matches before emitting writes. A genuinely new source
  // line must not block a later source line that uniquely matches a legacy row.
  const legacyCurrentByExternalId = new Map<string, KiotVietPurchaseCurrentLine>();
  const unmatchedSourceExternalIds: string[] = [];
  if (input.allowLegacyAdoption) {
    for (const value of [...input.values].sort((left, right) => left.externalId.localeCompare(right.externalId))) {
      if (mappedCurrentByExternalId.has(value.externalId) || input.mappings.has(value.externalId)) continue;
      const fingerprint = sourceLineFingerprint(value);
      const candidates = [...input.currentById.values()].filter((current) => (
        current.purchaseOrderId === input.parentId
        && !selectedIds.has(current.localId)
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
        current.purchaseOrderId === input.parentId
        && !selectedIds.has(current.localId)
        && current.legacyImported === true
      ))
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
    const mapped = mappedCurrentByExternalId.get(externalId);
    if (mapped) return { externalId, localId: mapped.localId, adoptionMethod: "mapped" as const, line };
    const legacy = legacyCurrentByExternalId.get(externalId);
    if (legacy) return { externalId, localId: legacy.localId, adoptionMethod: "legacy_adopted" as const, line };
    return { externalId, adoptionMethod: "created" as const, line };
  });
  const preservedIds = [...input.currentById.values()]
    .filter((current) => current.purchaseOrderId === input.parentId && !selectedIds.has(current.localId))
    .map((current) => current.localId)
    .sort((left, right) => left.localeCompare(right));
  return { writes, preservedIds };
}

export function planKiotVietPurchaseSync(input: {
  storeId: string;
  sourceRows: KiotVietDataRow[];
  current: KiotVietPurchaseCurrent[];
  mappings: KiotVietEntityMappingSnapshot[];
  lineMappings: KiotVietEntityMappingSnapshot[];
  existingLines: KiotVietPurchaseCurrentLine[];
  resolvedSuppliers: KiotVietResolvedPurchaseSupplier[];
  unknownSupplierId: string | null;
  resolvedProducts: KiotVietResolvedPurchaseProduct[];
}): KiotVietPurchaseSyncPlan {
  if (!normalizeKiotVietText(input.storeId)) throw new Error("KiotViet purchase store ID cannot be blank");
  assertReconciledPurchases(input.sourceRows);
  const suppliersByCode = uniqueByKey(input.resolvedSuppliers, (supplier) => supplier.code, "supplier code");
  const productsBySourceKey = uniqueByKey(input.resolvedProducts, (product) => sourceProductKey(product.sku, product.sourceUnitName), "product source identity");
  const lineMappings = uniqueByKey(input.lineMappings, (mapping) => mapping.externalId, "line mapping identity");
  const existingLines = uniqueByKey(input.existingLines, (line) => line.localId, "current line identity");
  const blockers: KiotVietPurchaseSyncPlan["blockers"] = [];
  const purchases = purchaseSourceRows({
    sourceRows: input.sourceRows,
    suppliersByCode,
    unknownSupplierId: nullableText(input.unknownSupplierId),
    productsBySourceKey,
    blockers,
  });
  const purchasesByCode = new Map(purchases.map((purchase) => [purchase.code, purchase]));
  const entityPlan = planKiotVietEntities({
    sources: purchases.map((purchase) => ({ externalId: purchase.code, fingerprint: kiotVietPurchaseFingerprint(purchase) })),
    current: input.current.map((purchase) => ({
      localId: purchase.localId,
      code: purchase.code,
      fingerprint: purchase.fingerprint,
      legacyImported: purchase.legacyImported || (() => {
        const source = purchase.code == null ? undefined : purchasesByCode.get(purchase.code);
        return source != null
          && purchase.legacyBootstrapFingerprint != null
          && purchase.legacyBootstrapFingerprint === kiotVietPurchaseLegacyBootstrapFingerprint(source);
      })(),
    })),
    mappings: input.mappings,
  });
  const currentById = new Map(input.current.map((purchase) => [purchase.localId, purchase]));
  const needsChildProvenance = (externalId: string): boolean => (
    purchasesByCode.get(externalId)?.lines.some((line) => !lineMappings.has(line.externalId)) ?? false
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
    ...entityPlan.adopts.map(({ externalId, localId, needsUpdate }) => ({
      action: "adopt" as const,
      externalId,
      localId,
      emitWrite: needsUpdate || needsChildProvenance(externalId),
    })),
    ...entityPlan.updates.map(({ externalId, localId }) => ({
      action: "update" as const, externalId, localId, emitWrite: true,
    })),
    ...entityPlan.unchanged.map(({ externalId, localId }) => ({
      action: "update" as const,
      externalId,
      localId,
      emitWrite: needsChildProvenance(externalId),
    })),
  ];
  const writes = parents.map(({ action, externalId, localId, emitWrite }) => {
    const purchase = purchasesByCode.get(externalId)!;
    const lines = childWrites({
      documentCode: externalId,
      parentId: localId,
      values: purchase.lines,
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
      purchase: {
        ...purchase,
        lines: lines.writes.map(({ externalId: childExternalId, localId: childLocalId, adoptionMethod, line }) => ({
          action: adoptionMethod === "legacy_adopted" ? "adopt" as const : childLocalId ? "update" as const : "create" as const,
          adoptionMethod,
          externalId: childExternalId,
          ...(childLocalId ? { localId: childLocalId } : {}),
          line,
        })),
        preservedLineIds: lines.preservedIds,
      },
    };
  }).flatMap(({ emitWrite, ...write }) => emitWrite ? [write] : []);
  const subtotalRepairs = parents.filter((parent) => {
    if (!parent.localId) return false;
    const current = currentById.get(parent.localId);
    const purchase = purchasesByCode.get(parent.externalId);
    return current != null
      && purchase != null
      && normalizeKiotVietNumber(current.subtotal) === 0
      && purchase.subtotal !== 0;
  }).length;
  const preservedLineIds = writes
    .flatMap((write) => write.purchase.preservedLineIds)
    .sort((left, right) => left.localeCompare(right));

  return {
    purchases,
    entityPlan,
    writes: blockers.length > 0 ? [] : writes,
    preservedLineIds,
    blockers,
    summary: {
      documents: purchases.length,
      lines: purchases.reduce((sum, purchase) => sum + purchase.lines.length, 0),
      creates: entityPlan.creates.length,
      adopts: entityPlan.adopts.length,
      updates: entityPlan.updates.length,
      unchanged: entityPlan.unchanged.length,
      conflicts: entityPlan.conflicts.length,
      preserves: entityPlan.preserves.length,
      unresolvedSuppliers: blockers.filter((blocker) => blocker.reason === "unresolved_supplier" || blocker.reason === "unresolved_unknown_supplier").length,
      unresolvedProducts: blockers.filter((blocker) => blocker.reason === "unresolved_product" || blocker.reason === "unresolved_product_unit").length,
      preservedLines: preservedLineIds.length,
      subtotalRepairs,
    },
  };
}
