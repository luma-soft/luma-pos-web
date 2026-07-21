import { addPaymentForUser } from "@/lib/orders/payment";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const payload = body as Record<string, unknown>;
  if (
    typeof payload.clientRequestId !== "string" ||
    payload.clientRequestId.trim().length < 8
  ) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  return mobileAction(
    await addPaymentForUser(gate.userId, {
      ...payload,
      orderId: id,
    } as Parameters<typeof addPaymentForUser>[1])
  );
}
