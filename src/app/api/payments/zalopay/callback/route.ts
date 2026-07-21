import { createHash } from "node:crypto";
import { resolveGatewayConfig } from "@/lib/payments/gateway-adapter";
import { verifyZaloPayCallback } from "@/lib/payments/gateways";
import { recordGatewayCallbackAndMatch } from "@/lib/payments/service";

export async function POST(request: Request) {
  const config = resolveGatewayConfig("zalopay");
  if (!config || config.provider !== "zalopay") {
    return Response.json({ return_code: 0, return_message: "not configured" }, { status: 503 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ return_code: -1, return_message: "invalid json" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ return_code: -1, return_message: "invalid body" });
  }
  const payload = body as Record<string, unknown>;
  const verified = verifyZaloPayCallback(payload, config.key2);
  if (!verified.valid) return Response.json({ return_code: -1, return_message: "invalid mac" });
  const fallbackId = createHash("sha256").update(String(payload.data ?? "")).digest("hex");
  const result = await recordGatewayCallbackAndMatch({
    provider: "zalopay",
    providerEventId: verified.providerTransactionId ?? fallbackId,
    reference: verified.reference,
    amount: verified.amount,
    providerTransactionId: verified.providerTransactionId,
    successful: verified.successful,
    occurredAt: verified.occurredAt,
    rawPayload: payload,
  });
  return result.ok
    ? Response.json({ return_code: 1, return_message: "success" })
    : Response.json({ return_code: 0, return_message: result.error });
}
