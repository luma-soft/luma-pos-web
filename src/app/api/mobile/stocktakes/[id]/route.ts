import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, profiles, stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { requireMobileStockReadAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return mobileError("errors.invalidData", 400);
  }

  const [stocktake] = await db
    .select({
      id: stocktakes.id,
      code: stocktakes.code,
      status: stocktakes.status,
      note: stocktakes.note,
      createdAt: stocktakes.createdAt,
      balancedAt: stocktakes.balancedAt,
      warehouseId: stocktakes.warehouseId,
      warehouseName: warehouses.name,
      byName: profiles.fullName,
    })
    .from(stocktakes)
    .innerJoin(warehouses, and(
      eq(stocktakes.warehouseId, warehouses.id),
      eq(warehouses.storeId, gate.storeId),
    ))
    .leftJoin(profiles, and(
      eq(stocktakes.createdBy, profiles.id),
      eq(profiles.storeId, gate.storeId),
    ))
    .where(and(eq(stocktakes.storeId, gate.storeId), eq(stocktakes.id, id)))
    .limit(1);

  if (!stocktake) return mobileError("errors.notFound", 404);

  const canViewValues = canViewPurchasePrices(gate.role);
  const items = await db
    .select({
      id: stocktakeItems.id,
      productId: stocktakeItems.productId,
      productName: products.name,
      sku: products.sku,
      baseUnit: products.baseUnit,
      costPrice: canViewValues ? products.costPrice : sql<string | null>`null`,
      systemQty: stocktakeItems.systemQty,
      actualQty: stocktakeItems.actualQty,
    })
    .from(stocktakeItems)
    .innerJoin(products, and(
      eq(stocktakeItems.productId, products.id),
      eq(products.storeId, gate.storeId),
    ))
    .where(and(
      eq(stocktakeItems.storeId, gate.storeId),
      eq(stocktakeItems.stocktakeId, id),
    ))
    .orderBy(asc(products.name), asc(products.sku));

  return mobileOk({ ...stocktake, canViewValues, items });
}
