import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate } from "@/lib/mobile/response";
import { expirePendingPayment } from "@/lib/payments/service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const trimmedId = id?.trim();
  if (!trimmedId) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  return mobileAction(await expirePendingPayment(trimmedId));
}
