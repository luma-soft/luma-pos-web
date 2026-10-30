import { cancelCashTransactionForUser } from "@/lib/actions/cashbook";
import { requireMobileManager } from "@/lib/mobile/auth";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import { mobileAction, mobileError, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;
  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileAction({ ok: false, error: "errors.invalidData" });
  const payload = body as Record<string, unknown>;
  return mobileAction(await cancelCashTransactionForUser(gate.userId, {
    transactionId: id,
    reason: typeof payload.reason === "string" ? payload.reason : "",
  }));
}
