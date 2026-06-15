import { redirect } from "next/navigation";
import { getStoreSettings } from "@/lib/data/settings";
import { getTables } from "@/lib/data/tables";
import { requireUser, getRole } from "@/lib/actions/common";
import { TablesFloor } from "./tables-floor";

export const dynamic = "force-dynamic";

const FNB = new Set(["restaurant", "cafe"]);

export default async function TablesPage() {
  const store = await getStoreSettings();
  if (!FNB.has(store.industry)) redirect("/dashboard");
  let canManage = false;
  try { const r = await getRole((await requireUser()).id); canManage = r === "owner" || r === "manager"; } catch { /* layout */ }
  const tables = await getTables();
  return <TablesFloor tables={tables} canManage={canManage} />;
}
