import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiListingSuggestions,
  customers,
  marketplaceMessageThreads,
  marketplaceMessages,
  marketplaceOrderMappings,
  marketplaceProductMappings,
  marketplaceShops,
  marketplaceSyncJobs,
  orders,
  products,
  warehouses,
} from "@/db/schema";

const EMPTY_SHOPEE_SUMMARY = {
  shop: null,
  shops: [],
  metrics: {
    listings: 0,
    publishedListings: 0,
    failedJobs: 0,
    pendingJobs: 0,
  },
};

function pgErrorCode(e: unknown): string | undefined {
  return (e as { cause?: { code?: string } })?.cause?.code
    ?? (e as { code?: string })?.code;
}

function isMissingMarketplaceTable(e: unknown) {
  return pgErrorCode(e) === "42P01" || (e instanceof Error && e.message.includes("marketplace_"));
}

export async function getShopeeConnectionSummary(storeId: string) {
  try {
    const shops = await db
      .select({
        id: marketplaceShops.id,
        shopId: marketplaceShops.shopId,
        shopName: marketplaceShops.shopName,
        region: marketplaceShops.region,
        status: marketplaceShops.status,
        connectedAt: marketplaceShops.connectedAt,
        tokenExpiresAt: marketplaceShops.tokenExpiresAt,
        lastSyncAt: marketplaceShops.lastSyncAt,
        lastError: marketplaceShops.lastError,
        metadata: marketplaceShops.metadata,
      })
      .from(marketplaceShops)
      .where(and(eq(marketplaceShops.storeId, storeId), eq(marketplaceShops.provider, "shopee")))
      .orderBy(desc(marketplaceShops.updatedAt))
      .limit(20);

    const [metrics] = await db
      .select({
        listings: sql<number>`count(*) filter (where ${marketplaceProductMappings.provider} = 'shopee')::int`,
        publishedListings: sql<number>`count(*) filter (where ${marketplaceProductMappings.provider} = 'shopee' and ${marketplaceProductMappings.status} = 'published')::int`,
        failedJobs: sql<number>`(select count(*)::int from marketplace_sync_jobs where store_id = ${storeId} and provider = 'shopee' and status = 'failed')`,
        pendingJobs: sql<number>`(select count(*)::int from marketplace_sync_jobs where store_id = ${storeId} and provider = 'shopee' and status in ('pending','retrying'))`,
      })
      .from(marketplaceProductMappings)
      .where(eq(marketplaceProductMappings.storeId, storeId));

    return { shop: shops[0] ?? null, shops, metrics };
  } catch (e) {
    if (isMissingMarketplaceTable(e)) return EMPTY_SHOPEE_SUMMARY;
    throw e;
  }
}

export async function getProductShopeeMapping(storeId: string, productId: string) {
  const [row] = await db
    .select()
    .from(marketplaceProductMappings)
    .where(and(eq(marketplaceProductMappings.storeId, storeId), eq(marketplaceProductMappings.productId, productId)))
    .limit(1);
  return row ?? null;
}

export async function getShopeeDashboard(storeId: string) {
  try {
    const [summary, jobs, mappings, orderMappings, warehouseRows] = await Promise.all([
      getShopeeConnectionSummary(storeId),
      db
        .select()
        .from(marketplaceSyncJobs)
        .where(and(eq(marketplaceSyncJobs.storeId, storeId), eq(marketplaceSyncJobs.provider, "shopee")))
        .orderBy(desc(marketplaceSyncJobs.updatedAt))
        .limit(20),
      db
        .select({
          id: marketplaceProductMappings.id,
          productId: marketplaceProductMappings.productId,
          productName: products.name,
          sku: products.sku,
          status: marketplaceProductMappings.status,
          title: marketplaceProductMappings.title,
          externalItemId: marketplaceProductMappings.externalItemId,
          price: marketplaceProductMappings.price,
          stock: marketplaceProductMappings.stock,
          lastSyncAt: marketplaceProductMappings.lastSyncAt,
          lastError: marketplaceProductMappings.lastError,
        })
        .from(marketplaceProductMappings)
        .leftJoin(products, eq(products.id, marketplaceProductMappings.productId))
        .where(and(eq(marketplaceProductMappings.storeId, storeId), eq(marketplaceProductMappings.provider, "shopee")))
        .orderBy(desc(marketplaceProductMappings.updatedAt))
        .limit(50),
      db
        .select({
          id: marketplaceOrderMappings.id,
          externalOrderSn: marketplaceOrderMappings.externalOrderSn,
          externalStatus: marketplaceOrderMappings.externalStatus,
          importedAt: marketplaceOrderMappings.importedAt,
          orderId: marketplaceOrderMappings.orderId,
          orderCode: orders.code,
          total: orders.total,
          customerName: customers.name,
        })
        .from(marketplaceOrderMappings)
        .leftJoin(orders, eq(orders.id, marketplaceOrderMappings.orderId))
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .where(and(eq(marketplaceOrderMappings.storeId, storeId), eq(marketplaceOrderMappings.provider, "shopee")))
        .orderBy(desc(marketplaceOrderMappings.importedAt))
        .limit(30),
      db
        .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
        .from(warehouses)
        .where(eq(warehouses.storeId, storeId))
        .orderBy(desc(warehouses.isDefault), warehouses.name)
        .limit(80),
    ]);
    return { ...summary, jobs, mappings, orderMappings, warehouses: warehouseRows };
  } catch (e) {
    if (isMissingMarketplaceTable(e)) return { ...EMPTY_SHOPEE_SUMMARY, jobs: [], mappings: [], orderMappings: [], warehouses: [] };
    throw e;
  }
}

export async function getShopeeInbox(storeId: string) {
  try {
    const threads = await db
      .select({
        id: marketplaceMessageThreads.id,
        externalThreadId: marketplaceMessageThreads.externalThreadId,
        buyerName: marketplaceMessageThreads.buyerName,
        status: marketplaceMessageThreads.status,
        lastMessageAt: marketplaceMessageThreads.lastMessageAt,
        customerName: customers.name,
        orderCode: orders.code,
      })
      .from(marketplaceMessageThreads)
      .leftJoin(customers, eq(customers.id, marketplaceMessageThreads.customerId))
      .leftJoin(orders, eq(orders.id, marketplaceMessageThreads.orderId))
      .where(and(eq(marketplaceMessageThreads.storeId, storeId), eq(marketplaceMessageThreads.provider, "shopee")))
      .orderBy(desc(marketplaceMessageThreads.lastMessageAt))
      .limit(30);

    const messages = await db
      .select()
      .from(marketplaceMessages)
      .where(eq(marketplaceMessages.storeId, storeId))
      .orderBy(desc(marketplaceMessages.sentAt))
      .limit(120);

    return {
      threads: threads.map((thread) => ({
        ...thread,
        messages: messages
          .filter((message) => message.threadId === thread.id)
          .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
      })),
    };
  } catch (e) {
    if (isMissingMarketplaceTable(e)) return { threads: [] };
    throw e;
  }
}

export async function getLatestAiListingSuggestion(storeId: string, productId: string) {
  const [row] = await db
    .select()
    .from(aiListingSuggestions)
    .where(and(eq(aiListingSuggestions.storeId, storeId), eq(aiListingSuggestions.productId, productId)))
    .orderBy(desc(aiListingSuggestions.createdAt))
    .limit(1);
  return row ?? null;
}
