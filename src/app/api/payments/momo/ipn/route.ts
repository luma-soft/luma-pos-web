import { createHash } from "node:crypto";
import { resolveGatewayConfig } from "@/lib/payments/gateway-adapter";
import { verifyMomoIpn } from "@/lib/payments/gateways";
import { recordGatewayCallbackAndMatch } from "@/lib/payments/service";

export async function POST(request: Request) {
  const config = resolveGatewayConfig("momo");
  if (!config || config.provider !== "momo") return Response.json({ message: "not configured" }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ message: "invalid json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ message: "invalid body" }, { status: 400 });
  const payload = body as Record<string, unknown>;
  const verified = verifyMomoIpn(payload, config);
  if (!verified.valid || payload.partnerCode !== config.partnerCode) {
    return Response.json({ message: "invalid signature" }, { status: 400 });
  }
  const fallbackId = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const eventId = `${verified.providerTransactionId ?? verified.reference ?? "momo"}:${String(payload.responseTime ?? fallbackId)}:${String(payload.resultCode ?? "")}`;
  const result = await recordGatewayCallbackAndMatch({
    provider: "momo",
    providerEventId: eventId,
    reference: verified.reference,
    amount: verified.amount,
    providerTransactionId: verified.providerTransactionId,
    successful: verified.successful,
    occurredAt: verified.occurredAt,
    rawPayload: payload,
  });
  return result.ok
    ? new Response(null, { status: 204 })
    : Response.json({ message: result.error }, { status: 500 });
}
