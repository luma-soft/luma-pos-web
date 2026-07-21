import { sql } from "drizzle-orm";
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
  return Number(rows[0]?.count ?? 0) === 5;
}

const cachedHasProductComplianceColumns = (() => {
  try {
    const { unstable_cache } = require("next/cache") as typeof import("next/cache");
    return unstable_cache(
      hasProductComplianceColumnsQuery,
      ["schema-compat-products-compliance-columns"],
      { revalidate: 30 },
    );
  } catch {
    return hasProductComplianceColumnsQuery;
  }
})();

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
