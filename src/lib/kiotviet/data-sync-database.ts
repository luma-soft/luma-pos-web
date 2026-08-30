import type { db } from "@/db";
import {
  cashTransactions,
  customerReceivableAllocations,
  customerReceivableEntries,
  customerReceivableReceipts,
  customers,
  kiotvietSourceMappings,
  kiotvietSyncRuns,
  notificationEvents,
  notificationOutbox,
  orderItems,
  orders,
  payments,
  purchaseOrderItems,
  purchaseOrders,
  purchaseReturnItems,
  purchaseReturns,
  returnItems,
  returns,
  stockLevels,
  stockLotMovements,
  stockLots,
  stockMovements,
  stores,
  supplierPayableAllocations,
  supplierPayableEntries,
  supplierPayableReceipts,
  suppliers,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type {
  KiotVietDataSyncAuditRepository,
  KiotVietDataSyncTransaction,
  KiotVietInvariantSnapshot,
  KiotVietMappingAdoptionMethod,
  KiotVietMappingEntityType,
} from "./data-sync-runner";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function assertKiotVietStoreIdentity(
  transaction: DatabaseTransaction,
  storeId: string,
  expectedStoreSlug: string,
): Promise<void> {
  const [store] = await transaction.select({ slug: stores.slug }).from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.slug, expectedStoreSlug)))
    .limit(1);
  if (!store) {
    throw new Error(`KiotViet store ${storeId} does not match expected slug ${expectedStoreSlug}`);
  }
}

export function createKiotVietDataSyncAuditRepository(input: {
  storeId: string;
  expectedStoreSlug: "hai-dang";
  runInTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => Promise<T>;
}): KiotVietDataSyncAuditRepository {
  return {
    startRun(run) {
      return input.runInTransaction(async (transaction) => {
        await assertKiotVietStoreIdentity(transaction, input.storeId, input.expectedStoreSlug);
        const [created] = await transaction.insert(kiotvietSyncRuns).values({
          storeId: input.storeId,
          ...run,
          status: "running",
        }).returning({ id: kiotvietSyncRuns.id });
        if (!created) throw new Error("Failed to start KiotViet sync run");
        return created.id;
      });
    },

    failRun(runId, failure) {
      return input.runInTransaction(async (transaction) => {
        await assertKiotVietStoreIdentity(transaction, input.storeId, input.expectedStoreSlug);
        const [failed] = await transaction.update(kiotvietSyncRuns).set({
          status: failure.status,
          errorDetails: failure.errorDetails,
          completedAt: new Date(),
        }).where(and(
          eq(kiotvietSyncRuns.storeId, input.storeId),
          eq(kiotvietSyncRuns.id, runId),
          eq(kiotvietSyncRuns.status, "running"),
        )).returning({ id: kiotvietSyncRuns.id });
        if (!failed) throw new Error(`Running KiotViet sync audit ${runId} was not found`);
      });
    },
  };
}

async function mappingTargetExists(
  transaction: DatabaseTransaction,
  storeId: string,
  entityType: KiotVietMappingEntityType,
  localId: string,
): Promise<boolean> {
  switch (entityType) {
    case "customer":
      return (await transaction.select({ id: customers.id }).from(customers)
        .where(and(eq(customers.storeId, storeId), eq(customers.id, localId))).limit(1)).length === 1;
    case "supplier":
      return (await transaction.select({ id: suppliers.id }).from(suppliers)
        .where(and(eq(suppliers.storeId, storeId), eq(suppliers.id, localId))).limit(1)).length === 1;
    case "booking":
      return (await transaction.select({ id: orders.id }).from(orders)
        .where(and(
          eq(orders.storeId, storeId),
          eq(orders.id, localId),
          eq(orders.documentType, "booking"),
        )).limit(1)).length === 1;
    case "sale":
      return (await transaction.select({ id: orders.id }).from(orders)
        .where(and(
          eq(orders.storeId, storeId),
          eq(orders.id, localId),
          eq(orders.documentType, "sale"),
        )).limit(1)).length === 1;
    case "booking_line":
      return (await transaction.select({ id: orderItems.id }).from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(
          eq(orderItems.storeId, storeId),
          eq(orderItems.id, localId),
          eq(orders.storeId, storeId),
          eq(orders.documentType, "booking"),
        )).limit(1)).length === 1;
    case "sale_line":
      return (await transaction.select({ id: orderItems.id }).from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(
          eq(orderItems.storeId, storeId),
          eq(orderItems.id, localId),
          eq(orders.storeId, storeId),
          eq(orders.documentType, "sale"),
        )).limit(1)).length === 1;
    case "booking_payment":
      return (await transaction.select({ id: payments.id }).from(payments)
        .innerJoin(orders, eq(payments.orderId, orders.id))
        .where(and(
          eq(payments.storeId, storeId),
          eq(payments.id, localId),
          eq(orders.storeId, storeId),
          eq(orders.documentType, "booking"),
        )).limit(1)).length === 1;
    case "sale_payment":
      return (await transaction.select({ id: payments.id }).from(payments)
        .innerJoin(orders, eq(payments.orderId, orders.id))
        .where(and(
          eq(payments.storeId, storeId),
          eq(payments.id, localId),
          eq(orders.storeId, storeId),
          eq(orders.documentType, "sale"),
        )).limit(1)).length === 1;
    case "purchase":
      return (await transaction.select({ id: purchaseOrders.id }).from(purchaseOrders)
        .where(and(eq(purchaseOrders.storeId, storeId), eq(purchaseOrders.id, localId))).limit(1)).length === 1;
    case "purchase_line":
      return (await transaction.select({ id: purchaseOrderItems.id }).from(purchaseOrderItems)
        .where(and(eq(purchaseOrderItems.storeId, storeId), eq(purchaseOrderItems.id, localId))).limit(1)).length === 1;
    case "customer_return":
      return (await transaction.select({ id: returns.id }).from(returns)
        .where(and(eq(returns.storeId, storeId), eq(returns.id, localId))).limit(1)).length === 1;
    case "customer_return_line":
      return (await transaction.select({ id: returnItems.id }).from(returnItems)
        .where(and(eq(returnItems.storeId, storeId), eq(returnItems.id, localId))).limit(1)).length === 1;
    case "supplier_return":
      return (await transaction.select({ id: purchaseReturns.id }).from(purchaseReturns)
        .where(and(eq(purchaseReturns.storeId, storeId), eq(purchaseReturns.id, localId))).limit(1)).length === 1;
    case "supplier_return_line":
      return (await transaction.select({ id: purchaseReturnItems.id }).from(purchaseReturnItems)
        .where(and(eq(purchaseReturnItems.storeId, storeId), eq(purchaseReturnItems.id, localId))).limit(1)).length === 1;
  }
}

export async function captureKiotVietInvariantSnapshot(
  transaction: DatabaseTransaction,
  storeId: string,
): Promise<KiotVietInvariantSnapshot> {
  const [row] = await transaction.select({
    stockLevelRows: sql<number>`(select count(*)::int from ${stockLevels} where ${stockLevels.storeId} = ${storeId})`,
    stockLevelQuantity: sql<string>`(select coalesce(sum(${stockLevels.quantity}), 0)::text from ${stockLevels} where ${stockLevels.storeId} = ${storeId})`,
    stockLevelReserved: sql<string>`(select coalesce(sum(${stockLevels.reserved}), 0)::text from ${stockLevels} where ${stockLevels.storeId} = ${storeId})`,
    stockLevelFingerprint: sql<string>`(select md5(coalesce(jsonb_agg(to_jsonb(${stockLevels}) order by ${stockLevels.productId}, ${stockLevels.warehouseId})::text, '[]')) from ${stockLevels} where ${stockLevels.storeId} = ${storeId})`,
    stockMovementRows: sql<number>`(select count(*)::int from ${stockMovements} where ${stockMovements.storeId} = ${storeId})`,
    stockMovementQuantity: sql<string>`(select coalesce(sum(${stockMovements.quantity}), 0)::text from ${stockMovements} where ${stockMovements.storeId} = ${storeId})`,
    stockMovementFingerprint: sql<string>`(select md5(coalesce(jsonb_agg(to_jsonb(${stockMovements}) order by ${stockMovements.id})::text, '[]')) from ${stockMovements} where ${stockMovements.storeId} = ${storeId})`,
    stockLotRows: sql<number>`(select count(*)::int from ${stockLots} where ${stockLots.storeId} = ${storeId})`,
    stockLotReceived: sql<string>`(select coalesce(sum(${stockLots.receivedQuantity}), 0)::text from ${stockLots} where ${stockLots.storeId} = ${storeId})`,
    stockLotAvailable: sql<string>`(select coalesce(sum(${stockLots.availableQuantity}), 0)::text from ${stockLots} where ${stockLots.storeId} = ${storeId})`,
    stockLotFingerprint: sql<string>`(select md5(coalesce(jsonb_agg(to_jsonb(${stockLots}) order by ${stockLots.id})::text, '[]')) from ${stockLots} where ${stockLots.storeId} = ${storeId})`,
    stockLotMovementRows: sql<number>`(select count(*)::int from ${stockLotMovements} where ${stockLotMovements.storeId} = ${storeId})`,
    stockLotMovementQuantity: sql<string>`(select coalesce(sum(${stockLotMovements.quantity}), 0)::text from ${stockLotMovements} where ${stockLotMovements.storeId} = ${storeId})`,
    stockLotMovementFingerprint: sql<string>`(select md5(coalesce(jsonb_agg(to_jsonb(${stockLotMovements}) order by ${stockLotMovements.id})::text, '[]')) from ${stockLotMovements} where ${stockLotMovements.storeId} = ${storeId})`,
    customerRows: sql<number>`(select count(*)::int from ${customers} where ${customers.storeId} = ${storeId})`,
    customerDebt: sql<string>`(select coalesce(sum(${customers.currentDebt}), 0)::text from ${customers} where ${customers.storeId} = ${storeId})`,
    customerSpent: sql<string>`(select coalesce(sum(${customers.totalSpent}), 0)::text from ${customers} where ${customers.storeId} = ${storeId})`,
    customerFingerprint: sql<string>`(select md5(coalesce(jsonb_agg(to_jsonb(${customers}) order by ${customers.id})::text, '[]')) from ${customers} where ${customers.storeId} = ${storeId})`,
    supplierRows: sql<number>`(select count(*)::int from ${suppliers} where ${suppliers.storeId} = ${storeId})`,
    supplierDebt: sql<string>`(select coalesce(sum(${suppliers.currentDebt}), 0)::text from ${suppliers} where ${suppliers.storeId} = ${storeId})`,
    supplierFingerprint: sql<string>`(select md5(coalesce(jsonb_agg(to_jsonb(${suppliers}) order by ${suppliers.id})::text, '[]')) from ${suppliers} where ${suppliers.storeId} = ${storeId})`,
    cashRows: sql<number>`(select count(*)::int from ${cashTransactions} where ${cashTransactions.storeId} = ${storeId})`,
    cashIn: sql<string>`(select coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'in'), 0)::text from ${cashTransactions} where ${cashTransactions.storeId} = ${storeId})`,
    cashOut: sql<string>`(select coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'out'), 0)::text from ${cashTransactions} where ${cashTransactions.storeId} = ${storeId})`,
    cashFingerprint: sql<string>`(select md5(coalesce(jsonb_agg(to_jsonb(${cashTransactions}) order by ${cashTransactions.id})::text, '[]')) from ${cashTransactions} where ${cashTransactions.storeId} = ${storeId})`,
    customerEntryRows: sql<number>`(select count(*)::int from ${customerReceivableEntries} where ${customerReceivableEntries.storeId} = ${storeId})`,
    customerEntryAmount: sql<string>`(select coalesce(sum(${customerReceivableEntries.amount}), 0)::text from ${customerReceivableEntries} where ${customerReceivableEntries.storeId} = ${storeId})`,
    customerReceiptRows: sql<number>`(select count(*)::int from ${customerReceivableReceipts} where ${customerReceivableReceipts.storeId} = ${storeId})`,
    customerReceiptAmount: sql<string>`(select coalesce(sum(${customerReceivableReceipts.amount}), 0)::text from ${customerReceivableReceipts} where ${customerReceivableReceipts.storeId} = ${storeId})`,
    customerAllocationRows: sql<number>`(select count(*)::int from ${customerReceivableAllocations} where ${customerReceivableAllocations.storeId} = ${storeId})`,
    customerAllocationAmount: sql<string>`(select coalesce(sum(${customerReceivableAllocations.amount}), 0)::text from ${customerReceivableAllocations} where ${customerReceivableAllocations.storeId} = ${storeId})`,
    customerReceivableFingerprint: sql<string>`md5(concat(
      coalesce((select jsonb_agg(to_jsonb(${customerReceivableEntries}) order by ${customerReceivableEntries.id})::text from ${customerReceivableEntries} where ${customerReceivableEntries.storeId} = ${storeId}), '[]'), '|',
      coalesce((select jsonb_agg(to_jsonb(${customerReceivableReceipts}) order by ${customerReceivableReceipts.id})::text from ${customerReceivableReceipts} where ${customerReceivableReceipts.storeId} = ${storeId}), '[]'), '|',
      coalesce((select jsonb_agg(to_jsonb(${customerReceivableAllocations}) order by ${customerReceivableAllocations.id})::text from ${customerReceivableAllocations} where ${customerReceivableAllocations.storeId} = ${storeId}), '[]')
    ))`,
    supplierEntryRows: sql<number>`(select count(*)::int from ${supplierPayableEntries} where ${supplierPayableEntries.storeId} = ${storeId})`,
    supplierEntryAmount: sql<string>`(select coalesce(sum(${supplierPayableEntries.amount}), 0)::text from ${supplierPayableEntries} where ${supplierPayableEntries.storeId} = ${storeId})`,
    supplierReceiptRows: sql<number>`(select count(*)::int from ${supplierPayableReceipts} where ${supplierPayableReceipts.storeId} = ${storeId})`,
    supplierReceiptAmount: sql<string>`(select coalesce(sum(${supplierPayableReceipts.amount}), 0)::text from ${supplierPayableReceipts} where ${supplierPayableReceipts.storeId} = ${storeId})`,
    supplierAllocationRows: sql<number>`(select count(*)::int from ${supplierPayableAllocations} where ${supplierPayableAllocations.storeId} = ${storeId})`,
    supplierAllocationAmount: sql<string>`(select coalesce(sum(${supplierPayableAllocations.amount}), 0)::text from ${supplierPayableAllocations} where ${supplierPayableAllocations.storeId} = ${storeId})`,
    supplierPayableFingerprint: sql<string>`md5(concat(
      coalesce((select jsonb_agg(to_jsonb(${supplierPayableEntries}) order by ${supplierPayableEntries.id})::text from ${supplierPayableEntries} where ${supplierPayableEntries.storeId} = ${storeId}), '[]'), '|',
      coalesce((select jsonb_agg(to_jsonb(${supplierPayableReceipts}) order by ${supplierPayableReceipts.id})::text from ${supplierPayableReceipts} where ${supplierPayableReceipts.storeId} = ${storeId}), '[]'), '|',
      coalesce((select jsonb_agg(to_jsonb(${supplierPayableAllocations}) order by ${supplierPayableAllocations.id})::text from ${supplierPayableAllocations} where ${supplierPayableAllocations.storeId} = ${storeId}), '[]')
    ))`,
    notificationEventRows: sql<number>`(select count(*)::int from ${notificationEvents} where ${notificationEvents.storeId} = ${storeId})`,
    notificationOutboxRows: sql<number>`(select count(*)::int from ${notificationOutbox} where ${notificationOutbox.storeId} = ${storeId})`,
    notificationFingerprint: sql<string>`md5(concat(
      coalesce((select jsonb_agg(to_jsonb(${notificationEvents}) order by ${notificationEvents.id})::text from ${notificationEvents} where ${notificationEvents.storeId} = ${storeId}), '[]'), '|',
      coalesce((select jsonb_agg(to_jsonb(${notificationOutbox}) order by ${notificationOutbox.id})::text from ${notificationOutbox} where ${notificationOutbox.storeId} = ${storeId}), '[]')
    ))`,
  }).from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!row) throw new Error("Failed to capture KiotViet invariant snapshot");
  return {
    stockLevels: { rows: row.stockLevelRows, quantity: row.stockLevelQuantity, reserved: row.stockLevelReserved, fingerprint: row.stockLevelFingerprint },
    stockMovements: { rows: row.stockMovementRows, quantity: row.stockMovementQuantity, fingerprint: row.stockMovementFingerprint },
    stockLots: { rows: row.stockLotRows, receivedQuantity: row.stockLotReceived, availableQuantity: row.stockLotAvailable, fingerprint: row.stockLotFingerprint },
    stockLotMovements: { rows: row.stockLotMovementRows, quantity: row.stockLotMovementQuantity, fingerprint: row.stockLotMovementFingerprint },
    customers: { rows: row.customerRows, currentDebt: row.customerDebt, totalSpent: row.customerSpent, fingerprint: row.customerFingerprint },
    suppliers: { rows: row.supplierRows, currentDebt: row.supplierDebt, fingerprint: row.supplierFingerprint },
    cashTransactions: { rows: row.cashRows, inAmount: row.cashIn, outAmount: row.cashOut, fingerprint: row.cashFingerprint },
    customerReceivables: {
      entryRows: row.customerEntryRows,
      entryAmount: row.customerEntryAmount,
      receiptRows: row.customerReceiptRows,
      receiptAmount: row.customerReceiptAmount,
      allocationRows: row.customerAllocationRows,
      allocationAmount: row.customerAllocationAmount,
      fingerprint: row.customerReceivableFingerprint,
    },
    supplierPayables: {
      entryRows: row.supplierEntryRows,
      entryAmount: row.supplierEntryAmount,
      receiptRows: row.supplierReceiptRows,
      receiptAmount: row.supplierReceiptAmount,
      allocationRows: row.supplierAllocationRows,
      allocationAmount: row.supplierAllocationAmount,
      fingerprint: row.supplierPayableFingerprint,
    },
    notifications: { eventRows: row.notificationEventRows, outboxRows: row.notificationOutboxRows, fingerprint: row.notificationFingerprint },
  };
}

export async function createKiotVietDataSyncTransaction(input: {
  transaction: DatabaseTransaction;
  storeId: string;
  expectedStoreSlug: "hai-dang";
}): Promise<KiotVietDataSyncTransaction> {
  const { transaction, storeId, expectedStoreSlug } = input;
  await assertKiotVietStoreIdentity(transaction, storeId, expectedStoreSlug);
  return {
    captureInvariants: () => captureKiotVietInvariantSnapshot(transaction, storeId),

    async completeRun(runId, summary) {
      const [completed] = await transaction.update(kiotvietSyncRuns).set({
        status: "completed",
        summary,
        completedAt: new Date(),
      }).where(and(
        eq(kiotvietSyncRuns.storeId, storeId),
        eq(kiotvietSyncRuns.id, runId),
        eq(kiotvietSyncRuns.status, "running"),
      ))
        .returning({ id: kiotvietSyncRuns.id });
      if (!completed) throw new Error(`KiotViet sync run ${runId} does not belong to store ${storeId}`);
    },

    async loadSourceMappings(entityType) {
      const mappings = await transaction.select({
        id: kiotvietSourceMappings.id,
        entityType: kiotvietSourceMappings.entityType,
        externalId: kiotvietSourceMappings.externalId,
        localId: kiotvietSourceMappings.localId,
        sourceSha256: kiotvietSourceMappings.sourceSha256,
        adoptionMethod: kiotvietSourceMappings.adoptionMethod,
        lastSeenRunId: kiotvietSourceMappings.lastSeenRunId,
        deletedAt: kiotvietSourceMappings.deletedAt,
      }).from(kiotvietSourceMappings).where(and(
        eq(kiotvietSourceMappings.storeId, storeId),
        eq(kiotvietSourceMappings.provider, "kiotviet"),
        eq(kiotvietSourceMappings.entityType, entityType),
      )).orderBy(kiotvietSourceMappings.externalId);
      return mappings.map((mapping) => ({
        ...mapping,
        entityType: mapping.entityType as KiotVietMappingEntityType,
        adoptionMethod: mapping.adoptionMethod as KiotVietMappingAdoptionMethod,
      }));
    },

    async upsertSourceMapping(mapping) {
      if (!mapping.externalId.trim()) throw new Error("KiotViet mapping external ID cannot be blank");
      if (!(await mappingTargetExists(transaction, storeId, mapping.entityType, mapping.localId))) {
        throw new Error(`${mapping.entityType} target ${mapping.localId} does not belong to store ${storeId}`);
      }
      const [byExternalId] = await transaction.select({
        id: kiotvietSourceMappings.id,
        localId: kiotvietSourceMappings.localId,
      }).from(kiotvietSourceMappings).where(and(
        eq(kiotvietSourceMappings.storeId, storeId),
        eq(kiotvietSourceMappings.provider, "kiotviet"),
        eq(kiotvietSourceMappings.entityType, mapping.entityType),
        eq(kiotvietSourceMappings.externalId, mapping.externalId),
      )).limit(1);
      if (byExternalId && byExternalId.localId !== mapping.localId) {
        throw new Error(`KiotViet mapping collision: ${mapping.entityType}/${mapping.externalId} already maps to ${byExternalId.localId}`);
      }
      const [byLocalId] = await transaction.select({
        id: kiotvietSourceMappings.id,
        externalId: kiotvietSourceMappings.externalId,
      }).from(kiotvietSourceMappings).where(and(
        eq(kiotvietSourceMappings.storeId, storeId),
        eq(kiotvietSourceMappings.provider, "kiotviet"),
        eq(kiotvietSourceMappings.entityType, mapping.entityType),
        eq(kiotvietSourceMappings.localId, mapping.localId),
      )).limit(1);
      if (byLocalId && byLocalId.externalId !== mapping.externalId) {
        throw new Error(`KiotViet local mapping collision: ${mapping.localId} already belongs to ${byLocalId.externalId}`);
      }
      const now = new Date();
      if (byExternalId) {
        await transaction.update(kiotvietSourceMappings).set({
          sourceSha256: mapping.sourceSha256,
          lastSeenRunId: mapping.lastSeenRunId,
          deletedAt: mapping.deletedAt,
          updatedAt: now,
        }).where(and(
          eq(kiotvietSourceMappings.storeId, storeId),
          eq(kiotvietSourceMappings.id, byExternalId.id),
        ));
        return byExternalId.id;
      }
      const [created] = await transaction.insert(kiotvietSourceMappings).values({
        storeId,
        provider: "kiotviet",
        entityType: mapping.entityType,
        externalId: mapping.externalId,
        localId: mapping.localId,
        sourceSha256: mapping.sourceSha256,
        adoptionMethod: mapping.adoptionMethod,
        lastSeenRunId: mapping.lastSeenRunId,
        deletedAt: mapping.deletedAt,
        updatedAt: now,
      }).returning({ id: kiotvietSourceMappings.id });
      if (!created) throw new Error("Failed to create KiotViet source mapping");
      return created.id;
    },
  };
}
