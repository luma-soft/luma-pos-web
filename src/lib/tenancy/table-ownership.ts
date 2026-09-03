export type TableOwnershipClass =
  | "global"
  | "tenant-root"
  | "tenant-child"
  | "operational/system";

const GLOBAL_TABLES = [
  "stores",
] as const;

const TENANT_ROOT_TABLES = [
  "profiles",
  "store_features",
  "staff_invitations",
  "categories",
  "brands",
  "price_books",
  "warehouses",
  "products",
  "customers",
  "suppliers",
  "payment_bank_accounts",
  "orders",
  "purchase_orders",
  "purchase_returns",
  "returns",
  "cash_transactions",
  "projects",
  "service_jobs",
  "promotions",
  "trips",
  "stocktakes",
  "print_templates",
  "label_templates",
  "shifts",
  "dining_tables",
  "modifier_groups",
  "store_settings",
  "marketplace_shops",
  "internal_use_issues",
  "media_objects",
] as const;

const TENANT_CHILD_TABLES = [
  "mobile_approvals",
  "product_prices",
  "product_units",
  "product_source_mappings",
  "product_combo_items",
  "product_suppliers",
  "stock_levels",
  "stock_movements",
  "customer_consents",
  "customer_consent_events",
  "order_items",
  "payments",
  "customer_receivable_receipts",
  "customer_receivable_allocations",
  "customer_receivable_entries",
  "purchase_order_items",
  "supplier_payable_receipts",
  "supplier_payable_allocations",
  "supplier_payable_entries",
  "stock_lots",
  "stock_lot_movements",
  "purchase_return_items",
  "return_items",
  "payment_refunds",
  "service_job_materials",
  "service_job_trade_records",
  "service_job_dependencies",
  "service_coordination_points",
  "service_cost_entries",
  "service_material_allocations",
  "service_handover_documents",
  "service_maintenance_plans",
  "installed_assets",
  "service_camera_vaults",
  "service_camera_vault_viewers",
  "warranty_claims",
  "warranty_claim_notifications",
  "service_status_logs",
  "service_job_assignments",
  "service_visits",
  "service_time_entries",
  "service_attachments",
  "service_signatures",
  "service_job_events",
  "service_field_mutations",
  "service_maintenance_occurrences",
  "service_sla_policies",
  "service_customer_requests",
  "service_customer_request_attachments",
  "service_customer_request_storage_cleanup",
  "service_customer_request_notifications",
  "camera_vendor_connections",
  "camera_device_links",
  "camera_health_snapshots",
  "camera_device_alerts",
  "camera_sync_runs",
  "trip_stops",
  "einvoices",
  "stocktake_items",
  "kitchen_tickets",
  "kitchen_ticket_items",
  "marketplace_tokens",
  "marketplace_product_mappings",
  "marketplace_order_mappings",
  "marketplace_message_threads",
  "marketplace_messages",
  "ai_listing_suggestions",
  "internal_use_items",
  "product_media",
  "media_file_metadata",
  "media_library_items",
  "service_handover_document_media",
] as const;

const OPERATIONAL_SYSTEM_TABLES = [
  "audit_logs",
  "ai_chat_sessions",
  "ai_chat_messages",
  "catalog_sync_state",
  "mobile_notification_states",
  "mobile_push_devices",
  "mobile_push_device_binding_fences",
  "mobile_push_deliveries",
  "notification_events",
  "notification_recipients",
  "notification_outbox",
  "mobile_telemetry_events",
  "payment_webhook_events",
  "service_public_rate_limits",
  "ai_usage_counters",
  "ai_usage_events",
  "zalo_message_events",
  "marketplace_sync_jobs",
  "media_migration_runs",
  "media_migration_items",
  "kiotviet_sync_runs",
  "kiotviet_source_mappings",
] as const;

function entries(
  names: readonly string[],
  ownership: TableOwnershipClass,
): Array<[string, TableOwnershipClass]> {
  return names.map((name) => [name, ownership]);
}

/**
 * Security inventory for every Drizzle-managed application table.
 *
 * Phase-specific migrations may add store_id gradually, but no table may be
 * omitted from this inventory. The exhaustiveness test compares these keys to
 * every pgTable declaration in src/db/schema.ts.
 */
export const TABLE_OWNERSHIP = Object.fromEntries([
  ...entries(GLOBAL_TABLES, "global"),
  ...entries(TENANT_ROOT_TABLES, "tenant-root"),
  ...entries(TENANT_CHILD_TABLES, "tenant-child"),
  ...entries(OPERATIONAL_SYSTEM_TABLES, "operational/system"),
]) as Readonly<Record<string, TableOwnershipClass>>;
