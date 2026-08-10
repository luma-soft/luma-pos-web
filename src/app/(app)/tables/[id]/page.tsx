import { notFound, redirect } from "next/navigation";
import { getStoreSettings } from "@/lib/data/settings";
import { getTable, getTables } from "@/lib/data/tables";
import { getActiveModifierGroups } from "@/lib/data/modifiers";
import { eligibleTableMoveTargets } from "@/lib/tables/move-table-order";
import { TableOrder } from "./table-order";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";
const FNB = new Set(["restaurant", "cafe"]);

export default async function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireStoreContext();
  const store = await getStoreSettings(context.storeId);
  if (!FNB.has(store.industry)) redirect("/dashboard");
  const { id } = await params;
  const [table, tables, modifierGroups] = await Promise.all([
    getTable(context.storeId, id),
    getTables(context.storeId),
    getActiveModifierGroups(context.storeId),
  ]);
  if (!table) notFound();
  const moveTargets = eligibleTableMoveTargets(table.id, tables);
  return (
    <TableOrder
      id={table.id}
      name={table.name}
      initialCart={table.cart}
      modifierGroups={modifierGroups}
      moveTargets={moveTargets}
    />
  );
}
