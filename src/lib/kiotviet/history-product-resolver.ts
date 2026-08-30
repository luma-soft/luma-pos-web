import { normalizeKiotVietText } from "./data-sync-plan";

export interface KiotVietHistoryCurrentBaseProduct {
  id: string;
  sku: string;
  baseUnit: string;
}

export interface KiotVietHistoryProductUnit {
  productId: string;
  sku: string;
  unitName: string;
  multiplier: number;
}

export interface KiotVietHistoryArchivedSourceMapping {
  productId: string;
  externalId: string;
  baseUnit: string;
}

export interface KiotVietApprovedHistoricalProductPlaceholder {
  productId: string;
  sku: string;
  baseUnit: string;
  isActive: boolean;
}

export interface KiotVietHistoryProductReference {
  sku: string;
  productName?: string | null;
  unitName?: string | null;
  documentCode?: string | null;
}

export interface KiotVietHistoricalPlaceholderProposal {
  sku: string;
  name: string;
  baseUnit: string;
  isActive: false;
}

export type KiotVietHistoryProductResolution =
  | {
    status: "resolved";
    source: "current_base" | "alternate_unit" | "archived_mapping" | "approved_historical_placeholder";
    productId: string;
    sourceSku: string;
    unitName: string;
    unitMultiplier: number;
  }
  | {
    status: "awaiting_placeholder_approval";
    sourceSku: string;
    placeholder: KiotVietHistoricalPlaceholderProposal;
  };

export interface KiotVietHistoryProductResolverInput {
  currentBaseProducts: KiotVietHistoryCurrentBaseProduct[];
  productUnits: KiotVietHistoryProductUnit[];
  archivedSourceMappings: KiotVietHistoryArchivedSourceMapping[];
  approvedHistoricalPlaceholders: KiotVietApprovedHistoricalProductPlaceholder[];
}

export interface KiotVietHistoryProductResolver {
  resolve(reference: KiotVietHistoryProductReference): KiotVietHistoryProductResolution;
}

export interface KiotVietHistoryProductAudit {
  resolutions: KiotVietHistoryProductResolution[];
  placeholderProposals: KiotVietHistoricalPlaceholderProposal[];
  blockers: Array<{
    documentCode: string | null;
    sku: string;
    reason: "awaiting_historical_placeholder_approval";
    placeholder: KiotVietHistoricalPlaceholderProposal;
  }>;
  summary: {
    uniqueSkuCount: number;
    referenceCount: number;
    alternateUnitSkuCount: number;
    alternateUnitReferenceCount: number;
    unresolvedReferenceCount: number;
    awaitingPlaceholderApprovalCount: number;
  };
}

function required(value: string | null | undefined, label: string): string {
  const normalized = normalizeKiotVietText(value);
  if (!normalized) throw new Error(`KiotViet history product resolver requires ${label}`);
  return normalized;
}

function unitName(value: string | null | undefined): string {
  return normalizeKiotVietText(value) || "cái";
}

function uniqueBySku<T>(
  values: T[],
  skuOf: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const sku = required(skuOf(value), `${label} SKU`);
    if (result.has(sku)) throw new Error(`Duplicate KiotViet history ${label} SKU: ${sku}`);
    result.set(sku, value);
  }
  return result;
}

export function createKiotVietHistoryProductResolver(
  input: KiotVietHistoryProductResolverInput,
): KiotVietHistoryProductResolver {
  const baseBySku = uniqueBySku(input.currentBaseProducts, (product) => product.sku, "base product");
  const baseById = new Map(
    input.currentBaseProducts.map((product) => [required(product.id, "base product id"), product]),
  );
  const unitBySku = uniqueBySku(input.productUnits, (unit) => unit.sku, "alternate unit");
  const archivedBySku = uniqueBySku(input.archivedSourceMappings, (mapping) => mapping.externalId, "archived mapping");
  const placeholderBySku = uniqueBySku(
    input.approvedHistoricalPlaceholders,
    (placeholder) => placeholder.sku,
    "historical placeholder",
  );

  for (const [sku, unit] of unitBySku) {
    if (baseBySku.has(sku)) {
      throw new Error(`KiotViet history SKU is both a base product and alternate unit: ${sku}`);
    }
    if (!baseById.has(unit.productId)) {
      throw new Error(`KiotViet history alternate unit ${sku} has no current base product: ${unit.productId}`);
    }
    if (!Number.isFinite(unit.multiplier) || unit.multiplier <= 0) {
      throw new Error(`KiotViet history alternate unit ${sku} has invalid multiplier`);
    }
  }
  for (const placeholder of placeholderBySku.values()) {
    if (placeholder.isActive) {
      throw new Error(`KiotViet history placeholder ${placeholder.sku} must be inactive`);
    }
  }

  return {
    resolve(reference) {
      const sku = required(reference.sku, "source SKU");
      const base = baseBySku.get(sku);
      if (base) {
        return {
          status: "resolved",
          source: "current_base",
          productId: base.id,
          sourceSku: sku,
          unitName: unitName(base.baseUnit),
          unitMultiplier: 1,
        };
      }

      const unit = unitBySku.get(sku);
      if (unit) {
        return {
          status: "resolved",
          source: "alternate_unit",
          productId: unit.productId,
          sourceSku: sku,
          unitName: unitName(unit.unitName),
          unitMultiplier: unit.multiplier,
        };
      }

      const archived = archivedBySku.get(sku);
      if (archived) {
        return {
          status: "resolved",
          source: "archived_mapping",
          productId: archived.productId,
          sourceSku: sku,
          unitName: unitName(archived.baseUnit),
          unitMultiplier: 1,
        };
      }

      const placeholder = placeholderBySku.get(sku);
      if (placeholder) {
        return {
          status: "resolved",
          source: "approved_historical_placeholder",
          productId: placeholder.productId,
          sourceSku: sku,
          unitName: unitName(placeholder.baseUnit),
          unitMultiplier: 1,
        };
      }

      return {
        status: "awaiting_placeholder_approval",
        sourceSku: sku,
        placeholder: {
          sku,
          name: normalizeKiotVietText(reference.productName) || sku,
          baseUnit: unitName(reference.unitName),
          isActive: false,
        },
      };
    },
  };
}

export function auditKiotVietHistoryProducts(input: {
  resolver: KiotVietHistoryProductResolver;
  references: KiotVietHistoryProductReference[];
}): KiotVietHistoryProductAudit {
  const resolutions = input.references.map((reference) => input.resolver.resolve(reference));
  const blockers = resolutions.flatMap((resolution, index) => {
    if (resolution.status !== "awaiting_placeholder_approval") return [];
    return [{
      documentCode: normalizeKiotVietText(input.references[index]?.documentCode) || null,
      sku: resolution.sourceSku,
      reason: "awaiting_historical_placeholder_approval" as const,
      placeholder: resolution.placeholder,
    }];
  });
  const placeholderBySku = new Map<string, KiotVietHistoricalPlaceholderProposal>();
  for (const blocker of blockers) {
    const existing = placeholderBySku.get(blocker.sku);
    if (existing && (
      existing.name !== blocker.placeholder.name
      || existing.baseUnit !== blocker.placeholder.baseUnit
    )) {
      throw new Error(`Conflicting KiotViet historical placeholder details for ${blocker.sku}`);
    }
    placeholderBySku.set(blocker.sku, blocker.placeholder);
  }
  const alternateSkuSet = new Set<string>();
  let alternateUnitReferenceCount = 0;
  for (const resolution of resolutions) {
    if (resolution.status !== "resolved" || resolution.source !== "alternate_unit") continue;
    alternateSkuSet.add(resolution.sourceSku);
    alternateUnitReferenceCount += 1;
  }

  return {
    resolutions,
    placeholderProposals: [...placeholderBySku.values()]
      .sort((left, right) => left.sku.localeCompare(right.sku)),
    blockers,
    summary: {
      uniqueSkuCount: new Set(resolutions.map((resolution) => resolution.sourceSku)).size,
      referenceCount: resolutions.length,
      alternateUnitSkuCount: alternateSkuSet.size,
      alternateUnitReferenceCount,
      unresolvedReferenceCount: blockers.length,
      awaitingPlaceholderApprovalCount: blockers.length,
    },
  };
}

export function assertKiotVietHistoryProductAuditComplete(
  audit: KiotVietHistoryProductAudit,
): void {
  const count = audit.summary.awaitingPlaceholderApprovalCount;
  if (count === 0) return;
  const noun = count === 1 ? "reference awaits" : "references await";
  throw new Error(
    `KiotViet history product resolution is blocking: ${count} ${noun} historical placeholder approval`,
  );
}
