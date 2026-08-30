import type { KiotVietDataRow, KiotVietEntityMappingSnapshot, KiotVietEntitySyncPlan } from "./data-sync-types";
import {
  assertUniqueKiotVietCodes,
  normalizeKiotVietNumber,
  normalizeKiotVietText,
  planKiotVietEntities,
  stableKiotVietFingerprint,
} from "./data-sync-plan";

const SUPPLIER_CODE = "Mã nhà cung cấp";
const UNKNOWN_SUPPLIER_EXTERNAL_ID = "__kiotviet_unknown_supplier__";
const REVIEWED_SUPPLIER_DEBT_TOTAL = 69_447_521;
const REVIEWED_SUPPLIER_NET_PURCHASES_TOTAL = 4_032_549_434;

export interface KiotVietSupplierSource {
  externalId: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxCode: string | null;
  note: string | null;
  isActive: boolean;
  currentDebt: number;
  netPurchases: number;
}

export interface KiotVietSupplierCurrent {
  localId: string;
  code: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxCode: string | null;
  note: string | null;
  isActive: boolean;
  currentDebt: number | string;
  legacyImported: boolean;
}

export interface KiotVietSupplierHistoricalPlaceholder {
  externalId: string;
  code: string;
  name: string;
  isActive: false;
  currentDebt: 0;
}

export interface KiotVietUnknownSupplierPlaceholder {
  externalId: typeof UNKNOWN_SUPPLIER_EXTERNAL_ID;
  code: null;
  name: "KiotViet unknown supplier";
  phone: null;
  email: null;
  address: null;
  taxCode: null;
  note: null;
  isActive: false;
  currentDebt: 0;
}

type KiotVietManagedSupplier = Omit<KiotVietSupplierSource, "externalId" | "netPurchases">;

type KiotVietSupplierWrite =
  | {
    action: "create";
    externalId: string;
    localId?: undefined;
    supplier: KiotVietManagedSupplier;
  }
  | {
    action: "adopt" | "update";
    externalId: string;
    localId: string;
    supplier: KiotVietManagedSupplier;
  }
  | {
    action: "inactivate";
    externalId: string;
    localId: string;
    supplier: { isActive: false };
  }
  | {
    action: "historical_placeholder";
    externalId: string;
    localId?: undefined;
    supplier: KiotVietSupplierHistoricalPlaceholder;
  }
  | {
    action: "unknown_supplier_placeholder";
    externalId: typeof UNKNOWN_SUPPLIER_EXTERNAL_ID;
    localId?: undefined;
    supplier: KiotVietUnknownSupplierPlaceholder;
  };

export interface KiotVietSupplierSyncPlan {
  suppliers: KiotVietSupplierSource[];
  entityPlan: KiotVietEntitySyncPlan;
  inactivations: Array<{ externalId: string; localId: string }>;
  historicalPlaceholders: KiotVietSupplierHistoricalPlaceholder[];
  unknownSupplierPlaceholder: KiotVietUnknownSupplierPlaceholder | null;
  writes: KiotVietSupplierWrite[];
  sourceTotals: { currentDebt: number; netPurchases: number };
  summary: {
    created: number;
    adopted: number;
    updated: number;
    unchanged: number;
    conflicts: number;
    preserved: number;
    inactivated: number;
    historicalPlaceholders: number;
    unknownSupplierPlaceholders: number;
    debtCorrections: number;
  };
}

function nullableText(value: unknown): string | null {
  const normalized = normalizeKiotVietText(value);
  return normalized || null;
}

function joinSourceParts(row: KiotVietDataRow, columns: string[], separator: string): string | null {
  const parts = columns.map((column) => nullableText(row[column])).filter((value): value is string => value != null);
  return parts.length > 0 ? parts.join(separator) : null;
}

function isKiotVietSupplierActive(value: unknown): boolean {
  const normalized = normalizeKiotVietText(value).toLocaleLowerCase("vi");
  return !["0", "false", "inactive", "ngừng giao dịch", "không hoạt động"].includes(normalized);
}

function sourceManagedSupplier(supplier: KiotVietSupplierSource): KiotVietManagedSupplier {
  return {
    code: supplier.code,
    name: supplier.name,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    taxCode: supplier.taxCode,
    note: supplier.note,
    isActive: supplier.isActive,
    currentDebt: supplier.currentDebt,
  };
}

function currentManagedSupplier(current: KiotVietSupplierCurrent): KiotVietManagedSupplier {
  return {
    code: nullableText(current.code) ?? "",
    name: normalizeKiotVietText(current.name),
    phone: nullableText(current.phone),
    email: nullableText(current.email),
    address: nullableText(current.address),
    taxCode: nullableText(current.taxCode),
    note: nullableText(current.note),
    isActive: current.isActive,
    currentDebt: normalizeKiotVietNumber(current.currentDebt),
  };
}

function supplierFingerprint(supplier: KiotVietManagedSupplier): string {
  return stableKiotVietFingerprint(supplier);
}

function createUnknownSupplierPlaceholder(): KiotVietUnknownSupplierPlaceholder {
  return {
    externalId: UNKNOWN_SUPPLIER_EXTERNAL_ID,
    code: null,
    name: "KiotViet unknown supplier",
    phone: null,
    email: null,
    address: null,
    taxCode: null,
    note: null,
    isActive: false,
    currentDebt: 0,
  };
}

export function parseKiotVietSupplierSources(rows: KiotVietDataRow[]): KiotVietSupplierSource[] {
  assertUniqueKiotVietCodes(rows, SUPPLIER_CODE);
  return rows.map((row) => {
    const code = normalizeKiotVietText(row[SUPPLIER_CODE]);
    return {
      externalId: code,
      code,
      name: nullableText(row["Tên nhà cung cấp"]) ?? code,
      phone: nullableText(row["Điện thoại"]),
      email: nullableText(row.Email),
      address: joinSourceParts(row, ["Địa chỉ", "Phường/Xã", "Khu vực"], ", "),
      taxCode: nullableText(row["Mã số thuế"]),
      note: joinSourceParts(row, ["Công ty", "Nhóm nhà cung cấp", "Ghi chú"], " · "),
      isActive: isKiotVietSupplierActive(row["Trạng thái"]),
      currentDebt: normalizeKiotVietNumber(row["Nợ cần trả hiện tại"]),
      netPurchases: normalizeKiotVietNumber(row["Tổng mua trừ trả hàng"]),
    };
  }).sort((left, right) => left.externalId.localeCompare(right.externalId));
}

export function assertKiotVietSupplierSourceTotals(suppliers: KiotVietSupplierSource[]): void {
  const totals = suppliers.reduce((sum, supplier) => ({
    currentDebt: sum.currentDebt + supplier.currentDebt,
    netPurchases: sum.netPurchases + supplier.netPurchases,
  }), { currentDebt: 0, netPurchases: 0 });
  if (totals.currentDebt !== REVIEWED_SUPPLIER_DEBT_TOTAL) {
    throw new Error(
      `KiotViet supplier debt total must be ${REVIEWED_SUPPLIER_DEBT_TOTAL}, received ${totals.currentDebt}`,
    );
  }
  if (totals.netPurchases !== REVIEWED_SUPPLIER_NET_PURCHASES_TOTAL) {
    throw new Error(
      `KiotViet supplier net purchases total must be ${REVIEWED_SUPPLIER_NET_PURCHASES_TOTAL}, received ${totals.netPurchases}`,
    );
  }
}

export function planKiotVietSupplierSync(input: {
  sourceRows: KiotVietDataRow[];
  current: KiotVietSupplierCurrent[];
  mappings: KiotVietEntityMappingSnapshot[];
  historicalDocumentSupplierCodes: Iterable<string | null | undefined>;
}): KiotVietSupplierSyncPlan {
  const suppliers = parseKiotVietSupplierSources(input.sourceRows);
  const sourceByExternalId = new Map(suppliers.map((supplier) => [supplier.externalId, supplier]));
  const currentById = new Map(input.current.map((supplier) => [supplier.localId, supplier]));
  const currentByCode = new Map(input.current.flatMap((supplier) => {
    const code = nullableText(supplier.code);
    return code ? [[code, supplier] as const] : [];
  }));
  const mappedLocalIds = new Set(input.mappings.map((mapping) => mapping.localId));
  const mappingByExternalId = new Map(input.mappings.map((mapping) => [mapping.externalId, mapping]));
  const entityPlan = planKiotVietEntities({
    sources: suppliers.map((supplier) => ({
      externalId: supplier.externalId,
      fingerprint: supplierFingerprint(sourceManagedSupplier(supplier)),
    })),
    current: input.current.map((supplier) => ({
      localId: supplier.localId,
      code: supplier.code,
      fingerprint: supplierFingerprint(currentManagedSupplier(supplier)),
      legacyImported: supplier.legacyImported,
    })),
    mappings: input.mappings.filter((mapping) => mapping.externalId !== UNKNOWN_SUPPLIER_EXTERNAL_ID),
  });

  const inactivations = input.mappings
    .filter((mapping) => mapping.externalId !== UNKNOWN_SUPPLIER_EXTERNAL_ID)
    .filter((mapping) => !sourceByExternalId.has(mapping.externalId))
    .filter((mapping) => currentById.get(mapping.localId)?.isActive === true)
    .map((mapping) => ({ externalId: mapping.externalId, localId: mapping.localId }))
    .sort((left, right) => left.externalId.localeCompare(right.externalId));
  const inactivatedLocalIds = new Set(inactivations.map((item) => item.localId));
  entityPlan.preserves = entityPlan.preserves.filter((item) => !mappedLocalIds.has(item.localId));

  const historicalDocumentSupplierCodes = [...input.historicalDocumentSupplierCodes];
  const historicalSupplierCodes = historicalDocumentSupplierCodes
    .map((code) => normalizeKiotVietText(code))
    .filter(Boolean);
  const historicalCodes = [...new Set(historicalSupplierCodes)].sort((left, right) => left.localeCompare(right));
  const hasUnknownSupplierReference = historicalSupplierCodes.length !== historicalDocumentSupplierCodes.length;
  const hasLiveMappedSupplier = (code: string) => {
    const mapping = mappingByExternalId.get(code);
    return mapping != null && currentById.has(mapping.localId);
  };
  const historicalConflicts: KiotVietEntitySyncPlan["conflicts"] = [];
  for (const code of historicalCodes) {
    if (sourceByExternalId.has(code) || hasLiveMappedSupplier(code)) continue;
    const current = currentByCode.get(code);
    if (current) {
      historicalConflicts.push({ externalId: code, localId: current.localId, reason: "code_collision" });
      continue;
    }
    const mapping = mappingByExternalId.get(code);
    if (mapping) {
      historicalConflicts.push({ externalId: code, localId: mapping.localId, reason: "mapped_local_missing" });
    }
  }
  entityPlan.conflicts.push(...historicalConflicts);

  const unknownMapping = mappingByExternalId.get(UNKNOWN_SUPPLIER_EXTERNAL_ID);
  if (hasUnknownSupplierReference && unknownMapping && !currentById.has(unknownMapping.localId)) {
    entityPlan.conflicts.push({
      externalId: UNKNOWN_SUPPLIER_EXTERNAL_ID,
      localId: unknownMapping.localId,
      reason: "mapped_local_missing",
    });
  }
  entityPlan.conflicts.sort((left, right) => left.externalId.localeCompare(right.externalId));

  const historicalPlaceholders = historicalCodes
    .filter((code) => !sourceByExternalId.has(code))
    .filter((code) => !currentByCode.has(code) && !mappingByExternalId.has(code))
    .map((code) => ({
      externalId: code,
      code,
      name: `KiotViet historical supplier ${code}`,
      isActive: false as const,
      currentDebt: 0 as const,
    }));
  const unknownSupplierPlaceholder = hasUnknownSupplierReference && !unknownMapping
    ? createUnknownSupplierPlaceholder()
    : null;

  const writes: KiotVietSupplierWrite[] = [
    ...entityPlan.creates.map(({ externalId }) => ({
      action: "create" as const,
      externalId,
      supplier: sourceManagedSupplier(sourceByExternalId.get(externalId)!),
    })),
    ...entityPlan.adopts.filter((item) => item.needsUpdate).map(({ externalId, localId }) => ({
      action: "adopt" as const,
      externalId,
      localId,
      supplier: sourceManagedSupplier(sourceByExternalId.get(externalId)!),
    })),
    ...entityPlan.updates.map(({ externalId, localId }) => ({
      action: "update" as const,
      externalId,
      localId,
      supplier: sourceManagedSupplier(sourceByExternalId.get(externalId)!),
    })),
    ...inactivations.map(({ externalId, localId }) => ({
      action: "inactivate" as const,
      externalId,
      localId,
      supplier: { isActive: false as const },
    })),
    ...historicalPlaceholders.map((supplier) => ({
      action: "historical_placeholder" as const,
      externalId: supplier.externalId,
      supplier,
    })),
    ...(unknownSupplierPlaceholder ? [{
      action: "unknown_supplier_placeholder" as const,
      externalId: unknownSupplierPlaceholder.externalId,
      supplier: unknownSupplierPlaceholder,
    }] : []),
  ];
  const matchedLocalIdByExternalId = new Map<string, string>();
  for (const action of [...entityPlan.adopts, ...entityPlan.updates, ...entityPlan.unchanged]) {
    matchedLocalIdByExternalId.set(action.externalId, action.localId);
  }
  let debtCorrections = 0;
  for (const [externalId, localId] of matchedLocalIdByExternalId) {
    const source = sourceByExternalId.get(externalId)!;
    const current = currentById.get(localId)!;
    if (normalizeKiotVietNumber(current.currentDebt) !== source.currentDebt) debtCorrections += 1;
  }

  return {
    suppliers,
    entityPlan,
    inactivations,
    historicalPlaceholders,
    unknownSupplierPlaceholder,
    writes,
    sourceTotals: suppliers.reduce((sum, supplier) => ({
      currentDebt: sum.currentDebt + supplier.currentDebt,
      netPurchases: sum.netPurchases + supplier.netPurchases,
    }), { currentDebt: 0, netPurchases: 0 }),
    summary: {
      created: entityPlan.creates.length,
      adopted: entityPlan.adopts.length,
      updated: entityPlan.updates.length,
      unchanged: entityPlan.unchanged.length,
      conflicts: entityPlan.conflicts.length,
      preserved: entityPlan.preserves.length,
      inactivated: inactivatedLocalIds.size,
      historicalPlaceholders: historicalPlaceholders.length,
      unknownSupplierPlaceholders: unknownSupplierPlaceholder ? 1 : 0,
      debtCorrections,
    },
  };
}
