import { and, asc, count, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  products,
  profiles,
  purchaseReturnItems,
  purchaseReturns,
  suppliers,
  stockLevels,
  warehouses,
} from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";
import { coercePageSize } from "@/lib/pagination";
import { stockManagedCategoryCondition } from "@/lib/data/product-stock";

export async function getPurchaseReturns(filters: { q?: string; status?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize);
  const conditions: SQL[] = [];
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const c = or(accentInsensitiveLike(purchaseReturns.code, q), accentInsensitiveLike(suppliers.name, q));
    if (c) conditions.push(c);
  }
  if (filters.status && ["completed", "draft"].includes(filters.status)) conditions.push(eq(purchaseReturns.status, filters.status));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: purchaseReturns.id,
        code: purchaseReturns.code,
        purchaseOrderId: purchaseReturns.purchaseOrderId,
        supplierId: purchaseReturns.supplierId,
        warehouseId: purchaseReturns.warehouseId,
        status: purchaseReturns.status,
        settlementStatus: purchaseReturns.settlementStatus,
        subtotal: purchaseReturns.subtotal,
        discount: purchaseReturns.discount,
        vatRate: purchaseReturns.vatRate,
        tax: purchaseReturns.tax,
        totalRefund: purchaseReturns.totalRefund,
        refundAmount: purchaseReturns.refundAmount,
        refundMethod: purchaseReturns.refundMethod,
        debtAmount: purchaseReturns.debtAmount,
        note: purchaseReturns.note,
        createdAt: purchaseReturns.createdAt,
        supplierName: suppliers.name,
        warehouseName: warehouses.name,
        createdByName: profiles.fullName,
      })
      .from(purchaseReturns)
      .innerJoin(suppliers, eq(purchaseReturns.supplierId, suppliers.id))
      .innerJoin(warehouses, eq(purchaseReturns.warehouseId, warehouses.id))
      .leftJoin(profiles, eq(purchaseReturns.createdBy, profiles.id))
      .where(where)
      .orderBy(desc(purchaseReturns.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ total: count() }).from(purchaseReturns).innerJoin(suppliers, eq(purchaseReturns.supplierId, suppliers.id)).where(where),
  ]);

  const ids = rows.map((row) => row.id);
  const itemRows = ids.length
    ? await db
        .select({
          id: purchaseReturnItems.id,
          purchaseReturnId: purchaseReturnItems.purchaseReturnId,
          productId: purchaseReturnItems.productId,
          productName: purchaseReturnItems.productName,
          sku: purchaseReturnItems.sku,
          unitName: purchaseReturnItems.unitName,
          quantity: purchaseReturnItems.quantity,
          unitCost: purchaseReturnItems.unitCost,
          returnUnitCost: purchaseReturnItems.returnUnitCost,
          total: purchaseReturnItems.total,
        })
        .from(purchaseReturnItems)
        .innerJoin(products, eq(purchaseReturnItems.productId, products.id))
        .where(inArray(purchaseReturnItems.purchaseReturnId, ids))
        .orderBy(asc(purchaseReturnItems.productName))
    : [];
  const itemsByReturn = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const current = itemsByReturn.get(item.purchaseReturnId) ?? [];
    current.push(item);
    itemsByReturn.set(item.purchaseReturnId, current);
  }

  return {
    rows: rows.map((row) => ({ ...row, items: itemsByReturn.get(row.id) ?? [] })),
    total,
    page,
    pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
  };
}

export async function getPurchaseReturn(id: string) {
  const rows = await db
    .select({
      id: purchaseReturns.id,
      code: purchaseReturns.code,
      purchaseOrderId: purchaseReturns.purchaseOrderId,
      supplierId: purchaseReturns.supplierId,
      warehouseId: purchaseReturns.warehouseId,
      status: purchaseReturns.status,
      settlementStatus: purchaseReturns.settlementStatus,
      subtotal: purchaseReturns.subtotal,
      discount: purchaseReturns.discount,
      vatRate: purchaseReturns.vatRate,
      tax: purchaseReturns.tax,
      totalRefund: purchaseReturns.totalRefund,
      refundAmount: purchaseReturns.refundAmount,
      refundMethod: purchaseReturns.refundMethod,
      debtAmount: purchaseReturns.debtAmount,
      note: purchaseReturns.note,
      createdAt: purchaseReturns.createdAt,
      supplierName: suppliers.name,
      warehouseName: warehouses.name,
      createdByName: profiles.fullName,
    })
    .from(purchaseReturns)
    .innerJoin(suppliers, eq(purchaseReturns.supplierId, suppliers.id))
    .innerJoin(warehouses, eq(purchaseReturns.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(purchaseReturns.createdBy, profiles.id))
    .where(eq(purchaseReturns.id, id))
    .limit(1);
  const ret = rows[0];
  if (!ret) return null;
  const items = await db
    .select({
      id: purchaseReturnItems.id,
      purchaseReturnId: purchaseReturnItems.purchaseReturnId,
      productId: purchaseReturnItems.productId,
      productName: purchaseReturnItems.productName,
      sku: purchaseReturnItems.sku,
      unitName: purchaseReturnItems.unitName,
      quantity: purchaseReturnItems.quantity,
      unitCost: purchaseReturnItems.unitCost,
      returnUnitCost: purchaseReturnItems.returnUnitCost,
      total: purchaseReturnItems.total,
    })
    .from(purchaseReturnItems)
    .where(eq(purchaseReturnItems.purchaseReturnId, id))
    .orderBy(asc(purchaseReturnItems.productName));
  return { ...ret, items };
}

export { getPurchaseFormOptions as getPurchaseReturnFormOptions } from "@/lib/data/inventory";

export async function searchPurchaseReturnProductRows(q: string, warehouseId: string) {
  const term = q.trim();
  if (!term || !warehouseId) return [];
  return db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      baseUnit: products.baseUnit,
      costPrice: products.costPrice,
      totalStock: stockLevels.quantity,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(stockLevels, and(eq(stockLevels.productId, products.id), eq(stockLevels.warehouseId, warehouseId)))
    .where(and(
      eq(products.isActive, true),
      stockManagedCategoryCondition(),
      or(accentInsensitiveLike(products.name, term), accentInsensitiveLike(products.sku, term), accentInsensitiveLike(products.barcode, term)),
    ))
    .orderBy(asc(products.name))
    .limit(30);
}

export type PurchaseReturnProductRow = Awaited<ReturnType<typeof searchPurchaseReturnProductRows>>[number];
