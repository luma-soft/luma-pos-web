import { and, eq, isNull, sql } from "drizzle-orm";
import { customers, orders, payments } from "@/db/schema";
import { recordCashTx, fundForMethod } from "@/lib/cash";
import { addPaymentSchema, type AddPaymentInput } from "@/lib/schemas/order";

// Drizzle Postgres and PGlite expose the same runtime transaction API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

export type ManualPaymentCoreResult =
  | { ok: true; data: { replayed: boolean } }
  | { ok: false; error: string };

export async function addManualPaymentCore(
  database: DbLike,
  input: AddPaymentInput,
  actor: { profileId: string | null; shiftId: string | null },
): Promise<ManualPaymentCoreResult> {
  const parsed = addPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    return await database.transaction(async (tx: DbLike) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, value.orderId))
        .limit(1)
        .for("update");
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "completed" && order.status !== "returned") {
        throw new Error("ORDER_CANCELLED");
      }

      if (value.clientRequestId) {
        const [existing] = await tx
          .select({
            orderId: payments.orderId,
            amount: payments.amount,
            method: payments.method,
          })
          .from(payments)
          .where(
            and(
              isNull(payments.provider),
              eq(payments.clientRequestId, value.clientRequestId),
            ),
          )
          .limit(1);
        if (existing) {
          if (
            existing.orderId !== order.id ||
            existing.method !== value.method ||
            Math.abs(Number(existing.amount) - value.amount) > 1e-9
          ) {
            throw new Error("IDEMPOTENCY_CONFLICT");
          }
          return { ok: true as const, data: { replayed: true } };
        }
      }

      const total = Number(order.total);
      const alreadyPaid = Number(order.amountPaid);
      const remaining = Math.max(0, total - alreadyPaid);
      if (remaining <= 1e-9) throw new Error("NOTHING_TO_PAY");
      if (value.amount > remaining + 1e-9) {
        throw new Error("AMOUNT_EXCEEDS_REMAINING");
      }

      await tx.insert(payments).values({
        orderId: order.id,
        shiftId: actor.shiftId,
        amount: value.amount.toFixed(2),
        method: value.method,
        status: "manual_confirmed",
        clientRequestId: value.clientRequestId ?? null,
        reference: value.reference?.trim() || null,
        note: value.note?.trim() || null,
        createdBy: actor.profileId,
      });
      await recordCashTx(tx, {
        type: "in",
        fund: fundForMethod(value.method),
        amount: value.amount,
        category: "debt_collect",
        refType: "order",
        refId: order.id,
        note: `Thu nợ ${order.code}`,
        createdBy: actor.profileId,
        shiftId: actor.shiftId,
      });

      const newPaid = alreadyPaid + value.amount;
      await tx
        .update(orders)
        .set({
          amountPaid: newPaid.toFixed(2),
          paymentStatus: newPaid >= total - 1e-9 ? "paid" : "partial",
          updatedAt: sql`now()`,
        })
        .where(eq(orders.id, order.id));

      if (order.customerId) {
        await tx
          .update(customers)
          .set({
            currentDebt: sql`greatest(${customers.currentDebt} - ${value.amount.toFixed(2)}, 0)`,
          })
          .where(eq(customers.id, order.customerId));
      }
      return { ok: true as const, data: { replayed: false } };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known: Record<string, string> = {
      ORDER_NOT_FOUND: "errors.invalidData",
      ORDER_CANCELLED: "orders.errors.notPayable",
      NOTHING_TO_PAY: "orders.errors.nothingToPay",
      AMOUNT_EXCEEDS_REMAINING: "orders.errors.amountExceedsRemaining",
      IDEMPOTENCY_CONFLICT: "payments.errors.referenceConflict",
    };
    return { ok: false, error: known[message] ?? "errors.serverError" };
  }
}
