DROP INDEX IF EXISTS "notification_events_mobile_recent_valid_idx";
--> statement-breakpoint
CREATE INDEX "notification_events_mobile_recent_valid_idx"
  ON "notification_events" ("created_at" DESC, "id" DESC)
  INCLUDE ("category", "target", "entity_id", "priority")
  WHERE "contract_version" = 1
    AND "priority" IN ('normal', 'high')
    AND (
      ("category" IN (
        'invoiceCreated',
        'invoiceCancelled',
        'paymentReceived',
        'qrPaymentConfirmed'
      ) AND "target" = 'invoices')
      OR ("category" IN (
        'purchaseReceived',
        'purchaseCancelled'
      ) AND "target" = 'purchases')
      OR ("category" = 'debtChanged' AND "target" = 'debt')
      OR (
        "category" = 'qrPaymentException'
        AND "target" = 'paymentReconciliation'
      )
    );
