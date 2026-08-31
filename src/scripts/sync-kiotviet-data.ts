import { pathToFileURL } from "node:url";
import { readKiotVietDataBundle } from "../lib/kiotviet/data-sync-files";
import type { KiotVietDataBundle, KiotVietDataPhase, KiotVietWorkbookSource } from "../lib/kiotviet/data-sync-types";
import { normalizeKiotVietText } from "../lib/kiotviet/data-sync-plan";
import {
  KIOTVIET_SYNC_PHASES,
  assertKiotVietDataSyncApplyGuard,
  executeKiotVietDataSyncPhase,
  parseKiotVietDataSyncArgs,
  type KiotVietSyncPhase,
  type KiotVietSyncPhaseArg,
} from "../lib/kiotviet/data-sync-runner";
import {
  assertKiotVietCustomerSourceTotals,
  parseKiotVietCustomerSources,
  planKiotVietCustomerSync,
} from "../lib/kiotviet/customer-sync";
import {
  assertKiotVietSupplierSourceTotals,
  hasKiotVietLegacySupplierMarker,
  parseKiotVietSupplierSources,
  planKiotVietSupplierSync,
} from "../lib/kiotviet/supplier-sync";
import type { KiotVietCustomerCurrent } from "../lib/kiotviet/customer-sync";
import type { KiotVietSupplierCurrent } from "../lib/kiotviet/supplier-sync";
import type { KiotVietEntityMappingSnapshot } from "../lib/kiotviet/data-sync-types";
import {
  auditKiotVietHistoryProducts,
  createKiotVietHistoryProductResolver,
  type KiotVietHistoryProductResolverInput,
} from "../lib/kiotviet/history-product-resolver";
import { kiotVietBookingFingerprint, planKiotVietBookingSync } from "../lib/kiotviet/booking-sync";
import {
  kiotVietSaleFingerprint,
  kiotVietSaleLegacyBootstrapFingerprint,
  planKiotVietSalesSync,
} from "../lib/kiotviet/sales-sync";
import {
  kiotVietPurchaseFingerprint,
  kiotVietPurchaseLegacyBootstrapFingerprint,
  planKiotVietPurchaseSync,
} from "../lib/kiotviet/purchase-sync";
import {
  kiotVietReturnFingerprint,
  kiotVietReturnLegacyBootstrapFingerprint,
  planKiotVietReturnSync,
} from "../lib/kiotviet/return-sync";
import {
  kiotVietPurchaseReturnFingerprint,
  kiotVietPurchaseReturnLegacyBootstrapFingerprint,
  planKiotVietPurchaseReturnSync,
} from "../lib/kiotviet/purchase-return-sync";
import type { KiotVietBookingCurrent, KiotVietBookingCurrentChild } from "../lib/kiotviet/booking-sync";
import type { KiotVietSaleCurrent, KiotVietSaleCurrentChild } from "../lib/kiotviet/sales-sync";
import type { KiotVietPurchaseCurrent, KiotVietPurchaseCurrentLine } from "../lib/kiotviet/purchase-sync";
import type { KiotVietReturnCurrent, KiotVietReturnCurrentLine, KiotVietReturnSale } from "../lib/kiotviet/return-sync";
import type { KiotVietPurchaseReturnCurrent, KiotVietPurchaseReturnCurrentLine } from "../lib/kiotviet/purchase-return-sync";
import type { KiotVietTypedPhasePlan } from "../lib/kiotviet/data-sync-apply";

interface KiotVietCliCurrentState {
  customers: KiotVietCustomerCurrent[];
  suppliers: KiotVietSupplierCurrent[];
  bookings: KiotVietBookingCurrent[];
  bookingLines: KiotVietBookingCurrentChild[];
  bookingPayments: KiotVietBookingCurrentChild[];
  sales: KiotVietSaleCurrent[];
  saleLines: KiotVietSaleCurrentChild[];
  salePayments: KiotVietSaleCurrentChild[];
  purchases: KiotVietPurchaseCurrent[];
  purchaseLines: KiotVietPurchaseCurrentLine[];
  returns: KiotVietReturnCurrent[];
  returnLines: KiotVietReturnCurrentLine[];
  returnSales: KiotVietReturnSale[];
  purchaseReturns: KiotVietPurchaseReturnCurrent[];
  purchaseReturnLines: KiotVietPurchaseReturnCurrentLine[];
  mappings: Partial<Record<string, KiotVietEntityMappingSnapshot[]>>;
}

export interface KiotVietCliPlanningState {
  storeId: string;
  schemaReady: boolean;
  productCatalog: KiotVietHistoryProductResolverInput;
  loaderBlockers?: KiotVietCliBlocker[];
  current?: KiotVietCliCurrentState;
}

export interface KiotVietCliBlocker {
  phase: KiotVietSyncPhaseArg;
  reason: string;
  count: number;
}

export interface KiotVietCliPhasePlan {
  phase: KiotVietSyncPhase;
  summary: Record<string, number>;
  blockers: KiotVietCliBlocker[];
}

export type KiotVietCliExecutablePhasePlan = KiotVietCliPhasePlan & {
  typedPlan: KiotVietTypedPhasePlan["typedPlan"] | null;
};

export interface KiotVietDataSyncReport {
  version: 1;
  status: "dry-run" | "applied";
  store: string;
  phase: KiotVietSyncPhaseArg;
  schemaReady: boolean;
  reconciliation: "passed";
  bundleSha256: string;
  sources: Array<{ phase: KiotVietDataPhase; filename: string; sha256: string; rows: number; documents: number }>;
  plans: KiotVietCliPhasePlan[];
  blockers: KiotVietCliBlocker[];
  invariant: "not-run-dry-run" | "passed";
}

export interface KiotVietDataSyncCliDependencies {
  readBundle?: (directory: string) => KiotVietDataBundle;
  loadPlanningState?: (storeSlug: string | null) => Promise<KiotVietCliPlanningState>;
  applyPhase?: (input: {
    phase: KiotVietSyncPhase;
    storeId: string;
    reviewedSha256: string;
    bundle: KiotVietDataBundle;
    plan: KiotVietCliExecutablePhasePlan;
  }) => Promise<{ postApplyPlan: KiotVietCliPhasePlan }>;
}

export async function applyKiotVietPhaseWithDatabase(database: ProductionDatabase, input: {
  phase: KiotVietSyncPhase;
  storeId: string;
  reviewedSha256: string;
  bundle: KiotVietDataBundle;
  plan: KiotVietCliExecutablePhasePlan;
}): Promise<{ postApplyPlan: KiotVietCliPhasePlan }> {
  if (!input.plan.typedPlan) throw new Error(`KiotViet ${input.phase} plan is not executable`);
  assertReviewedMasterTotalsForPhase(input.bundle, input.phase);
  const db = database;
  const { createKiotVietDataSyncAuditRepository, createKiotVietDataSyncTransaction } = await import("../lib/kiotviet/data-sync-database");
  const { applyKiotVietTypedPhasePlan } = await import("../lib/kiotviet/data-sync-apply");
  const selectedSource = input.phase === "product-references" ? null : source(input.bundle, input.phase);
  let postApplyPlan: KiotVietCliExecutablePhasePlan | null = null;
  const transactionHandles = new WeakMap<object, ProductionTransaction>();
  await executeKiotVietDataSyncPhase({
    apply: true,
    phase: input.phase,
    storeSlug: "hai-dang",
    reviewedSourceSha256: input.reviewedSha256,
    source: selectedSource ? {
      fileName: selectedSource.filename,
      sha256: selectedSource.sha256,
      bundleSha256: input.bundle.bundleSha256,
      rowCount: selectedSource.rowCount,
      documentCount: selectedSource.documentCount,
    } : {
      fileName: "kiotviet-data-bundle",
      sha256: input.bundle.bundleSha256,
      bundleSha256: input.bundle.bundleSha256,
      rowCount: input.bundle.sources.reduce((sum, item) => sum + item.rowCount, 0),
      documentCount: input.bundle.sources.reduce((sum, item) => sum + item.documentCount, 0),
    },
    audit: createKiotVietDataSyncAuditRepository({
      storeId: input.storeId,
      expectedStoreSlug: "hai-dang",
      runInTransaction: (work) => db.transaction(work),
    }),
    runInTransaction: (work) => db.transaction(async (rawTransaction) => {
      const syncTransaction = await createKiotVietDataSyncTransaction({
        transaction: rawTransaction,
        storeId: input.storeId,
        expectedStoreSlug: "hai-dang",
      });
      transactionHandles.set(syncTransaction, rawTransaction);
      return work(syncTransaction);
    }),
    work: async (syncTransaction, runId) => {
      // The phase runner owns the transaction. Re-enter through the same raw
      // transaction so writes, invariant snapshots, and the post-plan share a view.
      const rawTransaction = transactionHandles.get(syncTransaction);
      if (!rawTransaction) throw new Error("KiotViet transactional database handle is unavailable");
      await applyKiotVietTypedPhasePlan({
        transaction: rawTransaction,
        syncTransaction,
        storeId: input.storeId,
        runId,
        sourceSha256: input.reviewedSha256,
        plan: input.plan as KiotVietTypedPhasePlan,
      });
      const reloaded = await loadKiotVietPlanningStateFromDatabase(
        rawTransaction,
        "hai-dang",
        { serializeQueries: true },
      );
      const replanned = planKiotVietBundle(input.bundle, reloaded)
        .find((candidate) => candidate.phase === input.phase)!;
      postApplyPlan = replanned;
      const remaining = managedChangeCount(postApplyPlan);
      if (remaining !== 0) throw new Error(`KiotViet post-apply dry-run is not zero-diff: ${remaining} managed changes/blockers remain`);
      return { ...input.plan.summary, postApplyManagedChanges: remaining };
    },
  });
  if (!postApplyPlan) throw new Error("KiotViet post-apply plan was not produced");
  return { postApplyPlan };
}

async function applyProductionKiotVietPhase(input: Parameters<typeof applyKiotVietPhaseWithDatabase>[1]) {
  const { db } = await import("../db");
  return applyKiotVietPhaseWithDatabase(db, input);
}

function source(bundle: KiotVietDataBundle, phase: KiotVietDataPhase): KiotVietWorkbookSource {
  const selected = bundle.sources.find((item) => item.phase === phase);
  if (!selected) throw new Error(`Missing parsed KiotViet source for phase ${phase}`);
  return selected;
}

export function reviewedHashForPhase(bundle: KiotVietDataBundle, phase: KiotVietSyncPhase): string {
  return phase === "product-references" ? bundle.bundleSha256 : source(bundle, phase).sha256;
}

function groupedBlockers(phase: KiotVietSyncPhase, reasons: readonly string[]): KiotVietCliBlocker[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => ({ phase, reason, count }));
}

function historicalCodes(bundle: KiotVietDataBundle, column: string): string[] {
  return bundle.sources.flatMap((item) => item.rows.map((row) => normalizeKiotVietText(row[column])))
    .filter(Boolean);
}

function productReferences(bundle: KiotVietDataBundle, includeBookings: boolean) {
  return bundle.sources.filter((item) => (
    !["customers", "suppliers"].includes(item.phase) && (includeBookings || item.phase !== "bookings")
  )).flatMap((item) => item.rows.flatMap((row) => {
    const sku = normalizeKiotVietText(row["Mã hàng"]);
    const unitName = normalizeKiotVietText(row.ĐVT);
    if (item.phase === "purchase-returns" && !sku) return [];
    return [{
      sku,
      productName: normalizeKiotVietText(row["Tên hàng"]),
      unitName,
      documentCode: normalizeKiotVietText(row[item.codeColumn]),
    }];
  }));
}

function compactSummary(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort(([left], [right]) => left.localeCompare(right)));
}

const MANAGED_CHANGE_SUMMARY_KEYS = [
  "created", "creates", "adopted", "adopts", "updated", "updates", "conflicts",
  "inactivated", "historicalPlaceholders", "unknownSupplierPlaceholders",
  "debtCorrections", "totalSpentCorrections", "parentStatusUpdates",
  "subtotalRepairs", "settlementStatusRepairs",
] as const;

function managedChangeCount(plan: KiotVietCliPhasePlan): number {
  const summaryChanges = MANAGED_CHANGE_SUMMARY_KEYS.reduce(
    (sum, key) => sum + (plan.summary[key] ?? 0),
    0,
  );
  const typedPlan = "typedPlan" in plan
    ? (plan as KiotVietCliExecutablePhasePlan).typedPlan
    : null;
  let structuralChanges = 0;
  if (typedPlan && "writes" in typedPlan && Array.isArray(typedPlan.writes)) {
    structuralChanges += typedPlan.writes.length;
  }
  if (typedPlan && "saleStatusUpdates" in typedPlan && Array.isArray(typedPlan.saleStatusUpdates)) {
    structuralChanges += typedPlan.saleStatusUpdates.length;
  }
  return Math.max(summaryChanges, structuralChanges)
    + plan.blockers.reduce((sum, blocker) => sum + blocker.count, 0);
}

function assertReviewedMasterTotalsForPhase(bundle: KiotVietDataBundle, phase: KiotVietSyncPhase): void {
  if (phase === "customers") {
    assertKiotVietCustomerSourceTotals(parseKiotVietCustomerSources(source(bundle, "customers").rows));
  }
  if (phase === "suppliers") {
    assertKiotVietSupplierSourceTotals(parseKiotVietSupplierSources(source(bundle, "suppliers").rows));
  }
}

const LOCAL_REFERENCE_KEYS = new Set([
  "localId", "customerId", "supplierId", "productId", "bookingId", "orderId",
  "sourceOrderId", "orderItemId", "purchaseOrderId", "purchaseOrderItemId",
]);

export function assertKiotVietExecutablePlan(plan: KiotVietCliExecutablePhasePlan): void {
  if (!plan.typedPlan) throw new Error(`KiotViet ${plan.phase} plan is not executable`);
  const visit = (value: unknown, key: string | null): void => {
    if (value == null) return;
    if (typeof value === "string") {
      if (key && LOCAL_REFERENCE_KEYS.has(key) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error(`KiotViet ${plan.phase} has unresolved local reference in ${key}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
    }
  };
  visit(plan.typedPlan, null);
}

function emptyCurrentState(): KiotVietCliCurrentState {
  return {
    customers: [], suppliers: [], bookings: [], bookingLines: [], bookingPayments: [],
    sales: [], saleLines: [], salePayments: [],
    purchases: [], purchaseLines: [], returns: [], returnLines: [], returnSales: [],
    purchaseReturns: [], purchaseReturnLines: [], mappings: {},
  };
}

function legacySalePaymentMethod(value: string): "cash" | "card" | "bank_transfer" | "momo" | undefined {
  return value === "cash" || value === "card" || value === "bank_transfer" || value === "momo"
    ? value
    : undefined;
}

export function planKiotVietBundle(
  bundle: KiotVietDataBundle,
  state: KiotVietCliPlanningState,
): KiotVietCliExecutablePhasePlan[] {
  const current = state.current ?? emptyCurrentState();
  const mappings = (entityType: string) => current.mappings[entityType] ?? [];
  const customerPlan = planKiotVietCustomerSync({
    sourceRows: source(bundle, "customers").rows,
    current: current.customers, mappings: mappings("customer"),
    historicalDocumentCustomerCodes: historicalCodes(bundle, "Mã khách hàng"),
  });
  const supplierPlan = planKiotVietSupplierSync({
    sourceRows: source(bundle, "suppliers").rows,
    current: current.suppliers, mappings: mappings("supplier"),
    historicalDocumentSupplierCodes: historicalCodes(bundle, "Mã nhà cung cấp"),
  });
  const resolver = createKiotVietHistoryProductResolver(state.productCatalog);
  const references = productReferences(bundle, false);
  const productAudit = auditKiotVietHistoryProducts({ resolver, references });
  const allProductAudit = auditKiotVietHistoryProducts({ resolver, references: productReferences(bundle, true) });
  const resolvedProducts = allProductAudit.resolutions.flatMap((resolution) => resolution.status === "resolved" ? [resolution] : []);
  const uniqueProducts = [...new Map(resolvedProducts.map((item) => [`${item.sourceSku}\0${item.sourceUnitName.toLocaleLowerCase("vi")}`, item])).values()];
  const customerIdByCode = new Map(current.customers.flatMap((item) => item.code ? [[item.code, item.localId] as const] : []));
  const supplierIdByCode = new Map(current.suppliers.flatMap((item) => item.code ? [[item.code, item.localId] as const] : []));
  const resolvedCustomers = [
    ...current.customers.flatMap((item) => item.code ? [{ code: item.code, customerId: item.localId }] : []),
    ...customerPlan.customers.filter((item) => !customerIdByCode.has(item.code)).map((item) => ({ code: item.code, customerId: `pending-customer:${item.code}` })),
    ...customerPlan.historicalPlaceholders.map((item) => ({ code: item.code, customerId: `source-customer-placeholder:${item.code}` })),
  ];
  const resolvedSuppliers = [
    ...current.suppliers.flatMap((item) => item.code ? [{ code: item.code, supplierId: item.localId }] : []),
    ...supplierPlan.suppliers.filter((item) => !supplierIdByCode.has(item.code)).map((item) => ({ code: item.code, supplierId: `pending-supplier:${item.code}` })),
    ...supplierPlan.historicalPlaceholders.map((item) => ({ code: item.code, supplierId: `source-supplier-placeholder:${item.code}` })),
  ];
  const bookingPlan = planKiotVietBookingSync({
    sourceRows: source(bundle, "bookings").rows, current: current.bookings, mappings: mappings("booking"), resolvedCustomers,
    lineMappings: mappings("booking_line"), paymentMappings: mappings("booking_payment"),
    existingLines: current.bookingLines, existingPayments: current.bookingPayments,
    resolvedProducts: uniqueProducts.map((item) => ({ sku: item.sourceSku, productId: item.productId, unitName: item.unitName, unitMultiplier: item.unitMultiplier })),
  });
  const salesPlan = planKiotVietSalesSync({
    storeId: state.storeId, sourceRows: source(bundle, "sales").rows, current: current.sales, mappings: mappings("sale"),
    lineMappings: mappings("sale_line"), paymentMappings: mappings("sale_payment"), existingLines: current.saleLines, existingPayments: current.salePayments, resolvedCustomers,
    resolvedProducts: uniqueProducts.map((item) => ({ sku: item.sourceSku, productId: item.productId, unitName: item.unitName, sourceUnitName: item.sourceUnitName, unitMultiplier: item.unitMultiplier, resolutionSource: item.source })),
    resolvedBookings: bookingPlan.bookings.map((item) => ({ code: item.code, bookingId: current.bookings.find((candidate) => candidate.code === item.code)?.localId ?? `pending-booking:${item.code}` })),
  });
  const purchasePlan = planKiotVietPurchaseSync({
    storeId: state.storeId, sourceRows: source(bundle, "purchases").rows, current: current.purchases, mappings: mappings("purchase"), lineMappings: mappings("purchase_line"), existingLines: current.purchaseLines,
    resolvedSuppliers,
    unknownSupplierId: mappings("supplier").find((item) => item.externalId === "__kiotviet_unknown_supplier__")?.localId ?? null,
    resolvedProducts: uniqueProducts.map((item) => ({ sku: item.sourceSku, productId: item.productId, unitName: item.unitName, sourceUnitName: item.sourceUnitName, unitMultiplier: item.unitMultiplier, resolutionSource: item.source })),
  });
  const syntheticSaleLinks = salesPlan.sales.map((item) => ({
    invoiceCode: item.code, orderId: `source-sale:${item.code}`, customerId: item.customerId, status: "completed" as const,
    items: item.lines.map((line) => ({ localId: `source-sale-line:${line.externalId}`, sourceSku: line.sourceSku, unitName: line.unitName, quantity: line.quantity })),
  }));
  const saleLinks = current.returnSales.length > 0 ? current.returnSales : syntheticSaleLinks;
  const returnPlan = planKiotVietReturnSync({
    storeId: state.storeId, sourceRows: source(bundle, "returns").rows, current: current.returns, mappings: mappings("customer_return"), lineMappings: mappings("customer_return_line"), existingLines: current.returnLines, sales: saleLinks,
    resolvedProducts: uniqueProducts.map((item) => ({ sku: item.sourceSku, productId: item.productId, unitName: item.unitName, sourceUnitName: item.sourceUnitName, unitMultiplier: item.unitMultiplier, resolutionSource: item.source })),
  });
  const purchaseReturnSource = source(bundle, "purchase-returns");
  let purchaseReturnSummary: Record<string, number>;
  let purchaseReturnReasons: string[];
  let purchaseReturnTypedPlan: ReturnType<typeof planKiotVietPurchaseReturnSync> | null;
  const invalidPurchaseReturnRows = purchaseReturnSource.rows.filter((row) => (
    !normalizeKiotVietText(row["Mã hàng"])
  ));
  if (invalidPurchaseReturnRows.length > 0) {
    purchaseReturnSummary = {
      documents: purchaseReturnSource.documentCount,
      sourceLines: purchaseReturnSource.rowCount,
      invalidSourceLines: invalidPurchaseReturnRows.length,
      affectedDocuments: new Set(invalidPurchaseReturnRows.map((row) => (
        normalizeKiotVietText(row[purchaseReturnSource.codeColumn]) || "__blank_document__"
      ))).size,
    };
    purchaseReturnReasons = Array.from(
      { length: invalidPurchaseReturnRows.length },
      () => "blank_source_sku_or_unit",
    );
    purchaseReturnTypedPlan = null;
  } else {
    const purchaseReturnPlan = planKiotVietPurchaseReturnSync({
      storeId: state.storeId, sourceRows: purchaseReturnSource.rows, current: current.purchaseReturns, mappings: mappings("supplier_return"), lineMappings: mappings("supplier_return_line"), existingLines: current.purchaseReturnLines, resolvedSuppliers,
      resolvedProducts: uniqueProducts.map((item) => ({ sku: item.sourceSku, productId: item.productId, unitName: item.unitName, sourceUnitName: item.sourceUnitName, unitMultiplier: item.unitMultiplier, resolutionSource: item.source })),
    });
    purchaseReturnSummary = purchaseReturnPlan.summary;
    purchaseReturnReasons = purchaseReturnPlan.blockers.map((item) => item.reason);
    purchaseReturnTypedPlan = purchaseReturnPlan;
  }
  const raw = [
    ["customers", customerPlan.summary, customerPlan.entityPlan.conflicts.map((item) => item.reason), customerPlan],
    ["suppliers", supplierPlan.summary, supplierPlan.entityPlan.conflicts.map((item) => item.reason), supplierPlan],
    ["product-references", productAudit.summary, productAudit.blockers.map((item) => item.reason), productAudit],
    ["bookings", bookingPlan.summary, [...bookingPlan.blockers.map((item) => item.reason), ...bookingPlan.entityPlan.conflicts.map((item) => item.reason)], bookingPlan],
    ["sales", salesPlan.summary, [...salesPlan.blockers.map((item) => item.reason), ...salesPlan.entityPlan.conflicts.map((item) => item.reason)], salesPlan],
    ["purchases", purchasePlan.summary, [...purchasePlan.blockers.map((item) => item.reason), ...purchasePlan.entityPlan.conflicts.map((item) => item.reason)], purchasePlan],
    ["returns", returnPlan.summary, [...returnPlan.blockers.map((item) => item.reason), ...returnPlan.entityPlan.conflicts.map((item) => item.reason)], returnPlan],
    ["purchase-returns", purchaseReturnSummary, purchaseReturnReasons, purchaseReturnTypedPlan],
  ] as const;
  return raw.map(([phase, summary, reasons, typedPlan]) => ({
    phase,
    summary: compactSummary(summary),
    blockers: groupedBlockers(phase, reasons),
    typedPlan,
  })) as KiotVietCliExecutablePhasePlan[];
}

export function buildKiotVietDataSyncReport(input: {
  bundle: KiotVietDataBundle;
  phase: KiotVietSyncPhaseArg;
  storeSlug: string | null;
  schemaReady: boolean;
  plans: KiotVietCliPhasePlan[];
  blockers?: KiotVietCliBlocker[];
  applied?: boolean;
}): KiotVietDataSyncReport {
  const selectedPlans = input.phase === "all" ? input.plans : input.plans.filter((item) => item.phase === input.phase);
  const blockers = [...(input.blockers ?? []), ...selectedPlans.flatMap((item) => item.blockers)]
    .sort((left, right) => KIOTVIET_SYNC_PHASES.indexOf(left.phase as KiotVietSyncPhase) - KIOTVIET_SYNC_PHASES.indexOf(right.phase as KiotVietSyncPhase) || left.reason.localeCompare(right.reason));
  return {
    version: 1, status: input.applied ? "applied" : "dry-run", store: input.storeSlug ?? "unresolved", phase: input.phase,
    schemaReady: input.schemaReady, reconciliation: "passed", bundleSha256: input.bundle.bundleSha256,
    sources: input.bundle.sources.map((item) => ({ phase: item.phase, filename: item.filename, sha256: item.sha256, rows: item.rowCount, documents: item.documentCount })),
    plans: selectedPlans, blockers, invariant: input.applied ? "passed" : "not-run-dry-run",
  };
}

export function formatKiotVietDataSyncReport(report: KiotVietDataSyncReport): { json: string; text: string } {
  const json = JSON.stringify(report);
  const text = [
    `KiotViet ${report.status === "dry-run" ? "DRY-RUN" : "APPLIED"} · ${report.store} · ${report.phase}`,
    `bundle sha256: ${report.bundleSha256}`,
    ...report.sources.map((item) => `${item.phase}: ${item.documents} docs / ${item.rows} rows · ${item.sha256}`),
    `reconciliation: ${report.reconciliation} · schema: ${report.schemaReady ? "ready" : "missing migration 0116 prerequisite"}`,
    `blockers: ${report.blockers.length === 0 ? "none" : report.blockers.map((item) => `${item.phase}:${item.reason}=${item.count}`).join(", ")}`,
  ].join("\n");
  return { json, text };
}

export function shouldBootstrapUnmappedKiotVietLegacy(input: {
  schemaReady: boolean;
  mappingCount: number;
  hasLegacyEvidence: boolean;
}): boolean {
  return input.schemaReady && input.mappingCount === 0 && input.hasLegacyEvidence;
}

export async function executeKiotVietPlanningQueries<T extends readonly unknown[]>(
  tasks: { [K in keyof T]: () => PromiseLike<T[K]> },
  serialized: boolean,
): Promise<T> {
  if (!serialized) {
    return await Promise.all(tasks.map((task) => task())) as unknown as T;
  }
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as unknown as T;
}

type ProductionDatabase = (typeof import("../db"))["db"];
type ProductionTransaction = Parameters<Parameters<ProductionDatabase["transaction"]>[0]>[0];

export async function loadKiotVietPlanningStateFromDatabase(
  database: ProductionDatabase | ProductionTransaction,
  storeSlug: string | null,
  options: { serializeQueries?: boolean } = {},
): Promise<KiotVietCliPlanningState> {
  if (!storeSlug) throw new Error("Dry-run database planning requires --store=hai-dang");
  const db = database as ProductionDatabase;
  const schema = await import("../db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const [store] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, storeSlug)).limit(1);
  if (!store) throw new Error(`KiotViet target store does not exist: ${storeSlug}`);
  const relationResult = await db.execute(sql`select to_regclass('public.kiotviet_source_mappings')::text as name`);
  const relation = relationResult.rows[0] as { name?: string | null } | undefined;
  const schemaReady = Boolean(relation?.name);
  const serialized = options.serializeQueries === true;
  const [base, units, archived] = await executeKiotVietPlanningQueries([
    () => db.select({ id: schema.products.id, sku: schema.products.sku, name: schema.products.name, baseUnit: schema.products.baseUnit, isActive: schema.products.isActive, lifecycleStatus: schema.products.lifecycleStatus }).from(schema.products).where(eq(schema.products.storeId, store.id)),
    () => db.select({ productId: schema.productUnits.productId, sku: schema.productUnits.sku, unitName: schema.productUnits.unitName, multiplier: schema.productUnits.multiplier })
      .from(schema.productUnits).where(eq(schema.productUnits.storeId, store.id)),
    () => db.select({ productId: schema.productSourceMappings.productId, externalId: schema.productSourceMappings.externalId, baseUnit: schema.products.baseUnit })
      .from(schema.productSourceMappings).innerJoin(schema.products, and(eq(schema.productSourceMappings.productId, schema.products.id), eq(schema.products.storeId, store.id)))
      .where(and(eq(schema.productSourceMappings.storeId, store.id), eq(schema.productSourceMappings.provider, "kiotviet"), sql`${schema.productSourceMappings.deletedAt} is not null`)),
  ] as const, serialized);
  const [customerRows, supplierRows, orderRows, orderLineRows, paymentRows, purchaseRows, purchaseLineRows, returnRows, returnLineRows, purchaseReturnRows, purchaseReturnLineRows] = await executeKiotVietPlanningQueries([
    () => db.select({ localId: schema.customers.id, code: schema.customers.code, name: schema.customers.name, phone: schema.customers.phone, email: schema.customers.email, address: schema.customers.address, taxCode: schema.customers.taxCode, note: schema.customers.note, isActive: schema.customers.isActive, currentDebt: schema.customers.currentDebt, totalSpent: schema.customers.totalSpent })
      .from(schema.customers).where(eq(schema.customers.storeId, store.id)),
    () => db.select({ localId: schema.suppliers.id, code: schema.suppliers.code, name: schema.suppliers.name, phone: schema.suppliers.phone, email: schema.suppliers.email, address: schema.suppliers.address, taxCode: schema.suppliers.taxCode, note: schema.suppliers.note, currentDebt: schema.suppliers.currentDebt })
      .from(schema.suppliers).where(eq(schema.suppliers.storeId, store.id)),
    () => db.select({ localId: schema.orders.id, code: schema.orders.code, documentType: schema.orders.documentType, status: schema.orders.status, paymentStatus: schema.orders.paymentStatus, customerId: schema.orders.customerId, sourceOrderId: schema.orders.sourceOrderId, deliveryDate: schema.orders.deliveryDate, createdAt: schema.orders.createdAt, subtotal: schema.orders.subtotal, discount: schema.orders.discount, tax: schema.orders.tax, shippingFee: schema.orders.shippingFee, total: schema.orders.total, amountPaid: schema.orders.amountPaid, note: schema.orders.note })
      .from(schema.orders).where(eq(schema.orders.storeId, store.id)),
    () => db.select({ localId: schema.orderItems.id, orderId: schema.orderItems.orderId, productId: schema.orderItems.productId, productName: schema.orderItems.productName, legacyProductSku: schema.products.sku, legacyProductName: schema.products.name, legacyUnitName: schema.products.baseUnit, unitName: schema.orderItems.unitName, unitMultiplier: schema.orderItems.unitMultiplier, quantity: schema.orderItems.quantity, unitPrice: schema.orderItems.unitPrice, discount: schema.orderItems.discount, total: schema.orderItems.total, note: schema.orderItems.note })
      .from(schema.orderItems).innerJoin(schema.products, and(eq(schema.orderItems.productId, schema.products.id), eq(schema.products.storeId, store.id)))
      .where(eq(schema.orderItems.storeId, store.id)),
    () => db.select({ localId: schema.payments.id, orderId: schema.payments.orderId, method: schema.payments.method, amount: schema.payments.amount, note: schema.payments.note })
      .from(schema.payments).where(eq(schema.payments.storeId, store.id)),
    () => db.select({ localId: schema.purchaseOrders.id, code: schema.purchaseOrders.code, supplierId: schema.purchaseOrders.supplierId, status: schema.purchaseOrders.status, createdAt: schema.purchaseOrders.createdAt, subtotal: schema.purchaseOrders.subtotal, discount: schema.purchaseOrders.discount, vatRate: schema.purchaseOrders.vatRate, tax: schema.purchaseOrders.tax, total: schema.purchaseOrders.total, amountPaid: schema.purchaseOrders.amountPaid, invoiceNumber: schema.purchaseOrders.invoiceNumber, note: schema.purchaseOrders.note })
      .from(schema.purchaseOrders).where(eq(schema.purchaseOrders.storeId, store.id)),
    () => db.select({ localId: schema.purchaseOrderItems.id, purchaseOrderId: schema.purchaseOrderItems.purchaseOrderId, legacyProductSku: schema.products.sku, legacyProductName: schema.products.name, legacyUnitName: schema.products.baseUnit, quantity: schema.purchaseOrderItems.quantity, unitCost: schema.purchaseOrderItems.unitCost, discount: schema.purchaseOrderItems.discount, total: schema.purchaseOrderItems.total })
      .from(schema.purchaseOrderItems).innerJoin(schema.products, and(eq(schema.purchaseOrderItems.productId, schema.products.id), eq(schema.products.storeId, store.id)))
      .where(eq(schema.purchaseOrderItems.storeId, store.id)),
    () => db.select({ localId: schema.returns.id, code: schema.returns.code, status: schema.returns.status })
      .from(schema.returns).where(eq(schema.returns.storeId, store.id)),
    () => db.select({ localId: schema.returnItems.id, returnId: schema.returnItems.returnId, orderItemId: schema.returnItems.orderItemId, legacyProductSku: schema.products.sku, legacyProductName: schema.products.name, legacyUnitName: schema.products.baseUnit, quantity: schema.returnItems.quantity, unitPrice: schema.returnItems.unitPrice, total: schema.returnItems.total })
      .from(schema.returnItems).innerJoin(schema.products, and(eq(schema.returnItems.productId, schema.products.id), eq(schema.products.storeId, store.id)))
      .where(eq(schema.returnItems.storeId, store.id)),
    () => db.select({ localId: schema.purchaseReturns.id, code: schema.purchaseReturns.code, purchaseOrderId: schema.purchaseReturns.purchaseOrderId, supplierId: schema.purchaseReturns.supplierId, status: schema.purchaseReturns.status, settlementStatus: schema.purchaseReturns.settlementStatus, subtotal: schema.purchaseReturns.subtotal, discount: schema.purchaseReturns.discount, vatRate: schema.purchaseReturns.vatRate, tax: schema.purchaseReturns.tax, totalRefund: schema.purchaseReturns.totalRefund, refundAmount: schema.purchaseReturns.refundAmount, refundMethod: schema.purchaseReturns.refundMethod, debtAmount: schema.purchaseReturns.debtAmount, note: schema.purchaseReturns.note, createdAt: schema.purchaseReturns.createdAt })
      .from(schema.purchaseReturns).where(eq(schema.purchaseReturns.storeId, store.id)),
    () => db.select({ localId: schema.purchaseReturnItems.id, purchaseReturnId: schema.purchaseReturnItems.purchaseReturnId, legacyProductSku: schema.products.sku, legacyProductName: schema.products.name, legacyUnitName: schema.products.baseUnit, quantity: schema.purchaseReturnItems.quantity, unitCost: schema.purchaseReturnItems.unitCost, returnUnitCost: schema.purchaseReturnItems.returnUnitCost, total: schema.purchaseReturnItems.total })
      .from(schema.purchaseReturnItems).innerJoin(schema.products, and(eq(schema.purchaseReturnItems.productId, schema.products.id), eq(schema.products.storeId, store.id)))
      .where(eq(schema.purchaseReturnItems.storeId, store.id)),
  ] as const, serialized);
  const schemaSnapshots = schemaReady ? await executeKiotVietPlanningQueries([
    () => db.select({ localId: schema.suppliers.id, isActive: schema.suppliers.isActive })
      .from(schema.suppliers).where(eq(schema.suppliers.storeId, store.id)),
    () => db.select({ localId: schema.orderItems.id, orderId: schema.orderItems.orderId, productId: schema.orderItems.productId, productName: schema.orderItems.productName, sourceSku: schema.orderItems.sourceSku, unitName: schema.orderItems.unitName, unitMultiplier: schema.orderItems.unitMultiplier, quantity: schema.orderItems.quantity, unitPrice: schema.orderItems.unitPrice, discount: schema.orderItems.discount, total: schema.orderItems.total, note: schema.orderItems.note })
      .from(schema.orderItems).where(eq(schema.orderItems.storeId, store.id)),
    () => db.select({ localId: schema.purchaseOrderItems.id, purchaseOrderId: schema.purchaseOrderItems.purchaseOrderId, productId: schema.purchaseOrderItems.productId, productName: schema.purchaseOrderItems.productName, sourceSku: schema.purchaseOrderItems.sku, unitName: schema.purchaseOrderItems.unitName, unitMultiplier: schema.purchaseOrderItems.unitMultiplier, quantity: schema.purchaseOrderItems.quantity, unitCost: schema.purchaseOrderItems.unitCost, discount: schema.purchaseOrderItems.discount, total: schema.purchaseOrderItems.total })
      .from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.storeId, store.id)),
    () => db.select({ localId: schema.returns.id, code: schema.returns.code, orderId: schema.returns.orderId, customerId: schema.returns.customerId, status: schema.returns.status, createdAt: schema.returns.createdAt, invoiceCode: schema.returns.sourceInvoiceCode, subtotal: schema.returns.sourceSubtotal, discount: schema.returns.sourceDiscount, tax: schema.returns.sourceTax, otherRefund: schema.returns.sourceOtherRefund, returnFee: schema.returns.sourceReturnFee, totalRefund: schema.returns.totalRefund, refundAmount: schema.returns.refundAmount, settlementStatus: schema.returns.settlementStatus, note: schema.returns.note, paymentSnapshots: schema.returns.sourcePaymentSnapshots })
      .from(schema.returns).where(eq(schema.returns.storeId, store.id)),
    () => db.select({ localId: schema.returnItems.id, returnId: schema.returnItems.returnId, orderItemId: schema.returnItems.orderItemId, productId: schema.returnItems.productId, productName: schema.returnItems.productName, sourceSku: schema.returnItems.sourceSku, unitName: schema.returnItems.unitName, unitMultiplier: schema.returnItems.unitMultiplier, quantity: schema.returnItems.quantity, unitPrice: schema.returnItems.unitPrice, total: schema.returnItems.total, restock: schema.returnItems.restock })
      .from(schema.returnItems).where(eq(schema.returnItems.storeId, store.id)),
    () => db.select({ localId: schema.purchaseReturnItems.id, purchaseReturnId: schema.purchaseReturnItems.purchaseReturnId, purchaseOrderItemId: schema.purchaseReturnItems.purchaseOrderItemId, productId: schema.purchaseReturnItems.productId, productName: schema.purchaseReturnItems.productName, sourceSku: schema.purchaseReturnItems.sku, unitName: schema.purchaseReturnItems.unitName, unitMultiplier: schema.purchaseReturnItems.unitMultiplier, quantity: schema.purchaseReturnItems.quantity, unitCost: schema.purchaseReturnItems.unitCost, returnUnitCost: schema.purchaseReturnItems.returnUnitCost, total: schema.purchaseReturnItems.total })
      .from(schema.purchaseReturnItems).where(eq(schema.purchaseReturnItems.storeId, store.id)),
  ] as const, serialized) : null;
  const supplierActiveById = new Map(schemaSnapshots?.[0].map((item) => [item.localId, item.isActive]) ?? []);
  const legacyOrderLinesById = new Map(orderLineRows.map((item) => [item.localId, item]));
  const effectiveOrderLineRows = schemaSnapshots?.[1].map((item) => {
    const legacy = legacyOrderLinesById.get(item.localId)!;
    return {
      ...item,
      productName: item.productName ?? legacy.legacyProductName,
      sourceSku: item.sourceSku ?? legacy.legacyProductSku,
      unitName: item.unitName ?? legacy.legacyUnitName,
      unitMultiplier: item.unitMultiplier ?? "1",
      sourceSnapshotPersisted: item.sourceSku != null && item.productName != null && item.unitName != null,
    };
  }) ?? orderLineRows.map((item) => ({
    ...item,
    sourceSku: item.legacyProductSku,
    unitName: item.unitName ?? item.legacyUnitName,
    unitMultiplier: item.unitMultiplier ?? "1",
    sourceSnapshotPersisted: false,
  }));
  const legacyPurchaseLinesById = new Map(purchaseLineRows.map((item) => [item.localId, item]));
  const effectivePurchaseLineRows = schemaSnapshots?.[2].map((item) => {
    const legacy = legacyPurchaseLinesById.get(item.localId)!;
    return {
      ...item,
      productName: item.productName ?? legacy.legacyProductName,
      sourceSku: item.sourceSku ?? legacy.legacyProductSku,
      unitName: item.unitName ?? legacy.legacyUnitName,
      unitMultiplier: item.unitMultiplier ?? "1",
      sourceSnapshotPersisted: item.sourceSku != null && item.productName != null && item.unitName != null,
    };
  }) ?? purchaseLineRows.map((item) => ({
    ...item, productId: "", productName: item.legacyProductName, sourceSku: item.legacyProductSku,
    unitName: item.legacyUnitName, unitMultiplier: "1", sourceSnapshotPersisted: false,
  }));
  const effectiveReturnRows = schemaSnapshots?.[3] ?? returnRows;
  const legacyReturnLinesById = new Map(returnLineRows.map((item) => [item.localId, item]));
  const effectiveReturnLineRows = schemaSnapshots?.[4].map((item) => {
    const legacy = legacyReturnLinesById.get(item.localId)!;
    return {
      ...item,
      productName: item.productName ?? legacy.legacyProductName,
      sourceSku: item.sourceSku ?? legacy.legacyProductSku,
      unitName: item.unitName ?? legacy.legacyUnitName,
      unitMultiplier: item.unitMultiplier ?? "1",
      sourceSnapshotPersisted: item.sourceSku != null && item.productName != null && item.unitName != null,
    };
  }) ?? returnLineRows.map((item) => ({
    ...item, productId: "", productName: item.legacyProductName, sourceSku: item.legacyProductSku,
    unitName: item.legacyUnitName, unitMultiplier: "1", restock: true, sourceSnapshotPersisted: false,
  }));
  const legacyPurchaseReturnLinesById = new Map(purchaseReturnLineRows.map((item) => [item.localId, item]));
  const effectivePurchaseReturnLineRows = schemaSnapshots?.[5].map((item) => {
    const legacy = legacyPurchaseReturnLinesById.get(item.localId)!;
    return {
      ...item,
      productName: item.productName ?? legacy.legacyProductName,
      sourceSku: item.sourceSku ?? legacy.legacyProductSku,
      unitName: item.unitName ?? legacy.legacyUnitName,
      unitMultiplier: item.unitMultiplier ?? "1",
      sourceSnapshotPersisted: item.sourceSku != null && item.productName != null && item.unitName != null,
    };
  }) ?? purchaseReturnLineRows.map((item) => ({
    ...item, purchaseOrderItemId: null, productId: "", productName: item.legacyProductName,
    sourceSku: item.legacyProductSku, unitName: item.legacyUnitName, unitMultiplier: "1",
    sourceSnapshotPersisted: false,
  }));
  const mappingState: KiotVietCliCurrentState["mappings"] = {};
  if (schemaReady) {
    const rows = await db.select({
      entityType: schema.kiotvietSourceMappings.entityType,
      externalId: schema.kiotvietSourceMappings.externalId,
      localId: schema.kiotvietSourceMappings.localId,
      deletedAt: schema.kiotvietSourceMappings.deletedAt,
    })
      .from(schema.kiotvietSourceMappings).where(and(
        eq(schema.kiotvietSourceMappings.storeId, store.id),
        eq(schema.kiotvietSourceMappings.provider, "kiotviet"),
      ));
    for (const row of rows) {
      if (row.deletedAt && row.entityType !== "customer" && row.entityType !== "supplier") continue;
      const values = mappingState[row.entityType] ?? [];
      values.push({ externalId: row.externalId, localId: row.localId });
      mappingState[row.entityType] = values;
    }
  }
  const saleOrders = orderRows.filter((item) => item.documentType === "sale");
  const saleOrderIds = new Set(saleOrders.map((item) => item.localId));
  const bookingOrders = orderRows.filter((item) => item.documentType === "booking");
  const linesByOrder = new Map<string, typeof effectiveOrderLineRows>();
  for (const line of effectiveOrderLineRows) {
    const values = linesByOrder.get(line.orderId) ?? [];
    values.push(line);
    linesByOrder.set(line.orderId, values);
  }
  const unitSkus = new Set(units.flatMap((item) => item.sku ? [item.sku] : []));
  const ignoredLegacyUnitPlaceholders = new Set(base.filter((item) => (
    unitSkus.has(item.sku) && item.isActive === false && item.lifecycleStatus === "archived"
  )).map((item) => item.sku));
  const currentBaseProducts = base.filter((item) => !ignoredLegacyUnitPlaceholders.has(item.sku));
  const baseSkus = new Set(currentBaseProducts.map((item) => item.sku));
  const duplicateUnitSkus = units.filter((item) => item.sku && baseSkus.has(item.sku));
  const externalByLocal = (entityType: string) => new Map(
    (mappingState[entityType] ?? []).map((mapping) => [mapping.localId, mapping.externalId]),
  );
  const parentMappings = {
    booking: externalByLocal("booking"), sale: externalByLocal("sale"), purchase: externalByLocal("purchase"),
    customerReturn: externalByLocal("customer_return"), supplierReturn: externalByLocal("supplier_return"),
  };
  const childMappings = {
    bookingLine: externalByLocal("booking_line"), bookingPayment: externalByLocal("booking_payment"),
    saleLine: externalByLocal("sale_line"), salePayment: externalByLocal("sale_payment"),
    purchaseLine: externalByLocal("purchase_line"), customerReturnLine: externalByLocal("customer_return_line"),
    supplierReturnLine: externalByLocal("supplier_return_line"),
  };
  const paymentByOrder = new Map<string, typeof paymentRows>();
  for (const payment of paymentRows) {
    const values = paymentByOrder.get(payment.orderId) ?? [];
    values.push(payment);
    paymentByOrder.set(payment.orderId, values);
  }
  const invalidManagedSnapshots = new Set<string>();
  const orderLinesForFingerprint = (
    orderId: string,
    mappings: Map<string, string>,
    parentMapped: boolean,
  ) => (linesByOrder.get(orderId) ?? []).flatMap((line) => {
    const mappedExternalId = mappings.get(line.localId);
    if (parentMapped && !mappedExternalId) return [];
    const externalId = mappedExternalId ?? `bootstrap-line:${line.localId}`;
    const sourceSku = normalizeKiotVietText(line.sourceSku);
    const unitName = normalizeKiotVietText(line.unitName);
    const multiplier = Number(line.unitMultiplier);
    if ((mappedExternalId && !line.sourceSnapshotPersisted) || !sourceSku || !unitName || !Number.isFinite(multiplier) || multiplier <= 0 || !line.productId) {
      if (mappedExternalId) invalidManagedSnapshots.add(`order_line:${line.localId}`);
      return [];
    }
    return [{
      externalId, productId: line.productId, sourceSku, productName: line.productName,
      unitName, unitMultiplier: multiplier, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice),
      discount: Number(line.discount), total: Number(line.total), note: line.note,
    }];
  }).sort((left, right) => left.externalId.localeCompare(right.externalId));
  const paymentsForFingerprint = (
    orderId: string,
    mappings: Map<string, string>,
    allowCredit: boolean,
    parentMapped: boolean,
  ) => (paymentByOrder.get(orderId) ?? []).flatMap((payment) => {
    const mappedExternalId = mappings.get(payment.localId);
    if (parentMapped && !mappedExternalId) return [];
    const method = legacySalePaymentMethod(payment.method) ?? (allowCredit && payment.method === "credit" ? "credit" as const : undefined);
    if (!method) return [];
    const inferredChannel = method === "momo" ? "wallet" : method === "credit" ? "points" : method;
    const externalId = mappedExternalId ?? `bootstrap-payment:${payment.localId}`;
    const channel = mappedExternalId ? mappedExternalId.split("|")[2] : inferredChannel;
    if (!channel || !["cash", "card", "bank_transfer", "wallet", "points"].includes(channel)) {
      if (mappedExternalId) invalidManagedSnapshots.add(`payment:${payment.localId}`);
      return [];
    }
    return [{ externalId, channel: channel as "cash" | "card" | "bank_transfer" | "wallet" | "points", method, amount: Number(payment.amount) }];
  }).sort((left, right) => left.externalId.localeCompare(right.externalId));
  const orderFingerprint = (item: typeof orderRows[number], type: "booking" | "sale") => {
    if (!schemaReady) return "pre-migration-legacy-current";
    const lineMap = type === "booking" ? childMappings.bookingLine : childMappings.saleLine;
    const paymentMap = type === "booking" ? childMappings.bookingPayment : childMappings.salePayment;
    const parentMapped = (type === "booking" ? parentMappings.booking : parentMappings.sale).has(item.localId);
    const paymentSnapshots = paymentsForFingerprint(item.localId, paymentMap, type === "booking", parentMapped);
    const common = {
      code: item.code, documentType: type,
      status: item.status as "completed" | "draft",
      paymentStatus: item.paymentStatus as "unpaid" | "deposit" | "paid",
      customerId: item.customerId, createdAt: item.createdAt, subtotal: Number(item.subtotal),
      discount: Number(item.discount), tax: Number(item.tax), shippingFee: Number(item.shippingFee),
      total: Number(item.total), amountPaid: Number(item.amountPaid), note: item.note,
      lines: orderLinesForFingerprint(item.localId, lineMap, parentMapped), payments: paymentSnapshots,
    };
    return type === "booking"
      ? kiotVietBookingFingerprint({ ...common, documentType: "booking", status: common.status as "completed" | "draft", deliveryDate: item.deliveryDate,
        payments: paymentSnapshots as Array<{ externalId: string; channel: "cash" | "card" | "bank_transfer" | "wallet" | "points"; method: "cash" | "card" | "bank_transfer" | "momo" | "credit"; amount: number }> })
      : kiotVietSaleFingerprint({ ...common, documentType: "sale", status: common.status as "completed", sourceOrderId: item.sourceOrderId,
        payments: paymentSnapshots.filter((payment) => payment.method !== "credit") as Array<{ externalId: string; channel: "cash" | "card" | "bank_transfer" | "wallet"; method: "cash" | "card" | "bank_transfer" | "momo"; amount: number }> });
  };
  const purchaseLinesByParent = new Map<string, typeof effectivePurchaseLineRows>();
  for (const line of effectivePurchaseLineRows) {
    const values = purchaseLinesByParent.get(line.purchaseOrderId) ?? [];
    values.push(line);
    purchaseLinesByParent.set(line.purchaseOrderId, values);
  }
  const purchaseFingerprint = (item: typeof purchaseRows[number]) => {
    if (!schemaReady) return "pre-migration-legacy-current";
    const parentMapped = parentMappings.purchase.has(item.localId);
    const lines = (purchaseLinesByParent.get(item.localId) ?? []).flatMap((line) => {
      const mappedExternalId = childMappings.purchaseLine.get(line.localId);
      if (parentMapped && !mappedExternalId) return [];
      const externalId = mappedExternalId ?? `bootstrap-line:${line.localId}`;
      const sourceSku = normalizeKiotVietText(line.sourceSku);
      const unitName = normalizeKiotVietText(line.unitName);
      const unitMultiplier = Number(line.unitMultiplier);
      if ((mappedExternalId && !line.sourceSnapshotPersisted) || !sourceSku || !unitName || unitMultiplier <= 0 || !line.productId || !line.productName) {
        if (mappedExternalId) invalidManagedSnapshots.add(`purchase_line:${line.localId}`);
        return [];
      }
      return [{ externalId, productId: line.productId, sourceSku, productName: line.productName, unitName,
        unitMultiplier, quantity: Number(line.quantity), unitCost: Number(line.unitCost), discount: Number(line.discount), total: Number(line.total) }];
    }).sort((left, right) => left.externalId.localeCompare(right.externalId));
    return kiotVietPurchaseFingerprint({ code: item.code, status: item.status as "received" | "draft", supplierId: item.supplierId,
      createdAt: item.createdAt, subtotal: Number(item.subtotal), discount: Number(item.discount), vatRate: Number(item.vatRate),
      tax: Number(item.tax), total: Number(item.total), amountPaid: Number(item.amountPaid), invoiceNumber: item.invoiceNumber, note: item.note, lines });
  };
  const returnLinesByParent = new Map<string, typeof effectiveReturnLineRows>();
  for (const line of effectiveReturnLineRows) {
    const values = returnLinesByParent.get(line.returnId) ?? [];
    values.push(line);
    returnLinesByParent.set(line.returnId, values);
  }
  const returnFingerprint = (item: typeof effectiveReturnRows[number]) => {
    if (!schemaReady || !("invoiceCode" in item)) return "pre-migration-legacy-current";
    const value = item as {
      localId: string; code: string; orderId: string | null; customerId: string | null; status: string; createdAt: Date;
      invoiceCode: string | null; subtotal: string | null; discount: string | null; tax: string | null;
      otherRefund: string | null; returnFee: string | null; totalRefund: string; refundAmount: string | null;
      settlementStatus: string | null; note: string | null; paymentSnapshots: unknown;
    };
    const parentMapped = parentMappings.customerReturn.has(value.localId);
    const lines = (returnLinesByParent.get(value.localId) ?? []).flatMap((line) => {
      const mappedExternalId = childMappings.customerReturnLine.get(line.localId);
      if (parentMapped && !mappedExternalId) return [];
      const externalId = mappedExternalId ?? `bootstrap-line:${line.localId}`;
      const sourceSku = normalizeKiotVietText(line.sourceSku);
      const unitName = normalizeKiotVietText(line.unitName);
      const unitMultiplier = Number(line.unitMultiplier);
      if ((mappedExternalId && !line.sourceSnapshotPersisted) || !sourceSku || !unitName || unitMultiplier <= 0 || !line.productId || line.restock !== false) {
        if (mappedExternalId) invalidManagedSnapshots.add(`return_line:${line.localId}`);
        return [];
      }
      return [{ externalId, orderItemId: line.orderItemId, productId: line.productId, sourceSku,
        productName: line.productName ?? sourceSku, unitName, unitMultiplier, quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice), total: Number(line.total), restock: false as const }];
    }).sort((left, right) => left.externalId.localeCompare(right.externalId));
    if (value.subtotal == null || value.discount == null || value.tax == null || value.otherRefund == null || value.returnFee == null || value.refundAmount == null
      || !["unsettled", "partial", "settled"].includes(value.settlementStatus ?? "") || !Array.isArray(value.paymentSnapshots)) {
      if (parentMapped) invalidManagedSnapshots.add(`return:${value.localId}`);
      return "invalid-managed-return-snapshot";
    }
    return kiotVietReturnFingerprint({ code: value.code, invoiceCode: value.invoiceCode, orderId: value.orderId,
      customerId: value.customerId, status: value.status as "completed" | "cancelled", createdAt: value.createdAt,
      subtotal: Number(value.subtotal), discount: Number(value.discount), tax: Number(value.tax), otherRefund: Number(value.otherRefund),
      returnFee: Number(value.returnFee), totalRefund: Number(value.totalRefund), refundAmount: Number(value.refundAmount),
      settlementStatus: value.settlementStatus as "unsettled" | "partial" | "settled", note: value.note,
      paymentSnapshots: value.paymentSnapshots as Array<{ channel: "cash" | "card" | "bank_transfer" | "wallet" | "points"; amount: number }>, lines });
  };
  const purchaseReturnLinesByParent = new Map<string, typeof effectivePurchaseReturnLineRows>();
  for (const line of effectivePurchaseReturnLineRows) {
    const values = purchaseReturnLinesByParent.get(line.purchaseReturnId) ?? [];
    values.push(line);
    purchaseReturnLinesByParent.set(line.purchaseReturnId, values);
  }
  const purchaseReturnFingerprint = (item: typeof purchaseReturnRows[number]) => {
    if (!schemaReady) return "pre-migration-legacy-current";
    const parentMapped = parentMappings.supplierReturn.has(item.localId);
    const lines = (purchaseReturnLinesByParent.get(item.localId) ?? []).flatMap((line) => {
      const mappedExternalId = childMappings.supplierReturnLine.get(line.localId);
      if (parentMapped && !mappedExternalId) return [];
      const externalId = mappedExternalId ?? `bootstrap-line:${line.localId}`;
      const sourceSku = normalizeKiotVietText(line.sourceSku);
      const unitName = normalizeKiotVietText(line.unitName);
      const unitMultiplier = Number(line.unitMultiplier);
      if ((mappedExternalId && !line.sourceSnapshotPersisted) || !sourceSku || !unitName || unitMultiplier <= 0 || !line.productId || !line.productName) {
        if (mappedExternalId) invalidManagedSnapshots.add(`supplier_return_line:${line.localId}`);
        return [];
      }
      return [{ externalId, purchaseOrderItemId: null as null, productId: line.productId, sourceSku,
        productName: line.productName, unitName, unitMultiplier, quantity: Number(line.quantity), unitCost: Number(line.unitCost),
        returnUnitCost: Number(line.returnUnitCost), total: Number(line.total) }];
    }).sort((left, right) => left.externalId.localeCompare(right.externalId));
    return kiotVietPurchaseReturnFingerprint({ code: item.code, purchaseOrderId: null, supplierId: item.supplierId,
      status: item.status as "completed" | "draft", settlementStatus: item.settlementStatus as "unsettled" | "partial" | "settled",
      subtotal: Number(item.subtotal), discount: Number(item.discount), vatRate: Number(item.vatRate), tax: Number(item.tax),
      totalRefund: Number(item.totalRefund), refundAmount: Number(item.refundAmount), refundMethod: item.refundMethod as "cash" | null,
      debtAmount: Number(item.debtAmount), note: item.note, createdAt: item.createdAt, lines });
  };
  const legacySaleOrderIds = new Set(paymentRows.filter((payment) => (
    payment.note === "Import lịch sử KiotViet"
  )).map((payment) => payment.orderId));
  const legacySaleBootstrapCandidates = new Set(saleOrders.filter((sale) => {
    const lines = linesByOrder.get(sale.localId) ?? [];
    const payments = paymentByOrder.get(sale.localId) ?? [];
    const hasImporterPayment = payments.some((payment) => payment.note === "Import lịch sử KiotViet");
    const isUnpaidWithoutPayment = Number(sale.amountPaid) <= 0 && payments.length === 0;
    return (hasImporterPayment || isUnpaidWithoutPayment)
      && lines.length > 0
      && lines.every((line) => line.sourceSnapshotPersisted === false);
  }).map((sale) => sale.localId));
  const saleLegacyBootstrapFingerprint = (sale: typeof saleOrders[number]): string | undefined => {
    if (!legacySaleOrderIds.has(sale.localId)) return undefined;
    const lines = linesByOrder.get(sale.localId) ?? [];
    const aggregatePayments = (paymentByOrder.get(sale.localId) ?? []).filter((payment) => (
      payment.note === "Import lịch sử KiotViet"
    ));
    const aggregate = aggregatePayments.length === 1 ? aggregatePayments[0] : undefined;
    const method = aggregate == null ? undefined : legacySalePaymentMethod(aggregate.method);
    if (!aggregate || !method || lines.length === 0 || lines.some((line) => (
      !normalizeKiotVietText(line.sourceSku)
      || !normalizeKiotVietText(line.unitName)
      || line.quantity == null
      || line.unitPrice == null
      || line.discount == null
      || line.total == null
    ))) return undefined;
    const channel = method === "momo" ? "wallet" as const : method;
    return kiotVietSaleLegacyBootstrapFingerprint({
      code: sale.code,
      documentType: "sale",
      status: "completed",
      paymentStatus: sale.paymentStatus as "unpaid" | "deposit" | "paid",
      customerId: sale.customerId,
      sourceOrderId: sale.sourceOrderId,
      createdAt: sale.createdAt,
      subtotal: Number(sale.subtotal),
      discount: Number(sale.discount),
      tax: Number(sale.tax),
      shippingFee: Number(sale.shippingFee),
      total: Number(sale.total),
      amountPaid: Number(sale.amountPaid),
      note: sale.note,
      lines: lines.map((line) => ({
        externalId: `bootstrap-line:${line.localId}`,
        productId: line.productId,
        sourceSku: normalizeKiotVietText(line.sourceSku),
        productName: line.productName,
        unitName: normalizeKiotVietText(line.unitName),
        unitMultiplier: Number(line.unitMultiplier),
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        discount: Number(line.discount),
        total: Number(line.total),
        note: line.note,
      })),
      payments: [{
        externalId: `bootstrap-payment:${aggregate.localId}`,
        channel,
        method,
        amount: Number(aggregate.amount),
      }],
    });
  };
  const legacyPurchaseBootstrapCandidates = new Set(purchaseRows.filter((purchase) => {
    const lines = purchaseLinesByParent.get(purchase.localId) ?? [];
    return Number(purchase.subtotal) === 0
      && Number(purchase.discount) === 0
      && Number(purchase.vatRate) === 0
      && Number(purchase.tax) === 0
      && purchase.invoiceNumber == null
      && lines.length > 0
      && lines.every((line) => line.sourceSnapshotPersisted === false);
  }).map((purchase) => purchase.localId));
  const purchaseLegacyBootstrapFingerprint = (purchase: typeof purchaseRows[number]): string | undefined => {
    if (!legacyPurchaseBootstrapCandidates.has(purchase.localId)) return undefined;
    const lines = purchaseLinesByParent.get(purchase.localId) ?? [];
    if (lines.some((line) => !normalizeKiotVietText(line.sourceSku))) return undefined;
    return kiotVietPurchaseLegacyBootstrapFingerprint({
      code: purchase.code,
      status: purchase.status as "received" | "draft",
      supplierId: purchase.supplierId,
      createdAt: purchase.createdAt,
      total: Number(purchase.total),
      amountPaid: Number(purchase.amountPaid),
      note: purchase.note,
      lines: lines.map((line) => ({
        sourceSku: normalizeKiotVietText(line.sourceSku),
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        total: Number(line.total),
      })),
    });
  };
  const legacyReturnBootstrapCandidates = new Set((schemaSnapshots?.[3] ?? []).filter((value) => {
    const lines = returnLinesByParent.get(value.localId) ?? [];
    return value.subtotal == null
      && value.discount == null
      && value.tax == null
      && value.otherRefund == null
      && value.returnFee == null
      && value.refundAmount == null
      && value.paymentSnapshots == null
      && lines.length > 0
      && lines.every((line) => line.sourceSnapshotPersisted === false && line.restock === true);
  }).map((value) => value.localId));
  const orderById = new Map(orderRows.map((order) => [order.localId, order]));
  const returnLegacyBootstrapFingerprint = (
    value: typeof effectiveReturnRows[number],
  ): string | undefined => {
    if (!("orderId" in value)
      || !("customerId" in value)
      || !("createdAt" in value)
      || !("totalRefund" in value)
      || !("note" in value)) return undefined;
    const stableValue = value as {
      localId: string;
      code: string;
      orderId: string | null;
      customerId: string | null;
      status: string;
      createdAt: Date;
      totalRefund: string;
      note: string | null;
    };
    if (!legacyReturnBootstrapCandidates.has(stableValue.localId)) return undefined;
    const lines = returnLinesByParent.get(stableValue.localId) ?? [];
    if (lines.some((line) => !normalizeKiotVietText(line.sourceSku))) return undefined;
    return kiotVietReturnLegacyBootstrapFingerprint({
      code: stableValue.code,
      invoiceCode: stableValue.orderId == null ? null : orderById.get(stableValue.orderId)?.code ?? null,
      orderId: stableValue.orderId,
      customerId: stableValue.customerId,
      status: stableValue.status as "completed" | "cancelled",
      createdAt: stableValue.createdAt,
      totalRefund: Number(stableValue.totalRefund),
      note: stableValue.note,
      lines: lines.map((line) => ({
        orderItemId: line.orderItemId,
        sourceSku: normalizeKiotVietText(line.sourceSku),
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        total: Number(line.total),
      })),
    });
  };
  const legacySupplierReturnIds = new Set(purchaseReturnRows.filter((value) => (
    value.note === "Import trả hàng nhập KiotViet"
  )).map((value) => value.localId));
  const supplierReturnLegacyBootstrapFingerprint = (
    value: typeof purchaseReturnRows[number],
  ): string | undefined => {
    if (!legacySupplierReturnIds.has(value.localId)) return undefined;
    const lines = purchaseReturnLinesByParent.get(value.localId) ?? [];
    if (lines.length === 0 || lines.some((line) => (
      !normalizeKiotVietText(line.sourceSku)
      || !normalizeKiotVietText(line.unitName)
      || !line.productId
      || !line.productName
    ))) return undefined;
    return kiotVietPurchaseReturnLegacyBootstrapFingerprint({
      code: value.code,
      purchaseOrderId: null,
      supplierId: value.supplierId,
      status: value.status as "completed" | "draft",
      settlementStatus: value.settlementStatus as "unsettled" | "partial" | "settled",
      subtotal: Number(value.subtotal),
      discount: Number(value.discount),
      vatRate: Number(value.vatRate),
      tax: Number(value.tax),
      totalRefund: Number(value.totalRefund),
      refundAmount: Number(value.refundAmount),
      refundMethod: value.refundMethod as "cash" | null,
      debtAmount: Number(value.debtAmount),
      note: null,
      createdAt: value.createdAt,
      lines: lines.map((line) => ({
        externalId: `bootstrap-line:${line.localId}`,
        purchaseOrderItemId: null,
        productId: line.productId,
        sourceSku: normalizeKiotVietText(line.sourceSku),
        productName: line.productName,
        unitName: normalizeKiotVietText(line.unitName),
        unitMultiplier: Number(line.unitMultiplier),
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        returnUnitCost: Number(line.returnUnitCost),
        total: Number(line.total),
      })),
    });
  };
  const completedSaleFingerprint = (item: typeof saleOrders[number]): string => {
    if (!schemaReady || item.status === "completed") return orderFingerprint(item, "sale");
    return orderFingerprint({ ...item, status: "completed" }, "sale");
  };
  // Materialize every fingerprint before publishing loader blockers. Fingerprint
  // reconstruction is also where malformed persisted source snapshots are found.
  const current: KiotVietCliCurrentState = {
    customers: customerRows.map((item) => ({
      ...item,
      legacyImported: !schemaReady || externalByLocal("customer").has(item.localId),
      legacyBootstrapEligible: shouldBootstrapUnmappedKiotVietLegacy({
        schemaReady,
        mappingCount: mappingState.customer?.length ?? 0,
        hasLegacyEvidence: true,
      }),
    })),
    suppliers: supplierRows.map((item) => ({
      ...item,
      isActive: supplierActiveById.get(item.localId) ?? true,
      legacyImported: !schemaReady
        || externalByLocal("supplier").has(item.localId)
        || hasKiotVietLegacySupplierMarker(item.note),
      legacyBootstrapEligible: shouldBootstrapUnmappedKiotVietLegacy({
        schemaReady,
        mappingCount: mappingState.supplier?.length ?? 0,
        hasLegacyEvidence: true,
      }),
    })),
    bookings: bookingOrders.map((item) => ({ localId: item.localId, code: item.code, fingerprint: orderFingerprint(item, "booking"), legacyImported: !schemaReady || parentMappings.booking.has(item.localId) })),
    bookingLines: effectiveOrderLineRows.filter((item) => bookingOrders.some((order) => order.localId === item.orderId)).map((item) => ({
      ...item,
      sourceSku: item.sourceSku ?? undefined,
      legacyImported: !schemaReady || childMappings.bookingLine.has(item.localId),
      legacyAdoptionEligible: schemaReady && !parentMappings.booking.has(item.orderId),
    })),
    bookingPayments: paymentRows.filter((item) => bookingOrders.some((order) => order.localId === item.orderId)).map((item) => {
      const method = legacySalePaymentMethod(item.method) ?? (item.method === "credit" ? "credit" as const : undefined);
      return {
        localId: item.localId, orderId: item.orderId, amount: item.amount,
        ...(method ? { method } : {}),
        legacyImported: !schemaReady || childMappings.bookingPayment.has(item.localId),
        legacyAdoptionEligible: schemaReady && !parentMappings.booking.has(item.orderId),
      };
    }),
    sales: saleOrders.map((item) => ({
      localId: item.localId,
      code: item.code,
      status: item.status,
      fingerprint: orderFingerprint(item, "sale"),
      completedFingerprint: completedSaleFingerprint(item),
      legacyBootstrapFingerprint: saleLegacyBootstrapFingerprint(item),
      legacyImported: !schemaReady
        || parentMappings.sale.has(item.localId)
        || shouldBootstrapUnmappedKiotVietLegacy({
          schemaReady,
          mappingCount: parentMappings.sale.size,
          hasLegacyEvidence: legacySaleBootstrapCandidates.has(item.localId),
        }),
    })),
    saleLines: effectiveOrderLineRows.filter((item) => saleOrderIds.has(item.orderId)).map((item) => ({
      ...item,
      sourceSku: item.sourceSku ?? undefined,
      legacyImported: !schemaReady || childMappings.saleLine.has(item.localId),
      legacyAdoptionEligible: schemaReady && !parentMappings.sale.has(item.orderId),
    })),
    salePayments: paymentRows.filter((item) => saleOrderIds.has(item.orderId)).map((item) => {
      const method = legacySalePaymentMethod(item.method);
      return {
        localId: item.localId, orderId: item.orderId, amount: item.amount, note: item.note,
        ...(method ? { method } : {}),
        legacyImported: method != null && (!schemaReady || childMappings.salePayment.has(item.localId)),
        legacyAdoptionEligible: schemaReady && !parentMappings.sale.has(item.orderId),
        legacyAggregatePayment: item.note === "Import lịch sử KiotViet",
      };
    }),
    purchases: purchaseRows.map((item) => ({
      ...item,
      fingerprint: purchaseFingerprint(item),
      legacyBootstrapFingerprint: purchaseLegacyBootstrapFingerprint(item),
      legacyImported: !schemaReady
        || parentMappings.purchase.has(item.localId)
        || shouldBootstrapUnmappedKiotVietLegacy({
          schemaReady,
          mappingCount: parentMappings.purchase.size,
          hasLegacyEvidence: legacyPurchaseBootstrapCandidates.has(item.localId),
        }),
    })),
    purchaseLines: effectivePurchaseLineRows.map((item) => ({
      ...item, sourceSku: item.sourceSku ?? undefined, legacyProductSku: item.sourceSku ?? undefined,
      legacyProductName: item.productName ?? undefined, unitName: item.unitName ?? undefined,
      legacyImported: !schemaReady || childMappings.purchaseLine.has(item.localId),
      legacyAdoptionEligible: schemaReady && !parentMappings.purchase.has(item.purchaseOrderId),
    })),
    returns: effectiveReturnRows.map((item) => ({
      localId: item.localId,
      code: item.code,
      fingerprint: returnFingerprint(item),
      legacyBootstrapFingerprint: schemaReady ? returnLegacyBootstrapFingerprint(item) : undefined,
      legacyImported: !schemaReady
        || parentMappings.customerReturn.has(item.localId)
        || shouldBootstrapUnmappedKiotVietLegacy({
          schemaReady,
          mappingCount: parentMappings.customerReturn.size,
          hasLegacyEvidence: legacyReturnBootstrapCandidates.has(item.localId),
        }),
    })),
    returnLines: effectiveReturnLineRows.map((item) => ({
      ...item, sourceSku: item.sourceSku ?? undefined, legacyProductSku: item.sourceSku ?? undefined,
      active: effectiveReturnRows.find((parent) => parent.localId === item.returnId)?.status === "completed",
      legacyImported: !schemaReady || childMappings.customerReturnLine.has(item.localId),
      legacyAdoptionEligible: schemaReady && !parentMappings.customerReturn.has(item.returnId),
    })),
    returnSales: saleOrders.flatMap((item) => item.status === "completed" || item.status === "returned" ? [{
      invoiceCode: item.code, orderId: item.localId, customerId: item.customerId, status: item.status,
      items: (linesByOrder.get(item.localId) ?? []).flatMap((line) => line.sourceSku ? [{ localId: line.localId, sourceSku: line.sourceSku, unitName: line.unitName, quantity: line.quantity }] : []),
    }] : []),
    purchaseReturns: purchaseReturnRows.flatMap((item) => ["unsettled", "partial", "settled"].includes(item.settlementStatus) ? [{
      ...item,
      fingerprint: purchaseReturnFingerprint(item),
      legacyBootstrapFingerprint: supplierReturnLegacyBootstrapFingerprint(item),
      settlementStatus: item.settlementStatus as "unsettled" | "partial" | "settled",
      legacyImported: !schemaReady
        || parentMappings.supplierReturn.has(item.localId)
        || shouldBootstrapUnmappedKiotVietLegacy({
          schemaReady,
          mappingCount: parentMappings.supplierReturn.size,
          hasLegacyEvidence: legacySupplierReturnIds.has(item.localId),
        }),
    }] : []),
    purchaseReturnLines: effectivePurchaseReturnLineRows.map((item) => ({
      ...item, sourceSku: item.sourceSku ?? undefined, legacyProductSku: item.sourceSku ?? undefined,
      legacyImported: !schemaReady || childMappings.supplierReturnLine.has(item.localId),
      legacyAdoptionEligible: schemaReady && !parentMappings.supplierReturn.has(item.purchaseReturnId),
    })),
    mappings: mappingState,
  };
  return {
    storeId: store.id, schemaReady,
    loaderBlockers: [
      ...(duplicateUnitSkus.length > 0 ? [{ phase: "product-references" as const, reason: "base_alternate_sku_collision", count: duplicateUnitSkus.length }] : []),
      ...(invalidManagedSnapshots.size > 0 ? [{ phase: "all" as const, reason: "invalid_managed_source_snapshot", count: invalidManagedSnapshots.size }] : []),
    ],
    productCatalog: {
      currentBaseProducts,
      productUnits: units.flatMap((item) => item.sku && !baseSkus.has(item.sku) ? [{ ...item, sku: item.sku, multiplier: Number(item.multiplier) }] : []),
      archivedSourceMappings: archived,
      // No schema field records explicit Task-6 placeholder approval. An
      // inactive live product mapping alone is not approval, so fail closed.
      approvedHistoricalPlaceholders: [],
    },
    current,
  };
}

async function loadProductionReadOnlyState(storeSlug: string | null): Promise<KiotVietCliPlanningState> {
  const { db } = await import("../db");
  return loadKiotVietPlanningStateFromDatabase(db, storeSlug);
}

export async function runKiotVietDataSyncCli(argv: string[], dependencies: KiotVietDataSyncCliDependencies = {}) {
  const args = parseKiotVietDataSyncArgs(argv);
  const bundle = (dependencies.readBundle ?? readKiotVietDataBundle)(args.directory);
  if (args.apply && args.phase !== "all") {
    assertKiotVietDataSyncApplyGuard({ apply: true, phase: args.phase, storeSlug: args.storeSlug, reviewedSourceSha256: args.reviewedSourceSha256, actualSourceSha256: reviewedHashForPhase(bundle, args.phase) });
  }
  const state = await (dependencies.loadPlanningState ?? loadProductionReadOnlyState)(args.storeSlug);
  const executablePlans = planKiotVietBundle(bundle, state);
  const plans = executablePlans.map(({ phase, summary, blockers }) => ({ phase, summary, blockers }));
  const selected = args.phase === "all" ? null : executablePlans.find((item) => item.phase === args.phase)!;
  const prerequisite = [
    ...(state.schemaReady ? [] : [{ phase: args.phase, reason: "missing_prerequisite_schema", count: 1 } as KiotVietCliBlocker]),
    ...(state.loaderBlockers ?? []),
  ];
  if (args.apply) {
    if (!state.schemaReady) throw new Error("Cannot apply: prerequisite migration 0116 (kiotviet_source_mappings) is not deployed");
    if (prerequisite.length > 0) throw new Error(`Cannot apply: ${prerequisite.map((item) => item.reason).join(", ")}`);
    if (!selected || selected.blockers.length > 0) throw new Error("Cannot apply a KiotViet phase with unresolved blockers");
    assertKiotVietExecutablePlan(selected);
    assertReviewedMasterTotalsForPhase(bundle, args.phase as KiotVietSyncPhase);
    const applyPhase = dependencies.applyPhase ?? applyProductionKiotVietPhase;
    const applied = await applyPhase({
      phase: args.phase as KiotVietSyncPhase,
      storeId: state.storeId,
      reviewedSha256: reviewedHashForPhase(bundle, args.phase as KiotVietSyncPhase),
      bundle,
      plan: selected,
    });
    const remaining = managedChangeCount(applied.postApplyPlan);
    if (remaining !== 0) throw new Error(`KiotViet post-apply dry-run is not zero-diff: ${remaining} managed changes/blockers remain`);
  }
  const report = buildKiotVietDataSyncReport({ bundle, phase: args.phase, storeSlug: args.storeSlug, schemaReady: state.schemaReady, plans, blockers: prerequisite, applied: args.apply });
  return { report, exitCode: args.apply || report.blockers.length === 0 ? 0 : 2 };
}

async function main() {
  const result = await runKiotVietDataSyncCli(process.argv.slice(2));
  const output = formatKiotVietDataSyncReport(result.report);
  console.log(output.text);
  console.log(output.json);
  process.exitCode = result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
