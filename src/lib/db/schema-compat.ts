import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const hasProductComplianceColumns = unstable_cache(
  async () => {
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
  },
  ["schema-compat-products-compliance-columns"],
  { revalidate: 30 },
);
