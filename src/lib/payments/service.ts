"use server";

import { db } from "@/db";
import { publishCommittedNotification } from "@/lib/notifications/outbox";
import {
  confirmPaymentFromProvider as confirmPaymentFromProviderCore,
  attachGatewayIntent as attachGatewayIntentCore,
  createPendingGatewayPayment as createPendingGatewayPaymentCore,
  createPendingSepayPayment as createPendingSepayPaymentCore,
  expirePendingPayment as expirePendingPaymentCore,
  getPaymentReconciliation as getPaymentReconciliationCore,
  getPaymentReconciliationEvent as getPaymentReconciliationEventCore,
  getGatewayPaymentStatus as getGatewayPaymentStatusCore,
  failGatewayPayment as failGatewayPaymentCore,
  cancelDraftOrder as cancelDraftOrderCore,
  getSepayPaymentStatus as getSepayPaymentStatusCore,
  matchSepayWebhookEvent as matchSepayWebhookEventCore,
  reconcilePaymentWithEvent as reconcilePaymentWithEventCore,
  recordGatewayCallbackAndMatch as recordGatewayCallbackAndMatchCore,
  refreshGatewayPaymentFromInquiry as refreshGatewayPaymentFromInquiryCore,
  recordSepayWebhookEvent as recordSepayWebhookEventCore,
} from "@/lib/payments/service-core";

async function publishNewPaymentNotification<T>(
  result: T,
): Promise<T> {
  const notification = result as {
    ok?: boolean;
    data?: {
      notificationEventId?: string;
      notificationCreated?: boolean;
    };
  };
  if (
    notification.ok
    && notification.data?.notificationCreated
    && notification.data.notificationEventId
  ) {
    try {
      await publishCommittedNotification(notification.data.notificationEventId);
    } catch {
      // The durable outbox will retry; payment/webhook success remains authoritative.
    }
  }
  return result;
}

export async function createPendingSepayPayment(input: Parameters<typeof createPendingSepayPaymentCore>[1]) {
  return createPendingSepayPaymentCore(db, input);
}

export async function createPendingGatewayPayment(input: Parameters<typeof createPendingGatewayPaymentCore>[1]) {
  return createPendingGatewayPaymentCore(db, input);
}

export async function attachGatewayIntent(input: Parameters<typeof attachGatewayIntentCore>[1]) {
  return attachGatewayIntentCore(db, input);
}

export async function getGatewayPaymentStatus(paymentId: string) {
  return getGatewayPaymentStatusCore(db, paymentId);
}

export async function failGatewayPayment(input: Parameters<typeof failGatewayPaymentCore>[1]) {
  return failGatewayPaymentCore(db, input);
}

export async function cancelDraftOrder(orderId: string) {
  return cancelDraftOrderCore(db, orderId);
}

export async function recordGatewayCallbackAndMatch(input: Parameters<typeof recordGatewayCallbackAndMatchCore>[1]) {
  return publishNewPaymentNotification(
    await recordGatewayCallbackAndMatchCore(db, input),
  );
}

export async function refreshGatewayPaymentFromInquiry(
  paymentId: string,
  inquiry: Parameters<typeof refreshGatewayPaymentFromInquiryCore>[2],
  options?: Parameters<typeof refreshGatewayPaymentFromInquiryCore>[3],
) {
  return publishNewPaymentNotification(
    await refreshGatewayPaymentFromInquiryCore(db, paymentId, inquiry, options),
  );
}

export async function confirmPaymentFromProvider(input: Parameters<typeof confirmPaymentFromProviderCore>[1]) {
  return publishNewPaymentNotification(
    await confirmPaymentFromProviderCore(db, input),
  );
}

export async function expirePendingPayment(paymentId: string) {
  return expirePendingPaymentCore(db, paymentId);
}

export async function getSepayPaymentStatus(paymentId: string) {
  return getSepayPaymentStatusCore(db, paymentId);
}

export async function getPaymentReconciliation(
  input?: Parameters<typeof getPaymentReconciliationCore>[1],
) {
  return getPaymentReconciliationCore(db, input);
}

export async function getPaymentReconciliationEvent(eventId: string) {
  return getPaymentReconciliationEventCore(db, eventId);
}

export async function recordSepayWebhookEvent(
  input: Parameters<typeof recordSepayWebhookEventCore>[1],
  options?: Parameters<typeof recordSepayWebhookEventCore>[2],
) {
  return recordSepayWebhookEventCore(db, input, options);
}

export async function reconcilePaymentWithEvent(
  input: Parameters<typeof reconcilePaymentWithEventCore>[1],
) {
  return publishNewPaymentNotification(
    await reconcilePaymentWithEventCore(db, input),
  );
}

export async function matchSepayWebhookEvent(eventId: string) {
  return publishNewPaymentNotification(
    await matchSepayWebhookEventCore(db, eventId),
  );
}
