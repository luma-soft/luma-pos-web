import { randomUUID } from "node:crypto";
import type { db } from "@/db";
import {
  customers, orderItems, orders, payments, purchaseOrderItems, purchaseOrders,
  purchaseReturnItems, purchaseReturns, returnItems, returns, suppliers, warehouses,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { KiotVietBookingSyncPlan } from "./booking-sync";
import type { KiotVietCustomerSyncPlan } from "./customer-sync";
import type { KiotVietPurchaseReturnSyncPlan } from "./purchase-return-sync";
import type { KiotVietPurchaseSyncPlan } from "./purchase-sync";
import type { KiotVietReturnSyncPlan } from "./return-sync";
import type { KiotVietSalesSyncPlan } from "./sales-sync";
import type { KiotVietSupplierSyncPlan } from "./supplier-sync";
import type {
  KiotVietDataSyncTransaction, KiotVietMappingAdoptionMethod,
  KiotVietMappingEntityType, KiotVietSyncPhase,
} from "./data-sync-runner";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ProductReferencePlan = { blockers: readonly unknown[]; summary: Record<string, number> };
type TypedPlanByPhase = {
  customers: KiotVietCustomerSyncPlan;
  suppliers: KiotVietSupplierSyncPlan;
  "product-references": ProductReferencePlan;
  bookings: KiotVietBookingSyncPlan;
  sales: KiotVietSalesSyncPlan;
  purchases: KiotVietPurchaseSyncPlan;
  returns: KiotVietReturnSyncPlan;
  "purchase-returns": KiotVietPurchaseReturnSyncPlan;
};

export type KiotVietTypedPhasePlan = {
  [Phase in KiotVietSyncPhase]: {
    phase: Phase;
    summary: Record<string, number>;
    blockers: Array<{ phase: string; reason: string; count: number }>;
    typedPlan: TypedPlanByPhase[Phase];
  }
}[KiotVietSyncPhase];

type ApplyInput = {
  transaction: DatabaseTransaction;
  syncTransaction: KiotVietDataSyncTransaction;
  storeId: string;
  runId: string;
  sourceSha256: string;
  plan: KiotVietTypedPhasePlan;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label = "local ID"): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`KiotViet ${label} requires a real UUID, received ${value}`);
}

function assertOptionalUuid(value: string | null | undefined, label: string): void {
  if (value != null) assertUuid(value, label);
}

function adoptionMethod(action: string, suppliedLocalId: string | undefined): KiotVietMappingAdoptionMethod {
  if (!suppliedLocalId) return "created";
  return action === "adopt" ? "legacy_adopted" : "mapped";
}

async function mapSource(input: ApplyInput & {
  entityType: KiotVietMappingEntityType; externalId: string; localId: string;
  method: KiotVietMappingAdoptionMethod; deletedAt?: Date | null;
}): Promise<void> {
  if (!input.externalId.trim()) throw new Error(`KiotViet ${input.entityType} external ID cannot be blank`);
  assertUuid(input.localId);
  await input.syncTransaction.upsertSourceMapping({
    entityType: input.entityType, externalId: input.externalId, localId: input.localId,
    sourceSha256: input.sourceSha256, adoptionMethod: input.method,
    lastSeenRunId: input.runId, deletedAt: input.deletedAt ?? null,
  });
}

async function requireUpdated(rows: Array<{ id: string }>, label: string): Promise<void> {
  if (rows.length !== 1) throw new Error(`${label} does not belong to the target store`);
}

async function requireDefaultWarehouse(transaction: DatabaseTransaction, storeId: string): Promise<string> {
  const rows = await transaction.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.storeId, storeId), eq(warehouses.isDefault, true))).limit(2);
  if (rows.length !== 1) throw new Error("unresolved_default_warehouse");
  return rows[0]!.id;
}

async function refreshEntityMappings(input: ApplyInput & {
  entityType: KiotVietMappingEntityType;
  entityPlan: {
    adopts: Array<{ externalId: string; localId: string }>;
    unchanged: Array<{ externalId: string; localId: string }>;
  };
}): Promise<void> {
  for (const item of input.entityPlan.adopts) {
    await mapSource({ ...input, entityType: input.entityType, externalId: item.externalId, localId: item.localId, method: "legacy_adopted" });
  }
  for (const item of input.entityPlan.unchanged) {
    await mapSource({ ...input, entityType: input.entityType, externalId: item.externalId, localId: item.localId, method: "mapped" });
  }
}

async function applyCustomers(input: ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "customers" }> }) {
  for (const write of input.plan.typedPlan.writes) {
    const localId = write.localId ?? randomUUID();
    if (write.action === "create" || write.action === "historical_placeholder") {
      const value = write.customer;
      await input.transaction.insert(customers).values({
        id: localId, storeId: input.storeId, code: value.code, name: value.name,
        type: "type" in value ? value.type : "retail",
        phone: "phone" in value ? value.phone : null, email: "email" in value ? value.email : null,
        address: "address" in value ? value.address : null, taxCode: "taxCode" in value ? value.taxCode : null,
        note: "note" in value ? value.note : null, isActive: value.isActive,
        currentDebt: String(value.currentDebt), totalSpent: String(value.totalSpent),
      });
    } else if (write.action === "inactivate") {
      await requireUpdated(await input.transaction.update(customers).set({ isActive: false })
        .where(and(eq(customers.storeId, input.storeId), eq(customers.id, localId))).returning({ id: customers.id }), `Customer ${localId}`);
    } else {
      const value = write.customer;
      await requireUpdated(await input.transaction.update(customers).set({
        code: value.code, name: value.name, phone: value.phone, email: value.email,
        address: value.address, taxCode: value.taxCode, note: value.note, isActive: value.isActive,
        currentDebt: String(value.currentDebt), totalSpent: String(value.totalSpent),
      }).where(and(eq(customers.storeId, input.storeId), eq(customers.id, localId))).returning({ id: customers.id }), `Customer ${localId}`);
    }
    await mapSource({ ...input, entityType: "customer", externalId: write.externalId, localId,
      method: adoptionMethod(write.action, write.localId), deletedAt: write.action === "inactivate" ? new Date() : null });
  }
  await refreshEntityMappings({ ...input, entityType: "customer", entityPlan: input.plan.typedPlan.entityPlan });
}

async function applySuppliers(input: ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "suppliers" }> }) {
  for (const write of input.plan.typedPlan.writes) {
    const localId = write.localId ?? randomUUID();
    if (write.action === "create" || write.action === "historical_placeholder" || write.action === "unknown_supplier_placeholder") {
      const value = write.supplier;
      await input.transaction.insert(suppliers).values({
        id: localId, storeId: input.storeId, code: value.code, name: value.name,
        phone: "phone" in value ? value.phone : null, email: "email" in value ? value.email : null,
        address: "address" in value ? value.address : null, taxCode: "taxCode" in value ? value.taxCode : null,
        note: "note" in value ? value.note : null, isActive: value.isActive, currentDebt: String(value.currentDebt),
      });
    } else if (write.action === "inactivate") {
      await requireUpdated(await input.transaction.update(suppliers).set({ isActive: false })
        .where(and(eq(suppliers.storeId, input.storeId), eq(suppliers.id, localId))).returning({ id: suppliers.id }), `Supplier ${localId}`);
    } else if (write.action === "adopt" || write.action === "update") {
      const value = write.supplier;
      await requireUpdated(await input.transaction.update(suppliers).set({
        code: value.code, name: value.name, phone: value.phone, email: value.email,
        address: value.address, taxCode: value.taxCode, note: value.note, isActive: value.isActive,
        currentDebt: String(value.currentDebt),
      }).where(and(eq(suppliers.storeId, input.storeId), eq(suppliers.id, localId))).returning({ id: suppliers.id }), `Supplier ${localId}`);
    }
    await mapSource({ ...input, entityType: "supplier", externalId: write.externalId, localId,
      method: adoptionMethod(write.action, write.localId), deletedAt: write.action === "inactivate" ? new Date() : null });
  }
  await refreshEntityMappings({ ...input, entityType: "supplier", entityPlan: input.plan.typedPlan.entityPlan });
}

function orderBaseValues(value: {
  code: string; documentType: "booking" | "sale"; status: "completed" | "draft";
  paymentStatus: "unpaid" | "deposit" | "paid"; customerId: string | null; createdAt: Date;
  subtotal: number; discount: number; tax: number; shippingFee: number; total: number; amountPaid: number;
  note: string | null;
}) {
  assertOptionalUuid(value.customerId, "customer reference");
  return {
    code: value.code, documentType: value.documentType,
    status: value.status,
    paymentStatus: value.paymentStatus, customerId: value.customerId,
    subtotal: String(value.subtotal), discount: String(value.discount), tax: String(value.tax),
    shippingFee: String(value.shippingFee), total: String(value.total), amountPaid: String(value.amountPaid),
    note: value.note, createdAt: value.createdAt, updatedAt: new Date(),
  };
}

function bookingOrderValues(value: Parameters<typeof orderBaseValues>[0] & { deliveryDate: Date | null }) {
  return { ...orderBaseValues(value), deliveryDate: value.deliveryDate };
}

function saleOrderValues(
  value: Parameters<typeof orderBaseValues>[0] & { sourceOrderId: string | null },
  status: "completed" | "returned",
) {
  assertOptionalUuid(value.sourceOrderId, "source booking reference");
  return { ...orderBaseValues(value), status, sourceOrderId: value.sourceOrderId };
}

type OrderLine = {
  productId: string; sourceSku: string; productName: string; unitName: string; unitMultiplier: number;
  quantity: number; unitPrice: number; discount: number; total: number; note: string | null;
};

async function writeOrderLine(input: ApplyInput & {
  parentId: string; entityType: "booking_line" | "sale_line"; externalId: string; localId?: string;
  line: OrderLine; parentWasCreated: boolean; method?: KiotVietMappingAdoptionMethod;
}) {
  assertUuid(input.line.productId, "product reference");
  if (!input.line.sourceSku.trim() || !input.line.unitName.trim() || input.line.unitMultiplier <= 0) {
    throw new Error("KiotViet order line source SKU/unit/multiplier must be valid");
  }
  let localId = input.localId;
  const method: KiotVietMappingAdoptionMethod = input.method ?? (localId ? "mapped" : "created");
  localId ??= randomUUID();
  const values = {
    productId: input.line.productId, sourceSku: input.line.sourceSku, productName: input.line.productName,
    unitName: input.line.unitName, unitMultiplier: String(input.line.unitMultiplier),
    quantity: String(input.line.quantity), unitPrice: String(input.line.unitPrice), discount: String(input.line.discount),
    total: String(input.line.total), note: input.line.note,
  };
  if (input.parentWasCreated || method === "created") {
    await input.transaction.insert(orderItems).values({ id: localId, storeId: input.storeId, orderId: input.parentId, ...values });
  } else {
    await requireUpdated(await input.transaction.update(orderItems).set(values).where(and(
      eq(orderItems.storeId, input.storeId), eq(orderItems.orderId, input.parentId), eq(orderItems.id, localId),
    )).returning({ id: orderItems.id }), `${input.entityType} ${localId}`);
  }
  await mapSource({ ...input, entityType: input.entityType, externalId: input.externalId, localId, method });
}

async function writeOrderPayment(input: ApplyInput & {
  parentId: string; entityType: "booking_payment" | "sale_payment"; externalId: string; localId?: string;
  payment: { method: "cash" | "card" | "bank_transfer" | "momo" | "credit"; amount: number };
  parentWasCreated: boolean; method?: KiotVietMappingAdoptionMethod;
}) {
  let localId = input.localId;
  const method: KiotVietMappingAdoptionMethod = input.method ?? (localId ? "mapped" : "created");
  localId ??= randomUUID();
  const values = { method: input.payment.method, amount: String(input.payment.amount) };
  if (input.parentWasCreated || method === "created") {
    await input.transaction.insert(payments).values({ id: localId, storeId: input.storeId, orderId: input.parentId, ...values });
  } else {
    await requireUpdated(await input.transaction.update(payments).set(values).where(and(
      eq(payments.storeId, input.storeId), eq(payments.orderId, input.parentId), eq(payments.id, localId),
    )).returning({ id: payments.id }), `${input.entityType} ${localId}`);
  }
  await mapSource({ ...input, entityType: input.entityType, externalId: input.externalId, localId, method });
}

async function applyBookings(input: ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "bookings" }> }) {
  for (const write of input.plan.typedPlan.writes) {
    const localId = write.localId ?? randomUUID();
    const parentWasCreated = write.action === "create";
    const values = bookingOrderValues(write.booking);
    if (parentWasCreated) await input.transaction.insert(orders).values({ id: localId, storeId: input.storeId, ...values });
    else await requireUpdated(await input.transaction.update(orders).set(values).where(and(
      eq(orders.storeId, input.storeId), eq(orders.id, localId), eq(orders.documentType, "booking"),
    )).returning({ id: orders.id }), `Booking ${localId}`);
    await mapSource({ ...input, entityType: "booking", externalId: write.externalId, localId, method: adoptionMethod(write.action, write.localId) });
    for (const child of write.booking.lines) await writeOrderLine({
      ...input, parentId: localId, entityType: "booking_line", externalId: child.externalId,
      localId: child.localId, line: child.line, parentWasCreated, method: child.adoptionMethod,
    });
    for (const child of write.booking.payments) await writeOrderPayment({
      ...input, parentId: localId, entityType: "booking_payment", externalId: child.externalId,
      localId: child.localId, payment: child.payment, parentWasCreated, method: child.adoptionMethod,
    });
  }
  await refreshEntityMappings({ ...input, entityType: "booking", entityPlan: input.plan.typedPlan.entityPlan });
}

async function applySales(input: ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "sales" }> }) {
  for (const write of input.plan.typedPlan.writes) {
    const localId = write.localId ?? randomUUID();
    const parentWasCreated = write.action === "create";
    const currentStatus = parentWasCreated ? undefined : await input.transaction
      .select({ status: orders.status }).from(orders).where(and(
        eq(orders.storeId, input.storeId), eq(orders.id, localId), eq(orders.documentType, "sale"),
      )).limit(1);
    // Customer-return reconciliation owns only the `returned` transition.
    // Every other stale mapped status is source-owned and repaired to completed.
    const status = currentStatus?.[0]?.status === "returned" ? "returned" : "completed";
    const values = saleOrderValues(write.sale, status);
    if (parentWasCreated) await input.transaction.insert(orders).values({ id: localId, storeId: input.storeId, ...values });
    else await requireUpdated(await input.transaction.update(orders).set(values).where(and(
      eq(orders.storeId, input.storeId), eq(orders.id, localId), eq(orders.documentType, "sale"),
    )).returning({ id: orders.id }), `Sale ${localId}`);
    await mapSource({ ...input, entityType: "sale", externalId: write.externalId, localId, method: adoptionMethod(write.action, write.localId) });
    for (const child of write.sale.lines) await writeOrderLine({ ...input, parentId: localId, entityType: "sale_line", externalId: child.externalId, localId: child.localId, line: child.line, parentWasCreated, method: child.adoptionMethod });
    for (const child of write.sale.payments) await writeOrderPayment({ ...input, parentId: localId, entityType: "sale_payment", externalId: child.externalId, localId: child.localId, payment: child.payment, parentWasCreated, method: child.adoptionMethod });
  }
  await refreshEntityMappings({ ...input, entityType: "sale", entityPlan: input.plan.typedPlan.entityPlan });
}

async function applyPurchases(input: ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "purchases" }> }) {
  const defaultWarehouseId = input.plan.typedPlan.writes.length > 0 ? await requireDefaultWarehouse(input.transaction, input.storeId) : null;
  for (const write of input.plan.typedPlan.writes) {
    const localId = write.localId ?? randomUUID();
    const value = write.purchase;
    assertUuid(value.supplierId, "supplier reference");
    const parent = {
      code: value.code, supplierId: value.supplierId, status: value.status,
      subtotal: String(value.subtotal), discount: String(value.discount), vatRate: String(value.vatRate), tax: String(value.tax),
      total: String(value.total), amountPaid: String(value.amountPaid), invoiceNumber: value.invoiceNumber,
      note: value.note, createdAt: value.createdAt,
    };
    if (write.action === "create") await input.transaction.insert(purchaseOrders).values({ id: localId, storeId: input.storeId, warehouseId: defaultWarehouseId!, ...parent });
    else await requireUpdated(await input.transaction.update(purchaseOrders).set(parent).where(and(
      eq(purchaseOrders.storeId, input.storeId), eq(purchaseOrders.id, localId),
    )).returning({ id: purchaseOrders.id }), `Purchase ${localId}`);
    await mapSource({ ...input, entityType: "purchase", externalId: write.externalId, localId, method: adoptionMethod(write.action, write.localId) });
    for (const child of value.lines) {
      const childId = child.localId ?? randomUUID();
      const line = child.line;
      assertUuid(line.productId, "product reference");
      if (!line.sourceSku.trim() || !line.unitName.trim() || line.unitMultiplier <= 0) throw new Error("KiotViet purchase line source SKU/unit/multiplier must be valid");
      const values = { productId: line.productId, productName: line.productName, sku: line.sourceSku, unitName: line.unitName,
        unitMultiplier: String(line.unitMultiplier), quantity: String(line.quantity), unitCost: String(line.unitCost), discount: String(line.discount), total: String(line.total) };
      if (!child.localId) await input.transaction.insert(purchaseOrderItems).values({ id: childId, storeId: input.storeId, purchaseOrderId: localId, ...values });
      else await requireUpdated(await input.transaction.update(purchaseOrderItems).set(values).where(and(
        eq(purchaseOrderItems.storeId, input.storeId), eq(purchaseOrderItems.purchaseOrderId, localId), eq(purchaseOrderItems.id, childId),
      )).returning({ id: purchaseOrderItems.id }), `Purchase line ${childId}`);
      await mapSource({ ...input, entityType: "purchase_line", externalId: child.externalId, localId: childId, method: child.adoptionMethod });
    }
  }
  await refreshEntityMappings({ ...input, entityType: "purchase", entityPlan: input.plan.typedPlan.entityPlan });
}

async function applyReturns(input: ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "returns" }> }) {
  for (const write of input.plan.typedPlan.writes) {
    const localId = write.localId ?? randomUUID();
    const value = write.return;
    assertOptionalUuid(value.orderId, "sale reference");
    assertOptionalUuid(value.customerId, "customer reference");
    const parent = {
      code: value.code, orderId: value.orderId, customerId: value.customerId, status: value.status,
      totalRefund: String(value.totalRefund), refundAmount: String(value.refundAmount), settlementStatus: value.settlementStatus,
      sourceInvoiceCode: value.invoiceCode, sourceSubtotal: String(value.subtotal), sourceDiscount: String(value.discount),
      sourceTax: String(value.tax), sourceOtherRefund: String(value.otherRefund), sourceReturnFee: String(value.returnFee),
      sourcePaymentSnapshots: value.paymentSnapshots, note: value.note, createdAt: value.createdAt, updatedAt: new Date(),
    };
    if (write.action === "create") await input.transaction.insert(returns).values({ id: localId, storeId: input.storeId, ...parent });
    else await requireUpdated(await input.transaction.update(returns).set(parent).where(and(
      eq(returns.storeId, input.storeId), eq(returns.id, localId),
    )).returning({ id: returns.id }), `Return ${localId}`);
    await mapSource({ ...input, entityType: "customer_return", externalId: write.externalId, localId, method: adoptionMethod(write.action, write.localId) });
    for (const child of value.lines) {
      const childId = child.localId ?? randomUUID();
      const line = child.line;
      assertUuid(line.productId, "product reference");
      assertOptionalUuid(line.orderItemId, "sale line reference");
      if (!line.sourceSku.trim() || !line.unitName.trim() || line.unitMultiplier <= 0) throw new Error("KiotViet return line source SKU/unit/multiplier must be valid");
      const values = { orderItemId: line.orderItemId, productId: line.productId, sourceSku: line.sourceSku,
        productName: line.productName, unitName: line.unitName, unitMultiplier: String(line.unitMultiplier),
        quantity: String(line.quantity), unitPrice: String(line.unitPrice), total: String(line.total), restock: false };
      if (!child.localId) await input.transaction.insert(returnItems).values({ id: childId, storeId: input.storeId, returnId: localId, ...values });
      else await requireUpdated(await input.transaction.update(returnItems).set(values).where(and(
        eq(returnItems.storeId, input.storeId), eq(returnItems.returnId, localId), eq(returnItems.id, childId),
      )).returning({ id: returnItems.id }), `Return line ${childId}`);
      await mapSource({ ...input, entityType: "customer_return_line", externalId: child.externalId, localId: childId, method: child.adoptionMethod });
    }
  }
  for (const repair of input.plan.typedPlan.saleStatusUpdates) {
    assertUuid(repair.orderId, "sale status repair ID");
    await requireUpdated(await input.transaction.update(orders).set({ status: repair.status, updatedAt: new Date() }).where(and(
      eq(orders.storeId, input.storeId), eq(orders.id, repair.orderId), eq(orders.documentType, "sale"),
    )).returning({ id: orders.id }), `Return parent sale ${repair.orderId}`);
  }
  await refreshEntityMappings({ ...input, entityType: "customer_return", entityPlan: input.plan.typedPlan.entityPlan });
}

async function applyPurchaseReturns(input: ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "purchase-returns" }> }) {
  const defaultWarehouseId = input.plan.typedPlan.writes.length > 0 ? await requireDefaultWarehouse(input.transaction, input.storeId) : null;
  for (const write of input.plan.typedPlan.writes) {
    const localId = write.localId ?? randomUUID();
    const value = write.purchaseReturn;
    assertUuid(value.supplierId, "supplier reference");
    const parent = {
      code: value.code, purchaseOrderId: null, supplierId: value.supplierId, status: value.status,
      settlementStatus: value.settlementStatus, subtotal: String(value.subtotal), discount: String(value.discount),
      vatRate: String(value.vatRate), tax: String(value.tax), totalRefund: String(value.totalRefund),
      refundAmount: String(value.refundAmount), refundMethod: value.refundMethod, debtAmount: String(value.debtAmount),
      note: value.note, createdAt: value.createdAt,
    };
    if (write.action === "create") await input.transaction.insert(purchaseReturns).values({ id: localId, storeId: input.storeId, warehouseId: defaultWarehouseId!, ...parent });
    else await requireUpdated(await input.transaction.update(purchaseReturns).set(parent).where(and(
      eq(purchaseReturns.storeId, input.storeId), eq(purchaseReturns.id, localId),
    )).returning({ id: purchaseReturns.id }), `Supplier return ${localId}`);
    await mapSource({ ...input, entityType: "supplier_return", externalId: write.externalId, localId, method: adoptionMethod(write.action, write.localId) });
    for (const child of value.lines) {
      const childId = child.localId ?? randomUUID();
      const line = child.line;
      assertUuid(line.productId, "product reference");
      if (!line.sourceSku.trim() || !line.unitName.trim() || line.unitMultiplier <= 0) throw new Error("KiotViet supplier return line source SKU/unit/multiplier must be valid");
      const values = { purchaseOrderItemId: null, productId: line.productId, productName: line.productName,
        sku: line.sourceSku, unitName: line.unitName, unitMultiplier: String(line.unitMultiplier),
        quantity: String(line.quantity), unitCost: String(line.unitCost), returnUnitCost: String(line.returnUnitCost), total: String(line.total) };
      if (!child.localId) await input.transaction.insert(purchaseReturnItems).values({ id: childId, storeId: input.storeId, purchaseReturnId: localId, ...values });
      else await requireUpdated(await input.transaction.update(purchaseReturnItems).set(values).where(and(
        eq(purchaseReturnItems.storeId, input.storeId), eq(purchaseReturnItems.purchaseReturnId, localId), eq(purchaseReturnItems.id, childId),
      )).returning({ id: purchaseReturnItems.id }), `Supplier return line ${childId}`);
      await mapSource({ ...input, entityType: "supplier_return_line", externalId: child.externalId, localId: childId, method: child.adoptionMethod });
    }
  }
  await refreshEntityMappings({ ...input, entityType: "supplier_return", entityPlan: input.plan.typedPlan.entityPlan });
}

export async function applyKiotVietTypedPhasePlan(input: ApplyInput): Promise<void> {
  if (input.plan.blockers.length > 0) throw new Error("Cannot apply a KiotViet phase with unresolved blockers");
  switch (input.plan.phase) {
    case "customers": return applyCustomers(input as ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "customers" }> });
    case "suppliers": return applySuppliers(input as ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "suppliers" }> });
    case "product-references":
      if (input.plan.typedPlan.blockers.length > 0) throw new Error("Product references require explicit resolution before apply");
      return;
    case "bookings": return applyBookings(input as ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "bookings" }> });
    case "sales": return applySales(input as ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "sales" }> });
    case "purchases": return applyPurchases(input as ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "purchases" }> });
    case "returns": return applyReturns(input as ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "returns" }> });
    case "purchase-returns": return applyPurchaseReturns(input as ApplyInput & { plan: Extract<KiotVietTypedPhasePlan, { phase: "purchase-returns" }> });
  }
}
