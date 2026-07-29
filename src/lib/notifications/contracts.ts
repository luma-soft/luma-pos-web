export const notificationCategories = [
  "invoiceCreated",
  "purchaseReceived",
  "debtChanged",
  "qrPaymentConfirmed",
  "qrPaymentException",
] as const;

export type NotificationCategory = (typeof notificationCategories)[number];

export const notificationTargets = [
  "invoices",
  "purchases",
  "debt",
  "paymentReconciliation",
] as const;

export type NotificationTarget = (typeof notificationTargets)[number];
export type NotificationPriority = "normal" | "high";
export type QuietHoursPolicy = "defer" | "bypass";

export type NotificationQueueMessageV1 = {
  version: 1;
  eventId: string;
  deduplicationKey: string;
  queuedAt: string;
};

export interface NotificationQueuePublisher {
  publish(
    message: NotificationQueueMessageV1,
  ): Promise<{ providerMessageId: string }>;
}

export interface NotificationQueueRequestVerifier {
  verify(request: Request): Promise<NotificationQueueMessageV1>;
}

export class NotificationQueueVerificationError extends Error {
  constructor(
    readonly reason: "invalid_signature" | "invalid_message",
  ) {
    super(reason);
  }
}
