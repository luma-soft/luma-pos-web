import { createExchangeForUser, createReturnForUser } from "@/lib/actions/returns";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, readJson } from "@/lib/mobile/response";
import { paymentRequestIp } from "@/lib/payments/request-ip";
import { submitGatewayRefund } from "@/lib/payments/refund-service";

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate);

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const orderId = "orderId" in body ? String(body.orderId).trim() : "";
  if (!orderId) return mobileError("errors.invalidData");
  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "refund.create",
    scope: `return:${orderId}`,
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  const result = "exchangeItems" in body
    ? await createExchangeForUser(
        gate.userId,
        body as Parameters<typeof createExchangeForUser>[1],
      )
    : await createReturnForUser(
        gate.userId,
        body as Parameters<typeof createReturnForUser>[1],
      );
  if (!result.ok) return mobileAction({ ok: false, error: result.error });
  if (!result.data.gatewayRefundId) {
    return mobileAction({ ok: true, data: result.data });
  }
  const gatewayRefund = await submitGatewayRefund(result.data.gatewayRefundId, {
    actorId: gate.userId,
    ipAddress: paymentRequestIp(request),
  });
  return mobileAction({
    ok: true,
    data: {
      ...result.data,
      gatewayRefund: gatewayRefund.ok
        ? gatewayRefund.data
        : { id: result.data.gatewayRefundId, status: "pending", error: gatewayRefund.error },
    },
  });
}
