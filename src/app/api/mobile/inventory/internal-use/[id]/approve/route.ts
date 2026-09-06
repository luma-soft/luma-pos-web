import { approveInternalUse } from "@/lib/actions/internal-use";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate } from "@/lib/mobile/response";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  return mobileAction(await approveInternalUse(id));
}
