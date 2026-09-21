import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, readJson } from "@/lib/mobile/response";
import { confirmPaymentFromProvider } from "@/lib/payments/service";

/**
 * Explicit cashier confirmation for a VietQR payment.
 *
 * This is deliberately server-side: the app can request the action, but only
 * this transaction is allowed to mark the payment and finalize the draft order.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const paymentID = id?.trim();
  if (!paymentID) return mobileError("errors.invalidData");

  const [payment] = await db
    .select({ id: payments.id, provider: payments.provider, storeId: payments.storeId })
    .from(payments)
    .where(and(eq(payments.id, paymentID), eq(payments.storeId, gate.storeId)))
    .limit(1);
  if (!payment || payment.provider !== "sepay") return mobileError("errors.invalidData");

  const body = await readJson(request);
  const reason = body && typeof body === "object" && typeof (body as Record<string, unknown>).reason === "string"
    ? String((body as Record<string, unknown>).reason).trim().slice(0, 240)
    : "mobile_manual_confirmation";

  return mobileAction(await confirmPaymentFromProvider({
    paymentId: paymentID,
    source: "manual",
    actorId: gate.userId,
    reason: reason || "mobile_manual_confirmation",
  }));
}

