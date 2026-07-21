import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, stockLots, warehouses } from "@/db/schema";
import { summarizeExpiryLots } from "@/lib/inventory/expiry-policy";

function businessDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function getExpiryStockAlerts(warningDays = 30, limit = 50) {
  const safeWarningDays = Math.max(1, Math.min(365, Math.round(warningDays)));
  const safeLimit = Math.max(1, Math.min(200, Math.round(limit)));
  const rows = await db
    .select({
      id: stockLots.id,
      productId: stockLots.productId,
      productName: products.name,
      sku: products.sku,
      warehouseId: stockLots.warehouseId,
      warehouseName: warehouses.name,
      batchNumber: stockLots.batchNumber,
      expiryDate: stockLots.expiryDate,
      availableQuantity: stockLots.availableQuantity,
      baseUnit: products.baseUnit,
      requiresExpiry: sql<boolean>`${products.shelfLifeDays} is not null`,
    })
    .from(stockLots)
    .innerJoin(products, eq(products.id, stockLots.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockLots.warehouseId))
    .where(and(
      gt(stockLots.availableQuantity, "0"),
      eq(products.isActive, true),
      or(
        sql`${stockLots.expiryDate} <= current_date + ${safeWarningDays}::int`,
        and(isNull(stockLots.expiryDate), sql`${products.shelfLifeDays} is not null`),
      ),
    ))
    .orderBy(asc(stockLots.expiryDate), asc(products.name))
    .limit(safeLimit);

  return summarizeExpiryLots(rows, {
    today: businessDate(),
    warningDays: safeWarningDays,
  });
}
