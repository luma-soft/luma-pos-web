import { and, eq } from "drizzle-orm";
import { cashTransactions } from "@/db/schema";
import { generateCode } from "@/lib/actions/common";

// Drizzle transaction and PGlite transaction APIs share this runtime surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

type CashTransaction = typeof cashTransactions.$inferSelect;

export async function reverseCashTransaction(
  tx: DbLike,
  input: {
    transaction: CashTransaction;
    actorId: string | null;
    shiftId: string | null;
    reason: string;
    referenceType: string;
    referenceId: string;
    reversedAt?: Date;
  },
) {
  const reversedAt = input.reversedAt ?? new Date();
  const [changed] = await tx
    .update(cashTransactions)
    .set({
      status: "cancelled",
      cancelledAt: reversedAt,
      cancelledBy: input.actorId,
      cancellationReason: input.reason,
    })
    .where(and(
      eq(cashTransactions.storeId, input.transaction.storeId),
      eq(cashTransactions.id, input.transaction.id),
      eq(cashTransactions.status, "confirmed"),
    ))
    .returning({ id: cashTransactions.id });
  if (!changed) throw new Error("CASH_TRANSACTION_ALREADY_CANCELLED");

  const reversalType = input.transaction.type === "in" ? "out" : "in";
  const [reversal] = await tx
    .insert(cashTransactions)
    .values({
      storeId: input.transaction.storeId,
      code: generateCode(reversalType === "in" ? "PT" : "PC"),
      shiftId: input.shiftId,
      type: reversalType,
      fund: input.transaction.fund,
      amount: input.transaction.amount,
      category: "cancellation",
      counterparty: input.transaction.counterparty,
      refType: input.referenceType,
      refId: input.referenceId,
      note: `Hủy ${input.transaction.code}: ${input.reason}`,
      createdBy: input.actorId,
      createdAt: reversedAt,
    })
    .returning({ id: cashTransactions.id, code: cashTransactions.code });

  return reversal;
}
