import { pathToFileURL } from "node:url";
import { readKiotVietDataBundle } from "../lib/kiotviet/data-sync-files";
import type { KiotVietDataBundle, KiotVietDataPhase, KiotVietWorkbookSource } from "../lib/kiotviet/data-sync-types";
import { normalizeKiotVietText } from "../lib/kiotviet/data-sync-plan";
import {
  KIOTVIET_SYNC_PHASES,
  assertKiotVietDataSyncApplyGuard,
  parseKiotVietDataSyncArgs,
  type KiotVietSyncPhase,
  type KiotVietSyncPhaseArg,
} from "../lib/kiotviet/data-sync-runner";
import { planKiotVietCustomerSync } from "../lib/kiotviet/customer-sync";
import { planKiotVietSupplierSync } from "../lib/kiotviet/supplier-sync";
import type { KiotVietCustomerCurrent } from "../lib/kiotviet/customer-sync";
import type { KiotVietSupplierCurrent } from "../lib/kiotviet/supplier-sync";
import type { KiotVietEntityMappingSnapshot } from "../lib/kiotviet/data-sync-types";
import {
  auditKiotVietHistoryProducts,
  createKiotVietHistoryProductResolver,
  type KiotVietHistoryProductResolverInput,
} from "../lib/kiotviet/history-product-resolver";
import { planKiotVietBookingSync } from "../lib/kiotviet/booking-sync";
import { planKiotVietSalesSync } from "../lib/kiotviet/sales-sync";
import { planKiotVietPurchaseSync } from "../lib/kiotviet/purchase-sync";
import { planKiotVietReturnSync } from "../lib/kiotviet/return-sync";
import { planKiotVietPurchaseReturnSync } from "../lib/kiotviet/purchase-return-sync";
import type { KiotVietBookingCurrent } from "../lib/kiotviet/booking-sync";
import type { KiotVietSaleCurrent, KiotVietSaleCurrentChild } from "../lib/kiotviet/sales-sync";
import type { KiotVietPurchaseCurrent, KiotVietPurchaseCurrentLine } from "../lib/kiotviet/purchase-sync";
import type { KiotVietReturnCurrent, KiotVietReturnCurrentLine, KiotVietReturnSale } from "../lib/kiotviet/return-sync";
import type { KiotVietPurchaseReturnCurrent, KiotVietPurchaseReturnCurrentLine } from "../lib/kiotviet/purchase-return-sync";

interface KiotVietCliCurrentState {
  customers: KiotVietCustomerCurrent[];
  suppliers: KiotVietSupplierCurrent[];
  bookings: KiotVietBookingCurrent[];
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
    reviewedSha256: string;
    bundle: KiotVietDataBundle;
    plan: KiotVietCliPhasePlan;
  }) => Promise<{ postApplyPlan: KiotVietCliPhasePlan }>;
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
  )).flatMap((item) =>
    item.rows.map((row) => ({
      sku: normalizeKiotVietText(row["Mã hàng"]),
      productName: normalizeKiotVietText(row["Tên hàng"]),
      unitName: normalizeKiotVietText(row.ĐVT),
      documentCode: normalizeKiotVietText(row[item.codeColumn]),
    })),
  );
}

function compactSummary(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort(([left], [right]) => left.localeCompare(right)));
}

function managedChangeCount(plan: KiotVietCliPhasePlan): number {
  const keys = ["created", "creates", "adopted", "adopts", "updated", "updates", "conflicts"];
  return keys.reduce((sum, key) => sum + (plan.summary[key] ?? 0), 0)
    + plan.blockers.reduce((sum, blocker) => sum + blocker.count, 0);
}

function emptyCurrentState(): KiotVietCliCurrentState {
  return {
    customers: [], suppliers: [], bookings: [], sales: [], saleLines: [], salePayments: [],
    purchases: [], purchaseLines: [], returns: [], returnLines: [], returnSales: [],
    purchaseReturns: [], purchaseReturnLines: [], mappings: {},
  };
}

function legacySalePaymentMethod(value: string): "cash" | "card" | "bank_transfer" | "momo" | "credit" | undefined {
  return value === "cash" || value === "card" || value === "bank_transfer" || value === "momo" || value === "credit"
    ? value
    : undefined;
}

export function planKiotVietBundle(
  bundle: KiotVietDataBundle,
  state: KiotVietCliPlanningState,
): KiotVietCliPhasePlan[] {
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
    ...customerPlan.customers.map((item) => ({ code: item.code, customerId: customerIdByCode.get(item.code) ?? `pending-customer:${item.code}` })),
    ...customerPlan.historicalPlaceholders.map((item) => ({ code: item.code, customerId: `source-customer-placeholder:${item.code}` })),
  ];
  const resolvedSuppliers = [
    ...supplierPlan.suppliers.map((item) => ({ code: item.code, supplierId: supplierIdByCode.get(item.code) ?? `pending-supplier:${item.code}` })),
    ...supplierPlan.historicalPlaceholders.map((item) => ({ code: item.code, supplierId: `source-supplier-placeholder:${item.code}` })),
  ];
  const bookingPlan = planKiotVietBookingSync({
    sourceRows: source(bundle, "bookings").rows, current: current.bookings, mappings: mappings("booking"), resolvedCustomers,
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
    resolvedSuppliers, unknownSupplierId: "source-supplier:unknown",
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
  try {
    const purchaseReturnPlan = planKiotVietPurchaseReturnSync({
      storeId: state.storeId, sourceRows: purchaseReturnSource.rows, current: current.purchaseReturns, mappings: mappings("supplier_return"), lineMappings: mappings("supplier_return_line"), existingLines: current.purchaseReturnLines, resolvedSuppliers,
      resolvedProducts: uniqueProducts.map((item) => ({ sku: item.sourceSku, productId: item.productId, unitName: item.unitName, sourceUnitName: item.sourceUnitName, unitMultiplier: item.unitMultiplier, resolutionSource: item.source })),
    });
    purchaseReturnSummary = purchaseReturnPlan.summary;
    purchaseReturnReasons = purchaseReturnPlan.blockers.map((item) => item.reason);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("requires source SKU and source unit")) throw error;
    purchaseReturnSummary = { documents: purchaseReturnSource.documentCount, sourceLines: purchaseReturnSource.rowCount };
    purchaseReturnReasons = ["blank_source_sku_or_unit"];
  }
  const raw = [
    ["customers", customerPlan.summary, customerPlan.entityPlan.conflicts.map((item) => item.reason)],
    ["suppliers", supplierPlan.summary, supplierPlan.entityPlan.conflicts.map((item) => item.reason)],
    ["product-references", productAudit.summary, productAudit.blockers.map((item) => item.reason)],
    ["bookings", bookingPlan.summary, [...bookingPlan.blockers.map((item) => item.reason), ...bookingPlan.entityPlan.conflicts.map((item) => item.reason)]],
    ["sales", salesPlan.summary, [...salesPlan.blockers.map((item) => item.reason), ...salesPlan.entityPlan.conflicts.map((item) => item.reason)]],
    ["purchases", purchasePlan.summary, [...purchasePlan.blockers.map((item) => item.reason), ...purchasePlan.entityPlan.conflicts.map((item) => item.reason)]],
    ["returns", returnPlan.summary, [...returnPlan.blockers.map((item) => item.reason), ...returnPlan.entityPlan.conflicts.map((item) => item.reason)]],
    ["purchase-returns", purchaseReturnSummary, purchaseReturnReasons],
  ] as const;
  return raw.map(([phase, summary, reasons]) => ({ phase, summary: compactSummary(summary), blockers: groupedBlockers(phase, reasons) }));
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

async function loadProductionReadOnlyState(storeSlug: string | null): Promise<KiotVietCliPlanningState> {
  if (!storeSlug) throw new Error("Dry-run database planning requires --store=hai-dang");
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const [store] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, storeSlug)).limit(1);
  if (!store) throw new Error(`KiotViet target store does not exist: ${storeSlug}`);
  const relationResult = await db.execute(sql`select to_regclass('public.kiotviet_source_mappings')::text as name`);
  const relation = relationResult.rows[0] as { name?: string | null } | undefined;
  const schemaReady = Boolean(relation?.name);
  const [base, units, archived] = await Promise.all([
    db.select({ id: schema.products.id, sku: schema.products.sku, baseUnit: schema.products.baseUnit, isActive: schema.products.isActive, lifecycleStatus: schema.products.lifecycleStatus }).from(schema.products).where(eq(schema.products.storeId, store.id)),
    db.select({ productId: schema.productUnits.productId, sku: schema.productUnits.sku, unitName: schema.productUnits.unitName, multiplier: schema.productUnits.multiplier })
      .from(schema.productUnits).where(eq(schema.productUnits.storeId, store.id)),
    db.select({ productId: schema.productSourceMappings.productId, externalId: schema.productSourceMappings.externalId, baseUnit: schema.products.baseUnit })
      .from(schema.productSourceMappings).innerJoin(schema.products, and(eq(schema.productSourceMappings.productId, schema.products.id), eq(schema.products.storeId, store.id)))
      .where(and(eq(schema.productSourceMappings.storeId, store.id), eq(schema.productSourceMappings.provider, "kiotviet"), sql`${schema.productSourceMappings.deletedAt} is not null`)),
  ]);
  const [customerRows, supplierRows, orderRows, orderLineRows, paymentRows, purchaseRows, purchaseLineRows, returnRows, returnLineRows, purchaseReturnRows, purchaseReturnLineRows] = await Promise.all([
    db.select({ localId: schema.customers.id, code: schema.customers.code, name: schema.customers.name, phone: schema.customers.phone, email: schema.customers.email, address: schema.customers.address, taxCode: schema.customers.taxCode, note: schema.customers.note, isActive: schema.customers.isActive, currentDebt: schema.customers.currentDebt, totalSpent: schema.customers.totalSpent })
      .from(schema.customers).where(eq(schema.customers.storeId, store.id)),
    db.select({ localId: schema.suppliers.id, code: schema.suppliers.code, name: schema.suppliers.name, phone: schema.suppliers.phone, email: schema.suppliers.email, address: schema.suppliers.address, taxCode: schema.suppliers.taxCode, note: schema.suppliers.note, currentDebt: schema.suppliers.currentDebt })
      .from(schema.suppliers).where(eq(schema.suppliers.storeId, store.id)),
    db.select({ localId: schema.orders.id, code: schema.orders.code, documentType: schema.orders.documentType, status: schema.orders.status, customerId: schema.orders.customerId })
      .from(schema.orders).where(eq(schema.orders.storeId, store.id)),
    db.select({ localId: schema.orderItems.id, orderId: schema.orderItems.orderId, productId: schema.orderItems.productId, productName: schema.orderItems.productName, sourceSku: schema.products.sku, unitName: schema.orderItems.unitName, unitMultiplier: schema.orderItems.unitMultiplier, quantity: schema.orderItems.quantity, unitPrice: schema.orderItems.unitPrice, discount: schema.orderItems.discount, total: schema.orderItems.total, note: schema.orderItems.note })
      .from(schema.orderItems).innerJoin(schema.products, and(eq(schema.orderItems.productId, schema.products.id), eq(schema.products.storeId, store.id)))
      .where(eq(schema.orderItems.storeId, store.id)),
    db.select({ localId: schema.payments.id, orderId: schema.payments.orderId, method: schema.payments.method, amount: schema.payments.amount, note: schema.payments.note })
      .from(schema.payments).where(eq(schema.payments.storeId, store.id)),
    db.select({ localId: schema.purchaseOrders.id, code: schema.purchaseOrders.code, subtotal: schema.purchaseOrders.subtotal })
      .from(schema.purchaseOrders).where(eq(schema.purchaseOrders.storeId, store.id)),
    db.select({ localId: schema.purchaseOrderItems.id, purchaseOrderId: schema.purchaseOrderItems.purchaseOrderId, legacyProductSku: schema.products.sku, quantity: schema.purchaseOrderItems.quantity, unitCost: schema.purchaseOrderItems.unitCost, discount: schema.purchaseOrderItems.discount, total: schema.purchaseOrderItems.total })
      .from(schema.purchaseOrderItems).innerJoin(schema.products, and(eq(schema.purchaseOrderItems.productId, schema.products.id), eq(schema.products.storeId, store.id)))
      .where(eq(schema.purchaseOrderItems.storeId, store.id)),
    db.select({ localId: schema.returns.id, code: schema.returns.code, status: schema.returns.status })
      .from(schema.returns).where(eq(schema.returns.storeId, store.id)),
    db.select({ localId: schema.returnItems.id, returnId: schema.returnItems.returnId, orderItemId: schema.returnItems.orderItemId, legacyProductSku: schema.products.sku, quantity: schema.returnItems.quantity, unitPrice: schema.returnItems.unitPrice, total: schema.returnItems.total })
      .from(schema.returnItems).innerJoin(schema.products, and(eq(schema.returnItems.productId, schema.products.id), eq(schema.products.storeId, store.id)))
      .where(eq(schema.returnItems.storeId, store.id)),
    db.select({ localId: schema.purchaseReturns.id, code: schema.purchaseReturns.code, settlementStatus: schema.purchaseReturns.settlementStatus })
      .from(schema.purchaseReturns).where(eq(schema.purchaseReturns.storeId, store.id)),
    db.select({ localId: schema.purchaseReturnItems.id, purchaseReturnId: schema.purchaseReturnItems.purchaseReturnId, legacyProductSku: schema.products.sku, quantity: schema.purchaseReturnItems.quantity, unitCost: schema.purchaseReturnItems.unitCost, returnUnitCost: schema.purchaseReturnItems.returnUnitCost, total: schema.purchaseReturnItems.total })
      .from(schema.purchaseReturnItems).innerJoin(schema.products, and(eq(schema.purchaseReturnItems.productId, schema.products.id), eq(schema.products.storeId, store.id)))
      .where(eq(schema.purchaseReturnItems.storeId, store.id)),
  ]);
  const mappingState: KiotVietCliCurrentState["mappings"] = {};
  if (schemaReady) {
    const rows = await db.select({ entityType: schema.kiotvietSourceMappings.entityType, externalId: schema.kiotvietSourceMappings.externalId, localId: schema.kiotvietSourceMappings.localId })
      .from(schema.kiotvietSourceMappings).where(and(eq(schema.kiotvietSourceMappings.storeId, store.id), eq(schema.kiotvietSourceMappings.provider, "kiotviet"), sql`${schema.kiotvietSourceMappings.deletedAt} is null`));
    for (const row of rows) {
      const values = mappingState[row.entityType] ?? [];
      values.push({ externalId: row.externalId, localId: row.localId });
      mappingState[row.entityType] = values;
    }
  }
  const saleOrders = orderRows.filter((item) => item.documentType === "sale");
  const saleOrderIds = new Set(saleOrders.map((item) => item.localId));
  const bookingOrders = orderRows.filter((item) => item.documentType === "booking");
  const linesByOrder = new Map<string, typeof orderLineRows>();
  for (const line of orderLineRows) {
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
  return {
    storeId: store.id, schemaReady,
    loaderBlockers: [
      ...(duplicateUnitSkus.length > 0 ? [{ phase: "product-references" as const, reason: "base_alternate_sku_collision", count: duplicateUnitSkus.length }] : []),
      { phase: "all", reason: "production_apply_adapter_unavailable", count: 1 },
    ],
    productCatalog: {
      currentBaseProducts,
      productUnits: units.flatMap((item) => item.sku && !baseSkus.has(item.sku) ? [{ ...item, sku: item.sku, multiplier: Number(item.multiplier) }] : []),
      archivedSourceMappings: archived,
      // No schema field records explicit Task-6 placeholder approval. An
      // inactive live product mapping alone is not approval, so fail closed.
      approvedHistoricalPlaceholders: [],
    },
    current: {
      customers: customerRows.map((item) => ({ ...item, legacyImported: !schemaReady })),
      suppliers: supplierRows.map((item) => ({ ...item, isActive: true, legacyImported: !schemaReady })),
      bookings: bookingOrders.map((item) => ({ localId: item.localId, code: item.code, fingerprint: "pre-migration-legacy-current", legacyImported: !schemaReady })),
      sales: saleOrders.map((item) => ({ localId: item.localId, code: item.code, fingerprint: "pre-migration-legacy-current", legacyImported: !schemaReady })),
      saleLines: orderLineRows.filter((item) => saleOrderIds.has(item.orderId)).map((item) => ({ ...item, legacyImported: !schemaReady })),
      salePayments: paymentRows.filter((item) => saleOrderIds.has(item.orderId)).map((item) => {
        const method = legacySalePaymentMethod(item.method);
        return { localId: item.localId, orderId: item.orderId, amount: item.amount, note: item.note, ...(method ? { method } : {}), legacyImported: !schemaReady && method != null, legacyAggregatePayment: item.note === "Import lịch sử KiotViet" };
      }),
      purchases: purchaseRows.map((item) => ({ ...item, fingerprint: "pre-migration-legacy-current", legacyImported: !schemaReady })),
      purchaseLines: purchaseLineRows.map((item) => ({ ...item, legacyImported: !schemaReady })),
      returns: returnRows.map((item) => ({ localId: item.localId, code: item.code, fingerprint: "pre-migration-legacy-current", legacyImported: !schemaReady })),
      returnLines: returnLineRows.map((item) => ({ ...item, active: returnRows.find((parent) => parent.localId === item.returnId)?.status === "completed", legacyImported: !schemaReady })),
      returnSales: saleOrders.flatMap((item) => item.status === "completed" || item.status === "returned" ? [{
        invoiceCode: item.code, orderId: item.localId, customerId: item.customerId, status: item.status,
        items: (linesByOrder.get(item.localId) ?? []).map((line) => ({ localId: line.localId, sourceSku: line.sourceSku, unitName: line.unitName, quantity: line.quantity })),
      }] : []),
      purchaseReturns: purchaseReturnRows.flatMap((item) => ["unsettled", "partial", "settled"].includes(item.settlementStatus) ? [{ ...item, fingerprint: "pre-migration-legacy-current", settlementStatus: item.settlementStatus as "unsettled" | "partial" | "settled", legacyImported: !schemaReady }] : []),
      purchaseReturnLines: purchaseReturnLineRows.map((item) => ({ ...item, legacyImported: !schemaReady })),
      mappings: mappingState,
    },
  };
}

export async function runKiotVietDataSyncCli(argv: string[], dependencies: KiotVietDataSyncCliDependencies = {}) {
  const args = parseKiotVietDataSyncArgs(argv);
  const bundle = (dependencies.readBundle ?? readKiotVietDataBundle)(args.directory);
  if (args.apply && args.phase !== "all") {
    assertKiotVietDataSyncApplyGuard({ apply: true, phase: args.phase, storeSlug: args.storeSlug, reviewedSourceSha256: args.reviewedSourceSha256, actualSourceSha256: reviewedHashForPhase(bundle, args.phase) });
  }
  const state = await (dependencies.loadPlanningState ?? loadProductionReadOnlyState)(args.storeSlug);
  const plans = planKiotVietBundle(bundle, state);
  const selected = args.phase === "all" ? null : plans.find((item) => item.phase === args.phase)!;
  const prerequisite = [
    ...(state.schemaReady ? [] : [{ phase: args.phase, reason: "missing_prerequisite_schema", count: 1 } as KiotVietCliBlocker]),
    ...(state.loaderBlockers ?? []),
  ];
  if (args.apply) {
    if (!state.schemaReady) throw new Error("Cannot apply: prerequisite migration 0116 (kiotviet_source_mappings) is not deployed");
    if (prerequisite.length > 0) throw new Error(`Cannot apply: ${prerequisite.map((item) => item.reason).join(", ")}`);
    if (!selected || selected.blockers.length > 0) throw new Error("Cannot apply a KiotViet phase with unresolved blockers");
    if (!dependencies.applyPhase) throw new Error("Production apply adapter is intentionally unavailable until its phase checkpoint is approved");
    const applied = await dependencies.applyPhase({ phase: args.phase as KiotVietSyncPhase, reviewedSha256: reviewedHashForPhase(bundle, args.phase as KiotVietSyncPhase), bundle, plan: selected });
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
