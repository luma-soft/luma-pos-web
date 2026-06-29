import { cashTransactions } from "@/db/schema";
import { generateCode } from "@/lib/actions/common";

type Tx = { insert: (table: typeof cashTransactions) => { values: (v: typeof cashTransactions.$inferInsert) => Promise<unknown> } };

export type CashCategory = "sale" | "debt_collect" | "supplier_payment" | "refund" | "expense" | "other";

/** Ghi 1 dòng sổ quỹ trong transaction đang mở. */
export async function recordCashTx(
  tx: Tx,
  params: {
    type: "in" | "out";
    fund: "cash" | "bank";
    amount: number;
    category: CashCategory;
    refType?: string;
    refId?: string;
    note?: string;
    createdBy?: string | null;
    shiftId?: string | null;
  }
) {
  if (params.amount <= 0) return;
  await tx.insert(cashTransactions).values({
    code: generateCode(params.type === "in" ? "PT" : "PC"),
    shiftId: params.shiftId ?? null,
    type: params.type,
    fund: params.fund,
    amount: params.amount.toFixed(2),
    category: params.category,
    refType: params.refType ?? null,
    refId: params.refId ?? null,
    note: params.note ?? null,
    createdBy: params.createdBy ?? null,
  });
}

/** Map payment method → quỹ. */
export function fundForMethod(method: string): "cash" | "bank" {
  return method === "cash" ? "cash" : "bank";
}
