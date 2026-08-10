DO $$
DECLARE owned_table text;
BEGIN
  FOREACH owned_table IN ARRAY ARRAY[
    'audit_logs', 'ai_chat_sessions', 'ai_chat_messages',
    'product_units', 'customer_consents', 'customer_consent_events',
    'mobile_notification_states', 'mobile_push_devices',
    'mobile_push_device_binding_fences', 'mobile_push_deliveries',
    'notification_events', 'notification_recipients', 'notification_outbox',
    'mobile_telemetry_events', 'payment_webhook_events', 'stock_lot_movements',
    'projects', 'service_jobs', 'service_job_materials', 'service_cost_entries',
    'service_material_allocations', 'service_handover_documents',
    'service_maintenance_plans', 'installed_assets', 'warranty_claims',
    'warranty_claim_notifications', 'service_status_logs',
    'service_job_assignments', 'service_visits', 'service_time_entries',
    'service_attachments', 'service_signatures', 'service_job_events',
    'service_field_mutations', 'service_maintenance_occurrences',
    'service_sla_policies', 'service_customer_requests',
    'service_customer_request_attachments',
    'service_customer_request_storage_cleanup',
    'service_customer_request_notifications', 'service_public_rate_limits',
    'camera_vendor_connections', 'camera_device_links',
    'camera_health_snapshots', 'camera_device_alerts', 'camera_sync_runs',
    'promotions', 'trips', 'trip_stops', 'einvoices', 'dining_tables',
    'modifier_groups', 'kitchen_tickets', 'kitchen_ticket_items',
    'ai_usage_counters', 'ai_usage_events', 'zalo_message_events',
    'marketplace_shops', 'marketplace_tokens',
    'marketplace_product_mappings', 'marketplace_order_mappings',
    'marketplace_message_threads', 'marketplace_messages',
    'marketplace_sync_jobs', 'ai_listing_suggestions'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id)',
      owned_table
    );
    EXECUTE format(
      'UPDATE public.%I SET store_id = %L WHERE store_id IS NULL',
      owned_table,
      '00000000-0000-4000-8000-000000000001'
    );
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN store_id SET DEFAULT %L::uuid',
      owned_table,
      '00000000-0000-4000-8000-000000000001'
    );
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN store_id SET NOT NULL',
      owned_table
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (store_id)',
      owned_table || '_store_idx',
      owned_table
    );
  END LOOP;
END
$$;
--> statement-breakpoint
DO $$
DECLARE owned_table text;
BEGIN
  FOREACH owned_table IN ARRAY ARRAY[
    'audit_logs', 'ai_chat_sessions', 'ai_chat_messages',
    'product_units', 'customer_consents', 'customer_consent_events',
    'mobile_notification_states', 'mobile_push_devices',
    'mobile_push_deliveries', 'notification_events', 'notification_recipients',
    'notification_outbox', 'mobile_telemetry_events', 'payment_webhook_events',
    'stock_lot_movements', 'projects', 'service_jobs', 'service_job_materials',
    'service_cost_entries', 'service_material_allocations',
    'service_handover_documents', 'service_maintenance_plans', 'installed_assets',
    'warranty_claims', 'warranty_claim_notifications', 'service_status_logs',
    'service_job_assignments', 'service_visits', 'service_time_entries',
    'service_attachments', 'service_signatures', 'service_job_events',
    'service_field_mutations', 'service_maintenance_occurrences',
    'service_sla_policies', 'service_customer_requests',
    'service_customer_request_attachments',
    'service_customer_request_storage_cleanup',
    'service_customer_request_notifications', 'service_public_rate_limits',
    'camera_vendor_connections', 'camera_device_links',
    'camera_health_snapshots', 'camera_device_alerts', 'camera_sync_runs',
    'promotions', 'trips', 'trip_stops', 'einvoices', 'dining_tables',
    'modifier_groups', 'kitchen_tickets', 'kitchen_ticket_items',
    'ai_usage_events', 'zalo_message_events', 'marketplace_shops',
    'marketplace_tokens', 'marketplace_product_mappings',
    'marketplace_order_mappings', 'marketplace_message_threads',
    'marketplace_messages', 'marketplace_sync_jobs', 'ai_listing_suggestions'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = owned_table
        AND column_name = 'id'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = owned_table || '_store_id_id_unique'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (store_id, id)',
        owned_table,
        owned_table || '_store_id_id_unique'
      );
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE "service_jobs" DROP CONSTRAINT IF EXISTS "service_jobs_code_unique";
ALTER TABLE "trips" DROP CONSTRAINT IF EXISTS "trips_code_unique";
ALTER TABLE "notification_events" DROP CONSTRAINT IF EXISTS "notification_events_event_key_unique";
ALTER TABLE "ai_usage_counters" DROP CONSTRAINT IF EXISTS "ai_usage_counters_pkey";
DROP INDEX IF EXISTS "marketplace_shops_provider_shop_idx";
DROP INDEX IF EXISTS "marketplace_product_mappings_provider_product_idx";
DROP INDEX IF EXISTS "marketplace_product_mappings_external_idx";
DROP INDEX IF EXISTS "marketplace_order_mappings_provider_order_idx";
DROP INDEX IF EXISTS "marketplace_message_threads_provider_thread_idx";
DROP INDEX IF EXISTS "marketplace_sync_jobs_idempotency_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_jobs_store_code_unique"
  ON "service_jobs" ("store_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "trips_store_code_unique"
  ON "trips" ("store_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "notification_events_store_event_key_unique"
  ON "notification_events" ("store_id", "event_key");
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_shops_store_provider_shop_idx"
  ON "marketplace_shops" ("store_id", "provider", "shop_id");
ALTER TABLE "ai_usage_counters"
  ADD CONSTRAINT "ai_usage_counters_store_period_pk" PRIMARY KEY ("store_id", "period");
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_product_mappings_store_product_idx"
  ON "marketplace_product_mappings" ("store_id", "provider", "product_id");
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_product_mappings_store_external_idx"
  ON "marketplace_product_mappings" ("store_id", "provider", "external_item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_order_mappings_store_order_idx"
  ON "marketplace_order_mappings" ("store_id", "provider", "external_order_sn");
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_message_threads_store_thread_idx"
  ON "marketplace_message_threads" ("store_id", "provider", "external_thread_id");
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_sync_jobs_store_idempotency_idx"
  ON "marketplace_sync_jobs" ("store_id", "provider", "idempotency_key");
