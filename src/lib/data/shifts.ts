import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { cashTransactions, orders, payments, profiles, shifts } from "@/db/schema";

export type Shift = typeof shifts.$inferSelect;

/** Ca đang mở của user (hoặc null). */
export async function getCurrentShift(profileId: string): Promise<Shift | null> {
  const [row] = await db.select().from(shifts)
    .where(and(eq(shifts.userId, profileId), eq(shifts.status, "open")))
    .orderBy(desc(shifts.openedAt)).limit(1);
  return row ?? null;
}

/** Tiền mặt dự kiến = quỹ đầu ca + (thu − chi) quỹ tiền mặt thuộc ca. */
export async function shiftExpectedCash(opening: number, shiftId: string): Promise<number> {
  const [agg] = await db
    .select({ net: sql<string>`coalesce(sum(case when ${cashTransactions.type} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end), 0)` })
    .from(cashTransactions)
    .where(and(eq(cashTransactions.shiftId, shiftId), eq(cashTransactions.fund, "cash")));
  return opening + Number(agg.net);
}

export async function getShiftSummary(shift: Shift | null) {
  if (!shift) {
    return {
      expectedCash: null,
      tenderTotals: { cash: 0, bank_transfer: 0, card: 0 },
      orderCount: 0,
      refundTotal: 0,
      cashIn: 0,
      cashOut: 0,
      zReportStatus: "not_available" as const,
    };
  }

  const [expectedCash, tenderRows, orderRows, cashRows] = await Promise.all([
    shiftExpectedCash(Number(shift.openingFloat), shift.id),
    db
      .select({
        method: payments.method,
        total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
      })
      .from(payments)
      .where(and(eq(payments.shiftId, shift.id), notInArray(payments.status, ["pending", "expired"])))
      .groupBy(payments.method),
    db
      .select({
        orderCount: sql<string>`count(distinct ${orders.id})`,
      })
      .from(orders)
      .where(eq(orders.shiftId, shift.id)),
    db
      .select({
        cashIn: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'in' and ${cashTransactions.fund} = 'cash'), 0)`,
        cashOut: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'out' and ${cashTransactions.fund} = 'cash'), 0)`,
        refundTotal: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.category} = 'refund'), 0)`,
      })
      .from(cashTransactions)
      .where(eq(cashTransactions.shiftId, shift.id)),
  ]);

  const tenderTotals = { cash: 0, bank_transfer: 0, card: 0 };
  for (const row of tenderRows) {
    if (row.method === "cash" || row.method === "bank_transfer" || row.method === "card") {
      tenderTotals[row.method] = Number(row.total);
    }
  }

  return {
    expectedCash,
    tenderTotals,
    orderCount: Number(orderRows[0]?.orderCount ?? 0),
    refundTotal: Number(cashRows[0]?.refundTotal ?? 0),
    cashIn: Number(cashRows[0]?.cashIn ?? 0),
    cashOut: Number(cashRows[0]?.cashOut ?? 0),
    zReportStatus: shift.status === "closed" ? "closed" as const : "open" as const,
  };
}

/** Lịch sử ca — mới nhất trước. */
export async function getShifts(limit = 50) {
  const u = alias(profiles, "shift_user");
  return db
    .select({
      id: shifts.id, code: shifts.code, openingFloat: shifts.openingFloat,
      openedAt: shifts.openedAt, closedAt: shifts.closedAt,
      expectedCash: shifts.expectedCash, countedCash: shifts.countedCash, variance: shifts.variance,
      status: shifts.status, userName: u.fullName,
    })
    .from(shifts)
    .leftJoin(u, eq(shifts.userId, u.id))
    .orderBy(desc(shifts.openedAt)).limit(limit);
}
export type ShiftRow = Awaited<ReturnType<typeof getShifts>>[number];
