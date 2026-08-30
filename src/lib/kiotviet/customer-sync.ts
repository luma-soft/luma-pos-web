import type { KiotVietDataRow, KiotVietEntityMappingSnapshot, KiotVietEntitySyncPlan } from "./data-sync-types";
import {
  assertUniqueKiotVietCodes,
  normalizeKiotVietNumber,
  normalizeKiotVietText,
  planKiotVietEntities,
  stableKiotVietFingerprint,
} from "./data-sync-plan";

const CUSTOMER_CODE = "Mã khách hàng";
const REVIEWED_CUSTOMER_DEBT_TOTAL = 130_924_782;
const REVIEWED_CUSTOMER_NET_SALES_TOTAL = 3_400_176_291;

export interface KiotVietCustomerSource {
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
  totalSpent: number;
}

export interface KiotVietCustomerCurrent {
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
  totalSpent: number | string;
  legacyImported: boolean;
  consentStatus?: string | null;
  zaloUserId?: string | null;
  portalToken?: string | null;
  type?: string;
  debtLimit?: number | string | null;
}

export interface KiotVietCustomerHistoricalPlaceholder {
  externalId: string;
  code: string;
  name: string;
  isActive: false;
  currentDebt: 0;
  totalSpent: 0;
  type: "retail";
}

type KiotVietCustomerWrite =
  | {
    action: "create";
    externalId: string;
    localId?: undefined;
    customer: KiotVietCustomerSource & { type: "retail" };
  }
  | {
    action: "adopt" | "update";
    externalId: string;
    localId: string;
    customer: Omit<KiotVietCustomerSource, "externalId">;
  }
  | {
    action: "inactivate";
    externalId: string;
    localId: string;
    customer: { isActive: false };
  }
  | {
    action: "historical_placeholder";
    externalId: string;
    localId?: undefined;
    customer: KiotVietCustomerHistoricalPlaceholder;
  };

export interface KiotVietCustomerSyncPlan {
  customers: KiotVietCustomerSource[];
  entityPlan: KiotVietEntitySyncPlan;
  inactivations: Array<{ externalId: string; localId: string }>;
  historicalPlaceholders: KiotVietCustomerHistoricalPlaceholder[];
  writes: KiotVietCustomerWrite[];
  sourceTotals: { currentDebt: number; totalSpent: number };
  summary: {
    created: number;
    adopted: number;
    updated: number;
    unchanged: number;
    conflicts: number;
    preserved: number;
    inactivated: number;
    historicalPlaceholders: number;
    debtCorrections: number;
    totalSpentCorrections: number;
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

function isKiotVietCustomerActive(value: unknown): boolean {
  const normalized = normalizeKiotVietText(value).toLocaleLowerCase("vi");
  return !["0", "false", "inactive", "ngừng giao dịch", "không hoạt động"].includes(normalized);
}

function sourceManagedCustomer(customer: KiotVietCustomerSource): Omit<KiotVietCustomerSource, "externalId"> {
  return {
    code: customer.code,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    taxCode: customer.taxCode,
    note: customer.note,
    isActive: customer.isActive,
    currentDebt: customer.currentDebt,
    totalSpent: customer.totalSpent,
  };
}

function currentManagedCustomer(current: KiotVietCustomerCurrent): Omit<KiotVietCustomerSource, "externalId"> {
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
    totalSpent: normalizeKiotVietNumber(current.totalSpent),
  };
}

function customerFingerprint(customer: Omit<KiotVietCustomerSource, "externalId">): string {
  return stableKiotVietFingerprint(customer);
}

export function parseKiotVietCustomerSources(rows: KiotVietDataRow[]): KiotVietCustomerSource[] {
  assertUniqueKiotVietCodes(rows, CUSTOMER_CODE);
  return rows.map((row) => {
    const code = normalizeKiotVietText(row[CUSTOMER_CODE]);
    return {
      externalId: code,
      code,
      name: nullableText(row["Tên khách hàng"]) ?? code,
      phone: nullableText(row["Điện thoại"]),
      email: nullableText(row.Email),
      address: joinSourceParts(row, ["Địa chỉ", "Phường/Xã", "Khu vực giao hàng"], ", "),
      taxCode: nullableText(row["Mã số thuế"]),
      note: joinSourceParts(row, ["Công ty", "Nhóm khách hàng", "Ghi chú"], " · "),
      isActive: isKiotVietCustomerActive(row["Trạng thái"]),
      currentDebt: normalizeKiotVietNumber(row["Nợ cần thu hiện tại"]),
      totalSpent: normalizeKiotVietNumber(row["Tổng bán trừ trả hàng"]),
    };
  }).sort((left, right) => left.externalId.localeCompare(right.externalId));
}

export function assertKiotVietCustomerSourceTotals(customers: KiotVietCustomerSource[]): void {
  const totals = customers.reduce((sum, customer) => ({
    currentDebt: sum.currentDebt + customer.currentDebt,
    totalSpent: sum.totalSpent + customer.totalSpent,
  }), { currentDebt: 0, totalSpent: 0 });
  if (totals.currentDebt !== REVIEWED_CUSTOMER_DEBT_TOTAL) {
    throw new Error(
      `KiotViet customer debt total must be ${REVIEWED_CUSTOMER_DEBT_TOTAL}, received ${totals.currentDebt}`,
    );
  }
  if (totals.totalSpent !== REVIEWED_CUSTOMER_NET_SALES_TOTAL) {
    throw new Error(
      `KiotViet customer net sales total must be ${REVIEWED_CUSTOMER_NET_SALES_TOTAL}, received ${totals.totalSpent}`,
    );
  }
}

export function planKiotVietCustomerSync(input: {
  sourceRows: KiotVietDataRow[];
  current: KiotVietCustomerCurrent[];
  mappings: KiotVietEntityMappingSnapshot[];
  historicalDocumentCustomerCodes: Iterable<string | null | undefined>;
}): KiotVietCustomerSyncPlan {
  const customers = parseKiotVietCustomerSources(input.sourceRows);
  const sourceByExternalId = new Map(customers.map((customer) => [customer.externalId, customer]));
  const currentById = new Map(input.current.map((customer) => [customer.localId, customer]));
  const currentByCode = new Map(input.current.flatMap((customer) => {
    const code = nullableText(customer.code);
    return code ? [[code, customer] as const] : [];
  }));
  const mappedLocalIds = new Set(input.mappings.map((mapping) => mapping.localId));
  const mappedExternalIds = new Set(input.mappings.map((mapping) => mapping.externalId));
  const entityPlan = planKiotVietEntities({
    sources: customers.map((customer) => ({
      externalId: customer.externalId,
      fingerprint: customerFingerprint(sourceManagedCustomer(customer)),
    })),
    current: input.current.map((customer) => ({
      localId: customer.localId,
      code: customer.code,
      fingerprint: customerFingerprint(currentManagedCustomer(customer)),
      legacyImported: customer.legacyImported,
    })),
    mappings: input.mappings,
  });

  const inactivations = input.mappings
    .filter((mapping) => !sourceByExternalId.has(mapping.externalId))
    .filter((mapping) => currentById.get(mapping.localId)?.isActive === true)
    .map((mapping) => ({ externalId: mapping.externalId, localId: mapping.localId }))
    .sort((left, right) => left.externalId.localeCompare(right.externalId));
  const inactivatedLocalIds = new Set(inactivations.map((item) => item.localId));
  entityPlan.preserves = entityPlan.preserves.filter((item) => !mappedLocalIds.has(item.localId));

  const historicalCodes = [...new Set([...input.historicalDocumentCustomerCodes]
    .map((code) => normalizeKiotVietText(code))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const historicalPlaceholders = historicalCodes
    .filter((code) => !sourceByExternalId.has(code))
    .filter((code) => !currentByCode.has(code) && !mappedExternalIds.has(code))
    .map((code) => ({
      externalId: code,
      code,
      name: `KiotViet historical customer ${code}`,
      isActive: false as const,
      currentDebt: 0 as const,
      totalSpent: 0 as const,
      type: "retail" as const,
    }));

  const writes: KiotVietCustomerWrite[] = [
    ...entityPlan.creates.map(({ externalId }) => {
      const customer = sourceByExternalId.get(externalId)!;
      return {
        action: "create" as const,
        externalId,
        customer: { ...customer, type: "retail" as const },
      };
    }),
    ...entityPlan.adopts.filter((item) => item.needsUpdate).map(({ externalId, localId }) => ({
      action: "adopt" as const,
      externalId,
      localId,
      customer: sourceManagedCustomer(sourceByExternalId.get(externalId)!),
    })),
    ...entityPlan.updates.map(({ externalId, localId }) => ({
      action: "update" as const,
      externalId,
      localId,
      customer: sourceManagedCustomer(sourceByExternalId.get(externalId)!),
    })),
    ...inactivations.map(({ externalId, localId }) => ({
      action: "inactivate" as const,
      externalId,
      localId,
      customer: { isActive: false as const },
    })),
    ...historicalPlaceholders.map((customer) => ({
      action: "historical_placeholder" as const,
      externalId: customer.externalId,
      customer,
    })),
  ];
  const matchedLocalIdByExternalId = new Map<string, string>();
  for (const action of [...entityPlan.adopts, ...entityPlan.updates, ...entityPlan.unchanged]) {
    matchedLocalIdByExternalId.set(action.externalId, action.localId);
  }
  let debtCorrections = 0;
  let totalSpentCorrections = 0;
  for (const [externalId, localId] of matchedLocalIdByExternalId) {
    const source = sourceByExternalId.get(externalId)!;
    const current = currentById.get(localId)!;
    if (normalizeKiotVietNumber(current.currentDebt) !== source.currentDebt) debtCorrections += 1;
    if (normalizeKiotVietNumber(current.totalSpent) !== source.totalSpent) totalSpentCorrections += 1;
  }

  return {
    customers,
    entityPlan,
    inactivations,
    historicalPlaceholders,
    writes,
    sourceTotals: customers.reduce((sum, customer) => ({
      currentDebt: sum.currentDebt + customer.currentDebt,
      totalSpent: sum.totalSpent + customer.totalSpent,
    }), { currentDebt: 0, totalSpent: 0 }),
    summary: {
      created: entityPlan.creates.length,
      adopted: entityPlan.adopts.length,
      updated: entityPlan.updates.length,
      unchanged: entityPlan.unchanged.length,
      conflicts: entityPlan.conflicts.length,
      preserved: entityPlan.preserves.length,
      inactivated: inactivatedLocalIds.size,
      historicalPlaceholders: historicalPlaceholders.length,
      debtCorrections,
      totalSpentCorrections,
    },
  };
}
