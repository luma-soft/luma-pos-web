import { createHash } from "node:crypto";
import { db } from "@/db";
import {
  createGatewayRefund,
  queryGatewayRefund,
  resolveGatewayConfig,
} from "@/lib/payments/gateway-adapter";
import type { GatewayProvider } from "@/lib/payments/gateways";
import {
  claimGatewayRefundInquiry,
  claimGatewayRefundSubmission,
  createPendingGatewayRefund as createPendingGatewayRefundCore,
  getGatewayRefundProviderContext,
  getGatewayRefundStatus,
  recordGatewayRefundResult,
  recordGatewayRefundTransportError,
} from "@/lib/payments/refund-service-core";

export function gatewayRefundReference(
  provider: GatewayProvider,
  clientRequestId: string,
  now = new Date(),
) {
  const digest = createHash("sha256").update(clientRequestId).digest("hex").slice(0, 20).toUpperCase();
  if (provider === "zalopay") {
    const appId = process.env.ZALOPAY_APP_ID?.trim();
    if (!appId) return null;
    const local = new Date(now.getTime() + 7 * 60 * 60_000);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${String(local.getUTCFullYear()).slice(2)}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}_${appId}_${digest}`.slice(0, 45);
  }
  return `RF${provider === "momo" ? "M" : "V"}${digest}`;
}

export async function createPendingGatewayRefund(
  input: Parameters<typeof createPendingGatewayRefundCore>[1],
) {
  return createPendingGatewayRefundCore(db, input);
}

function providerInput(
  context: Awaited<ReturnType<typeof getGatewayRefundProviderContext>> & { ok: true },
  actorId: string,
  ipAddress: string,
) {
  return {
    refundId: context.data.refundId,
    reference: context.data.reference,
    sourceReference: context.data.sourceReference,
    sourceProviderTransactionId: context.data.sourceProviderTransactionId,
    amount: context.data.amount,
    originalAmount: context.data.originalAmount,
    paymentCreatedAt: context.data.paymentCreatedAt,
    actorId,
    ipAddress,
    description: `Refund ${context.data.returnCode}`,
  };
}

export async function submitGatewayRefund(
  refundId: string,
  input: { actorId: string; ipAddress: string },
) {
  const claim = await claimGatewayRefundSubmission(db, refundId);
  if (!claim.ok) return claim;
  if (!claim.data.claimed) return getGatewayRefundStatus(db, refundId);
  const context = await getGatewayRefundProviderContext(db, refundId);
  if (!context.ok) return context;
  const config = resolveGatewayConfig(context.data.provider);
  if (!config) {
    await recordGatewayRefundTransportError(db, refundId, "payments.errors.providerNotConfigured");
    return getGatewayRefundStatus(db, refundId);
  }
  const result = await createGatewayRefund(config, providerInput(context, input.actorId, input.ipAddress));
  if (!result.ok) {
    await recordGatewayRefundTransportError(db, refundId, result.error, result.providerStatus);
  } else {
    await recordGatewayRefundResult(db, {
      refundId,
      reference: result.reference,
      amount: result.amount,
      state: result.state,
      providerRefundTransactionId: result.providerTransactionId,
      providerStatus: result.providerStatus,
      occurredAt: result.occurredAt,
      rawPayload: result.rawPayload,
    });
  }
  return getGatewayRefundStatus(db, refundId);
}

export async function refreshGatewayRefund(
  refundId: string,
  input: { actorId: string; ipAddress: string },
) {
  const claim = await claimGatewayRefundInquiry(db, refundId);
  if (!claim.ok) return claim;
  if (!claim.data.claimed) return getGatewayRefundStatus(db, refundId);
  const context = await getGatewayRefundProviderContext(db, refundId);
  if (!context.ok) return context;
  const config = resolveGatewayConfig(context.data.provider);
  if (!config) {
    await recordGatewayRefundTransportError(db, refundId, "payments.errors.providerNotConfigured");
    return getGatewayRefundStatus(db, refundId);
  }
  const result = await queryGatewayRefund(config, providerInput(context, input.actorId, input.ipAddress));
  if (!result.ok) {
    await recordGatewayRefundTransportError(db, refundId, result.error, result.providerStatus);
  } else {
    await recordGatewayRefundResult(db, {
      refundId,
      reference: result.reference,
      amount: result.amount,
      state: result.state,
      providerRefundTransactionId: result.providerTransactionId,
      providerStatus: result.providerStatus,
      occurredAt: result.occurredAt,
      rawPayload: result.rawPayload,
    });
  }
  return getGatewayRefundStatus(db, refundId);
}
