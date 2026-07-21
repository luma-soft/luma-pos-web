import { sendToKitchenForUser } from "@/lib/actions/tables";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate } from "@/lib/mobile/response";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  return mobileAction(await sendToKitchenForUser(gate.userId, id));
}
