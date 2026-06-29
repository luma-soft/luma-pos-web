import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments, customers } from "@/db/schema";
import { addPaymentSchema, type AddPaymentInput } from "@/lib/schemas/order";
import { type ActionResult, getProfileId, toMoney, UnauthorizedError } from "@/lib/actions/common";
import { recordCashTx, fundForMethod } from "@/lib/cash";
import { Routes } from "@/lib/routes";
import { getCurrentShift } from "@/lib/data/shifts";

/**
 * Lõi THU NỢ / thu tiền theo đơn — KHÔNG phải server action (nhận userId đã xác thực).
 * Dùng bởi server action addPayment (web).
 * Ghi payment + cash-in (category debt_collect) + giảm công nợ khách + cập nhật trạng thái đơn.
 */
export async function addPaymentForUser(userId: string, input: AddPaymentInput): Promise<ActionResult> {
  const parsed = addPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(profileId) : null;

    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, v.orderId)).limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "completed" && order.status !== "returned") throw new Error("ORDER_CANCELLED");

      const total = Number(order.total);
      const alreadyPaid = Number(order.amountPaid);
      const remaining = total - alreadyPaid;
      const amount = Math.min(v.amount, Math.max(0, remaining));
      if (amount <= 0) throw new Error("NOTHING_TO_PAY");

      await tx.insert(payments).values({
        orderId: order.id,
        shiftId: currentShift?.id ?? null,
        amount: toMoney(amount),
        method: v.method,
        reference: v.reference?.trim() || null,
        note: v.note || null,
        createdBy: profileId,
      });
      await recordCashTx(tx, {
        type: "in", fund: fundForMethod(v.method), amount,
        category: "debt_collect", refType: "order", refId: order.id,
        note: `Thu nợ ${order.code}`, createdBy: profileId, shiftId: currentShift?.id ?? null,
      });

      const newPaid = alreadyPaid + amount;
      await tx.update(orders).set({
        amountPaid: toMoney(newPaid),
        paymentStatus: newPaid >= total ? "paid" : "partial",
        updatedAt: sql`now()`,
      }).where(eq(orders.id, order.id));

      if (order.customerId) {
        await tx.update(customers).set({
          currentDebt: sql`greatest(${customers.currentDebt} - ${toMoney(amount)}, 0)`,
        }).where(eq(customers.id, order.customerId));
      }
    });

    revalidatePath(Routes.Orders);
    revalidatePath(Routes.order(v.orderId));
    revalidatePath(Routes.Customers);
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "errors.unauthorized" };
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOTHING_TO_PAY") return { ok: false, error: "orders.errors.nothingToPay" };
    console.error("addPayment failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
