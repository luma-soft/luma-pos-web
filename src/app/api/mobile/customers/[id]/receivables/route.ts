import { requireMobileManager, requireMobileSalesAccess } from "@/lib/mobile/auth";
import { getCustomerReceivableOverview } from "@/lib/data/customer-receivables";
import { mobileAction, mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import {
  cancelCustomerReceivableForUser,
  collectCustomerReceivableForUser,
  createCustomerReceivableEntryForUser,
} from "@/lib/receivables/service";
import type { CollectReceivableInput, ReceivableEntryInput } from "@/lib/receivables/service-core";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;
  const { id: customerId } = await params;
  const overview = await getCustomerReceivableOverview(gate.storeId, customerId);
  return overview ? mobileOk(overview) : mobileError("errors.notFound", 404);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await params;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileAction({ ok: false, error: "errors.invalidData" });
  const payload = body as Record<string, unknown>;
  const action = payload.action;

  if (action === "collect") {
    const gate = await requireMobileSalesAccess();
    if (!gate.ok) return mobileGate(gate)!;
    const result = await collectCustomerReceivableForUser(gate.userId, {
      ...payload,
      customerId,
    } as CollectReceivableInput);
    if (!result.ok) {
      console.warn("Mobile customer receivable collection rejected", { error: result.error });
    }
    return mobileAction(result);
  }
  if (action === "entry") {
    const gate = await requireMobileManager();
    if (!gate.ok) return mobileGate(gate)!;
    return mobileAction(await createCustomerReceivableEntryForUser(gate.userId, {
      ...payload,
      customerId,
    } as ReceivableEntryInput));
  }
  if (action === "cancel") {
    const gate = await requireMobileManager();
    if (!gate.ok) return mobileGate(gate)!;
    return mobileAction(await cancelCustomerReceivableForUser(gate.userId, {
      receiptId: typeof payload.receiptId === "string" ? payload.receiptId : "",
      customerId,
      reason: typeof payload.reason === "string" ? payload.reason : "",
    }));
  }
  return mobileAction({ ok: false, error: "errors.invalidData" });
}
