import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getProfileId } from "@/lib/actions/common";
import { createGatewayIntent, resolveGatewayConfig } from "@/lib/payments/gateway-adapter";
import { paymentRequestIp } from "@/lib/payments/request-ip";
import type { GatewayProvider } from "@/lib/payments/gateways";
import {
  attachGatewayIntent,
  cancelDraftOrder,
  createPendingGatewayPayment,
  failGatewayPayment,
  getGatewayPaymentStatus,
} from "@/lib/payments/service";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

function gatewayReference(provider: GatewayProvider, clientRequestId: string) {
  const digest = createHash("sha256").update(clientRequestId).digest("hex").slice(0, 20).toUpperCase();
  if (provider === "zalopay") {
    const now = new Date(Date.now() + 7 * 60 * 60_000);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${String(now.getUTCFullYear()).slice(2)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_L${digest}`;
  }
  return provider === "vnpay" ? `LUMAV${digest}` : `LUMA-M-${digest}`;
}

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileError("errors.invalidData");
  const input = body as Record<string, unknown>;
  const provider = input.provider;
  const orderId = typeof input.orderId === "string" ? input.orderId : "";
  const clientRequestId = typeof input.clientRequestId === "string" ? input.clientRequestId.trim() : "";
  const amount = Number(input.amount);
  if (
    !["momo", "zalopay", "vnpay"].includes(String(provider)) ||
    !orderId ||
    clientRequestId.length < 8 ||
    clientRequestId.length > 80 ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    return mobileError("errors.invalidData");
  }
  const typedProvider = provider as GatewayProvider;
  const config = resolveGatewayConfig(typedProvider);
  if (!config) {
    await cancelDraftOrder(orderId);
    return mobileError("payments.errors.providerNotConfigured", 409);
  }

  const [order] = await db
    .select({ code: orders.code })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return mobileError("errors.invalidData");
  const profileId = await getProfileId(gate.userId);
  const pending = await createPendingGatewayPayment({
    orderId,
    provider: typedProvider,
    amount,
    reference: gatewayReference(typedProvider, clientRequestId),
    clientRequestId,
    createdBy: profileId ?? gate.userId,
  });
  if (!pending.ok) return mobileError(pending.error);

  if (pending.data.existing) {
    const current = await getGatewayPaymentStatus(pending.data.id);
    if (current.ok && current.data.checkoutUrl) return mobileOk(current.data);
    if (current.ok && current.data.status !== "pending") {
      return mobileError("payments.errors.notConfirmable", 409);
    }
  }

  const intent = await createGatewayIntent(config, {
    paymentId: pending.data.id,
    reference: pending.data.reference,
    orderCode: order.code,
    amount,
    actorId: profileId ?? gate.userId,
    ipAddress: paymentRequestIp(request),
  });
  if (!intent.ok) {
    if (intent.retryable) {
      await attachGatewayIntent({
        paymentId: pending.data.id,
        providerStatus: intent.providerStatus,
        providerError: intent.error,
      });
    } else {
      await failGatewayPayment({
        paymentId: pending.data.id,
        providerStatus: intent.providerStatus,
        providerError: intent.error,
      });
    }
    return mobileError(intent.error, intent.retryable ? 503 : 422);
  }

  const attached = await attachGatewayIntent({
    paymentId: pending.data.id,
    checkoutUrl: intent.checkoutUrl,
    deepLink: intent.deepLink,
    qrPayload: intent.qrPayload,
    expiresAt: intent.expiresAt,
    providerStatus: intent.providerStatus,
  });
  if (!attached.ok) return mobileError(attached.error);
  const status = await getGatewayPaymentStatus(pending.data.id);
  return status.ok ? mobileOk(status.data) : mobileError(status.error);
}
