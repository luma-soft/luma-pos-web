import { desc } from "drizzle-orm";
import { db } from "@/db";
import { warehouses } from "@/db/schema";
import { StocktakeForm } from "./stocktake-form";

export const dynamic = "force-dynamic";

export default async function NewStocktakePage({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  const { wh } = await searchParams;
  const warehouseRows = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .orderBy(desc(warehouses.isDefault));

  const defaultWh = warehouseRows.find((w) => w.id === wh)?.id ?? warehouseRows[0]?.id;

  return (
    <StocktakeForm
      activeWarehouseId={defaultWh ?? ""}
      warehouses={warehouseRows}
    />
  );
}
