import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate } from "@/lib/mobile/response";
import { queryGatewayPayment, resolveGatewayConfig } from "@/lib/payments/gateway-adapter";
import { paymentRequestIp } from "@/lib/payments/request-ip";
import { refreshGatewayPaymentFromInquiry } from "@/lib/payments/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;
  const { id } = await params;
  return mobileAction(await refreshGatewayPaymentFromInquiry(id, async (payment) => {
    const config = resolveGatewayConfig(payment.provider);
    if (!config) {
      return {
        ok: false,
        error: "payments.errors.providerNotConfigured",
        retryable: false,
      };
    }
    return queryGatewayPayment(config, {
      ...payment,
      ipAddress: paymentRequestIp(request),
    });
  }));
}
