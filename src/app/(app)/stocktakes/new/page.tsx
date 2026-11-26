import { notFound } from "next/navigation";
import { z } from "zod";
import { getNewStocktakeData } from "@/lib/data/stocktakes";
import { StocktakeForm, type StocktakeFormLine } from "./stocktake-form";
import { requireStoreContext } from "@/lib/auth/store-context";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";

export const dynamic = "force-dynamic";

export default async function NewStocktakePage({ searchParams }: { searchParams: Promise<{ wh?: string; copy?: string }> }) {
  const context = await requireStoreContext();
  const { wh, copy } = await searchParams;
  const copyId = copy?.trim();
  if (copyId && !z.string().uuid().safeParse(copyId).success) notFound();
  const data = await getNewStocktakeData(context.storeId, copyId || undefined);
  if (!data) notFound();
  const { warehouseRows, source, copiedRows } = data;

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
