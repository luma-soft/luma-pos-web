-- Repair-cycle-2 hardening is additive and repeatable. The store settings
-- singleton remains owned by the server-side database role; Data API roles
-- receive no direct table access.
DO $$
BEGIN
  IF to_regclass('public.store_settings') IS NOT NULL THEN
    ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.store_settings FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.store_settings FROM authenticated';
    END IF;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "notification_events"
  ADD COLUMN IF NOT EXISTS "contract_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "mobile_push_devices"
  ADD COLUMN IF NOT EXISTS "binding_generation" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "mobile_push_devices"
  ADD COLUMN IF NOT EXISTS "send_lease_id" uuid;
--> statement-breakpoint
ALTER TABLE "mobile_push_devices"
  ADD COLUMN IF NOT EXISTS "send_lease_generation" bigint;
--> statement-breakpoint
ALTER TABLE "mobile_push_devices"
  ADD COLUMN IF NOT EXISTS "send_lease_expires_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_events_mobile_recent_valid_idx"
  ON "notification_events" ("created_at" DESC, "id" DESC)
  INCLUDE ("category", "target", "entity_id", "priority")
  WHERE "contract_version" = 1
    AND "priority" IN ('normal', 'high')
    AND (
      ("category" = 'invoiceCreated' AND "target" = 'invoices')
      OR ("category" = 'purchaseReceived' AND "target" = 'purchases')
      OR ("category" = 'debtChanged' AND "target" = 'debt')
      OR ("category" = 'qrPaymentConfirmed' AND "target" = 'invoices')
      OR (
        "category" = 'qrPaymentException'
        AND "target" = 'paymentReconciliation'
      )
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_recipients_event_user_visible_idx"
  ON "notification_recipients" ("event_id", "user_id")
  WHERE "dismissed_at" IS NULL;
