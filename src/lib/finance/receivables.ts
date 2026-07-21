import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";

export async function getReceivablesSnapshot(database: typeof db = db) {
  const [row] = await database
    .select({
      total: sql<string>`coalesce(sum(${customers.totalSpent}), 0)`,
      paid: sql<string>`coalesce(sum(greatest(${customers.totalSpent} - ${customers.currentDebt}, 0)), 0)`,
      unpaid: sql<string>`coalesce(sum(${customers.currentDebt}), 0)`,
      count: sql<number>`count(*) filter (where ${customers.currentDebt} > 0)::int`,
    })
    .from(customers)
    .where(eq(customers.isActive, true));

  return {
    total: Number(row.total),
    paid: Number(row.paid),
    unpaid: Number(row.unpaid),
    count: row.count,
  };
}
