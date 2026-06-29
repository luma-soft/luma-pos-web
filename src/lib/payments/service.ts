"use server";

import { db } from "@/db";
import { requireManager } from "@/lib/actions/common";
import {
  confirmPaymentFromProvider as confirmPaymentFromProviderCore,
  createPendingSepayPayment as createPendingSepayPaymentCore,
  expirePendingPayment as expirePendingPaymentCore,
  manualConfirmPaymentCore,
  matchSepayWebhookEvent as matchSepayWebhookEventCore,
} from "@/lib/payments/service-core";

export async function createPendingSepayPayment(input: Parameters<typeof createPendingSepayPaymentCore>[1]) {
  return createPendingSepayPaymentCore(db, input);
}

export async function confirmPaymentFromProvider(input: Parameters<typeof confirmPaymentFromProviderCore>[1]) {
  return confirmPaymentFromProviderCore(db, input);
}

export async function expirePendingPayment(paymentId: string) {
  return expirePendingPaymentCore(db, paymentId);
}

export async function manualConfirmPayment(paymentId: string) {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  return manualConfirmPaymentCore(db, paymentId);
}

export async function matchSepayWebhookEvent(eventId: string) {
  return matchSepayWebhookEventCore(db, eventId);
}
