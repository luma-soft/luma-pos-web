import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate } from "@/lib/mobile/response";
import { paymentRequestIp } from "@/lib/payments/request-ip";
import { refreshGatewayRefund } from "@/lib/payments/refund-service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;
  const { id } = await params;
  return mobileAction(await refreshGatewayRefund(id, {
    actorId: gate.userId,
    ipAddress: paymentRequestIp(request),
  }));
}
