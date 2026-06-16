import { redirect } from "next/navigation";
import { requireUser, getRole } from "@/lib/actions/common";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  let role = "cashier";
  try { role = await getRole((await requireUser()).id); } catch { redirect("/login"); }
  if (!["owner", "manager", "warehouse"].includes(role)) redirect("/settings");
  return <ImportClient />;
}
