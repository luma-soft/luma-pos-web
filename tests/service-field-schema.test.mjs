import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const client = new PGlite();
await client.exec("create role anon; create role authenticated;");

for (const file of readdirSync(`${projectRoot}/drizzle`)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const statements = readFileSync(`${projectRoot}/drizzle/${file}`, "utf8")
    .split("--> statement-breakpoint");
  for (const statement of statements) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const requiredTables = [
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
  "camera_vendor_connections",
  "camera_device_links",
  "camera_health_snapshots",
  "camera_device_alerts",
  "camera_sync_runs",
];

const requiredSchemaExports = [
  "serviceJobAssignments",
  "serviceVisits",
  "serviceTimeEntries",
  "serviceAttachments",
  "serviceSignatures",
  "serviceJobEvents",
  "serviceFieldMutations",
  "serviceMaintenanceOccurrences",
  "serviceSlaPolicies",
  "serviceCustomerRequests",
  "cameraVendorConnections",
  "cameraDeviceLinks",
  "cameraHealthSnapshots",
  "cameraDeviceAlerts",
  "cameraSyncRuns",
];
for (const exportName of requiredSchemaExports) {
  if (!schema[exportName]) throw new Error(`missing Drizzle schema export: ${exportName}`);
}

const tableRows = await client.query(`
  select tablename, rowsecurity
  from pg_tables
  where schemaname = 'public' and tablename = any($1)
`, [requiredTables]);

if (tableRows.rows.length !== requiredTables.length) {
  const found = new Set(tableRows.rows.map((row) => row.tablename));
  throw new Error(`missing field-service tables: ${requiredTables.filter((name) => !found.has(name)).join(", ")}`);
}
if (tableRows.rows.some((row) => row.rowsecurity !== true)) {
  throw new Error("every field-service operation table must have RLS enabled");
}

const roleRows = await client.query(`
  select enumlabel
  from pg_enum
  join pg_type on pg_type.oid = pg_enum.enumtypid
  where pg_type.typname = 'user_role'
`);
if (!roleRows.rows.some((row) => row.enumlabel === "technician")) {
  throw new Error("user_role does not include technician");
}

const uniqueRows = await client.query(`
  select indexname
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'service_job_assignments_job_profile_idx',
      'service_field_mutations_client_idx',
      'service_maintenance_occurrences_plan_due_idx',
      'service_visits_job_profile_active_idx',
      'service_time_entries_visit_open_idx'
    )
`);
if (uniqueRows.rows.length !== 5) {
  throw new Error("field-service idempotency constraints are incomplete");
}

console.log("field service schema: operational tables, RLS, role, and idempotency constraints verified");
