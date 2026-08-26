import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";

async function hasProductComplianceColumnsQuery() {
  const rows = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'products'
      and column_name in (
        'vat_rate',
        'price_by_weight',
        'track_batches',
        'shelf_life_days',
        'lifecycle_status'
      )
  `);
  return Number(rows.rows[0]?.count ?? 0) === 5;
}

const cachedHasProductComplianceColumns = unstable_cache(
  hasProductComplianceColumnsQuery,
  ["schema-compat-products-compliance-columns"],
  { revalidate: 30 },
);

export async function hasProductComplianceColumns() {
  try {
    return await cachedHasProductComplianceColumns();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("incrementalCache missing")) {
      return hasProductComplianceColumnsQuery();
    }
    throw error;
  }
}

async function hasProjectRedesignSchemaQuery() {
  const rows = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = current_schema()
      and table_name in (
        'service_job_trade_records',
        'service_job_dependencies',
        'service_coordination_points',
        'service_camera_vaults'
      )
  `);
  const columnRows = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'installed_assets'
      and column_name = 'specs'
  `);
  return Number(rows.rows[0]?.count ?? 0) === 4
    && Number(columnRows.rows[0]?.count ?? 0) === 1;
}

const cachedHasProjectRedesignSchema = unstable_cache(
  hasProjectRedesignSchemaQuery,
  ["schema-compat-project-redesign"],
  { revalidate: 30 },
);

export async function hasProjectRedesignSchema() {
  try {
    return await cachedHasProjectRedesignSchema();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("incrementalCache missing")) {
      return hasProjectRedesignSchemaQuery();
    }
    throw error;
  }
}
