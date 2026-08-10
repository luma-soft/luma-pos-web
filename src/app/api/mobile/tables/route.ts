import { getTables } from "@/lib/data/tables";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;

  return mobileOk(await getTables(gate.storeId));
}
