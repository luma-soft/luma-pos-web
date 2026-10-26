import { and, desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { products, stockLevels, stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { StocktakeForm, type StocktakeFormLine } from "./stocktake-form";
import { requireStoreContext } from "@/lib/auth/store-context";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";

export const dynamic = "force-dynamic";

export default async function NewStocktakePage({ searchParams }: { searchParams: Promise<{ wh?: string; copy?: string }> }) {
  const context = await requireStoreContext();
  const { wh, copy } = await searchParams;
  const warehouseRows = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.storeId, context.storeId))
    .orderBy(desc(warehouses.isDefault));

  const copyId = copy?.trim();
  if (copyId && !z.string().uuid().safeParse(copyId).success) notFound();

  const [source] = copyId
    ? await db.select({
      id: stocktakes.id,
      code: stocktakes.code,
      note: stocktakes.note,
      warehouseId: stocktakes.warehouseId,
    })
      .from(stocktakes)
      .where(and(eq(stocktakes.storeId, context.storeId), eq(stocktakes.id, copyId)))
      .limit(1)
    : [];
  if (copyId && !source) notFound();

  const copiedRows = source
    ? await db.select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      baseUnit: products.baseUnit,
      costPrice: products.costPrice,
      currentStock: sql<string>`coalesce(${stockLevels.quantity}, 0)`,
      actualQty: stocktakeItems.actualQty,
    })
      .from(stocktakeItems)
      .innerJoin(products, and(
        eq(stocktakeItems.productId, products.id),
        eq(products.storeId, context.storeId),
      ))
      .leftJoin(stockLevels, and(
        eq(stockLevels.storeId, context.storeId),
        eq(stockLevels.productId, products.id),
        eq(stockLevels.warehouseId, source.warehouseId),
      ))
      .where(and(eq(stocktakeItems.storeId, context.storeId), eq(stocktakeItems.stocktakeId, source.id)))
    : [];

  const defaultWh = warehouseRows.find((w) => w.id === source?.warehouseId)?.id
    ?? warehouseRows.find((w) => w.id === wh)?.id
    ?? warehouseRows[0]?.id;
  const initialLines: StocktakeFormLine[] = copiedRows.map((row) => ({
    product: {
      id: row.id,
      sku: row.sku,
      barcode: row.barcode,
      name: row.name,
      baseUnit: row.baseUnit,
      costPrice: canViewPurchasePrices(context.role) ? Number(row.costPrice) : 0,
      stock: Number(row.currentStock),
      categoryName: null,
      imageUrls: null,
    },
    actualQty: Number(row.actualQty),
  }));

  return (
    <StocktakeForm
      activeWarehouseId={defaultWh ?? ""}
      warehouses={warehouseRows}
      initialLines={initialLines}
      initialNote={source?.note ?? ""}
      copyFromCode={source?.code}
    />
  );
}
