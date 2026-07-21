import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { addPaymentSchema, type AddPaymentInput } from "@/lib/schemas/order";
import { type ActionResult, getProfileId, UnauthorizedError } from "@/lib/actions/common";
import { Routes } from "@/lib/routes";
import { getCurrentShift } from "@/lib/data/shifts";
import { addManualPaymentCore } from "@/lib/orders/payment-core";

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
    const result = await addManualPaymentCore(db, v, {
      profileId,
      shiftId: currentShift?.id ?? null,
    });
    if (!result.ok) return result;

    revalidatePath(Routes.Orders);
    revalidatePath(Routes.order(v.orderId));
    revalidatePath(Routes.Customers);
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "errors.unauthorized" };
    console.error("addPayment failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
