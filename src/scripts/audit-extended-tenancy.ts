import { readdirSync } from "node:fs";
import postgres from "postgres";
import { CURRENT_STORE_ID } from "@/lib/tenancy/constants";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL not set");

const postMigration = !process.argv.includes("--preflight");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

const extendedTables = [
  "audit_logs", "ai_chat_sessions", "ai_chat_messages", "product_units",
  "customer_consents", "customer_consent_events", "mobile_notification_states",
  "mobile_push_devices", "mobile_push_device_binding_fences", "mobile_push_deliveries",
  "notification_events", "notification_recipients", "notification_outbox",
  "mobile_telemetry_events", "payment_webhook_events", "stock_lot_movements",
  "projects", "service_jobs", "service_job_materials", "service_cost_entries",
  "service_material_allocations", "service_handover_documents",
  "service_maintenance_plans", "installed_assets", "warranty_claims",
  "warranty_claim_notifications", "service_status_logs", "service_job_assignments",
  "service_visits", "service_time_entries", "service_attachments", "service_signatures",
  "service_job_events", "service_field_mutations", "service_maintenance_occurrences",
  "service_sla_policies", "service_customer_requests",
  "service_customer_request_attachments", "service_customer_request_storage_cleanup",
  "service_customer_request_notifications", "service_public_rate_limits",
  "camera_vendor_connections", "camera_device_links", "camera_health_snapshots",
  "camera_device_alerts", "camera_sync_runs", "promotions", "trips", "trip_stops",
  "einvoices", "dining_tables", "modifier_groups", "kitchen_tickets",
  "kitchen_ticket_items", "ai_usage_counters", "ai_usage_events",
  "zalo_message_events", "marketplace_shops", "marketplace_tokens",
  "marketplace_product_mappings", "marketplace_order_mappings",
  "marketplace_message_threads", "marketplace_messages", "marketplace_sync_jobs",
  "ai_listing_suggestions",
] as const;

function assertAudit(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`EXTENDED_TENANCY_AUDIT_FAILED: ${message}`);
}

try {
  const counts: Record<string, number> = {};
  for (const table of extendedTables) {
    const [row] = await sql.unsafe<{ count: number }[]>(
      `select count(*)::int as count from public."${table}"`,
    );
    counts[table] = row.count;
  }

  const result: Record<string, unknown> = {
    mode: postMigration ? "post-migration" : "preflight",
    currentStoreId: CURRENT_STORE_ID,
    counts,
  };

  if (postMigration) {
    const columns = await sql<{ table_name: string; is_nullable: "YES" | "NO" }[]>`
      select table_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and column_name = 'store_id'
        and table_name = any(${extendedTables as unknown as string[]})
    `;
    const owned = new Map(columns.map((row) => [row.table_name, row.is_nullable]));
    const missing = extendedTables.filter((table) => !owned.has(table));
    const nullable = extendedTables.filter((table) => owned.get(table) !== "NO");
    assertAudit(missing.length === 0, `missing store_id: ${missing.join(", ")}`);
    assertAudit(nullable.length === 0, `nullable store_id: ${nullable.join(", ")}`);

    const nullOrWrong: Record<string, number> = {};
    for (const table of extendedTables) {
      const [row] = await sql.unsafe<{ count: number }[]>(
        `select count(*)::int as count from public."${table}" where store_id is null or store_id <> $1::uuid`,
        [CURRENT_STORE_ID],
      );
      nullOrWrong[table] = row.count;
    }
    assertAudit(
      Object.values(nullOrWrong).every((count) => count === 0),
      "extended rows are missing or outside the deterministic current store",
    );

    const migrationFiles = readdirSync("drizzle").filter((name) => name.endsWith(".sql")).sort();
    const applied = await sql<{ name: string }[]>`select name from _migrations`;
    const appliedNames = new Set(applied.map((row) => row.name));
    const pendingMigrations = migrationFiles.filter((name) => !appliedNames.has(name));
    assertAudit(appliedNames.has("0103_extended_tenant_isolation.sql"), "0103 migration is not tracked as applied");
    assertAudit(pendingMigrations.length === 0, `pending migrations: ${pendingMigrations.join(", ")}`);

    result.nullOrWrongStoreRows = nullOrWrong;
    result.pendingMigrations = pendingMigrations;
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
