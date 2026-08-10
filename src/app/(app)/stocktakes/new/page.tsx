import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { warehouses } from "@/db/schema";
import { StocktakeForm } from "./stocktake-form";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

export default async function NewStocktakePage({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  const context = await requireStoreContext();
  const { wh } = await searchParams;
  const warehouseRows = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.storeId, context.storeId))
    .orderBy(desc(warehouses.isDefault));

  const defaultWh = warehouseRows.find((w) => w.id === wh)?.id ?? warehouseRows[0]?.id;

  return (
    <StocktakeForm
      activeWarehouseId={defaultWh ?? ""}
      warehouses={warehouseRows}
    />
  );
}
