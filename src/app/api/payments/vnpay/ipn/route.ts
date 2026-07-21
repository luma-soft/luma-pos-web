import { createHash } from "node:crypto";
import { resolveGatewayConfig } from "@/lib/payments/gateway-adapter";
import { verifyVnpayIpn } from "@/lib/payments/gateways";
import { recordGatewayCallbackAndMatch } from "@/lib/payments/service";

export async function GET(request: Request) {
  const config = resolveGatewayConfig("vnpay");
  if (!config || config.provider !== "vnpay") {
    return Response.json({ RspCode: "99", Message: "Not configured" }, { status: 503 });
  }
  const payload = Object.fromEntries(new URL(request.url).searchParams.entries());
  const verified = verifyVnpayIpn(payload, config.hashSecret);
  if (!verified.valid || payload.vnp_TmnCode !== config.tmnCode) {
    return Response.json({ RspCode: "97", Message: "Invalid signature" });
  }
  const fallbackId = createHash("sha256").update(new URL(request.url).search).digest("hex");
  const result = await recordGatewayCallbackAndMatch({
    provider: "vnpay",
    providerEventId: `${verified.providerTransactionId ?? fallbackId}:${payload.vnp_ResponseCode ?? ""}`,
    reference: verified.reference,
    amount: verified.amount,
    providerTransactionId: verified.providerTransactionId,
    successful: verified.successful,
    occurredAt: verified.occurredAt,
    rawPayload: payload,
  });
  if (!result.ok) return Response.json({ RspCode: "99", Message: result.error });
  if (result.data.reason === "pending_payment_not_found") {
    return Response.json({ RspCode: "01", Message: "Order not found" });
  }
  if (result.data.reason === "amount_mismatch") {
    return Response.json({ RspCode: "04", Message: "Invalid amount" });
  }
  return Response.json({ RspCode: "00", Message: "Confirm Success" });
}
