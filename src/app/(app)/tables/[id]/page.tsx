import { notFound, redirect } from "next/navigation";
import { getStoreSettings } from "@/lib/data/settings";
import { getTable } from "@/lib/data/tables";
import { getActiveModifierGroups } from "@/lib/data/modifiers";
import { TableOrder } from "./table-order";

export const dynamic = "force-dynamic";
const FNB = new Set(["restaurant", "cafe"]);

export default async function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const store = await getStoreSettings();
  if (!FNB.has(store.industry)) redirect("/dashboard");
  const { id } = await params;
  const [table, modifierGroups] = await Promise.all([getTable(id), getActiveModifierGroups()]);
  if (!table) notFound();
  return <TableOrder id={table.id} name={table.name} initialCart={table.cart} modifierGroups={modifierGroups} />;
}
