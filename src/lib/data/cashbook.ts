import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { cashTransactions, profiles } from "@/db/schema";
import { coercePageSize } from "@/lib/pagination";

export async function getCashbook(storeId: string, filters: { fund?: string; type?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize, 30);
  const conditions: SQL[] = [eq(cashTransactions.storeId, storeId)];
  if (filters.fund === "cash" || filters.fund === "bank") conditions.push(eq(cashTransactions.fund, filters.fund));
  if (filters.type === "in" || filters.type === "out") conditions.push(eq(cashTransactions.type, filters.type));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }], balances] = await Promise.all([
    db
      .select({
        id: cashTransactions.id,
        code: cashTransactions.code,
        type: cashTransactions.type,
        fund: cashTransactions.fund,
        amount: cashTransactions.amount,
        category: cashTransactions.category,
        refType: cashTransactions.refType,
        refId: cashTransactions.refId,
        note: cashTransactions.note,
        createdAt: cashTransactions.createdAt,
        byName: profiles.fullName,
      })
      .from(cashTransactions)
      .leftJoin(profiles, eq(cashTransactions.createdBy, profiles.id))
      .where(where)
      .orderBy(desc(cashTransactions.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ total: count() }).from(cashTransactions).where(where),
    db
      .select({
        fund: cashTransactions.fund,
        balance: sql<string>`coalesce(sum(case when ${cashTransactions.type} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end), 0)`,
        totalIn: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'in'), 0)`,
        totalOut: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'out'), 0)`,
      })
      .from(cashTransactions)
      .where(eq(cashTransactions.storeId, storeId))
      .groupBy(cashTransactions.fund),
  ]);

  const byFund = Object.fromEntries(balances.map((b) => [b.fund, b]));
  return {
    rows, total, page, pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
    cash: { balance: Number(byFund.cash?.balance ?? 0), in: Number(byFund.cash?.totalIn ?? 0), out: Number(byFund.cash?.totalOut ?? 0) },
    bank: { balance: Number(byFund.bank?.balance ?? 0), in: Number(byFund.bank?.totalIn ?? 0), out: Number(byFund.bank?.totalOut ?? 0) },
  };
}
