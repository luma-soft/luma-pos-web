import { getServiceDashboard } from "@/lib/data/services";
import { requireMobileServiceSalesAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileServiceSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;
  return mobileOk(await getServiceDashboard(gate.storeId));
}
