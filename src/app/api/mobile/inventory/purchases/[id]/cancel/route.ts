import { cancelPurchase } from "@/lib/actions/purchases";
import { requireMobileManager } from "@/lib/mobile/auth";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import { mobileAction, mobileError, mobileGate } from "@/lib/mobile/response";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;
  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  return mobileAction(await cancelPurchase(id));
}
