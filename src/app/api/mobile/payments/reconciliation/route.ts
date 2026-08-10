import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { writeAuditLog } from "@/lib/audit";
import { requireMobileManager } from "@/lib/mobile/auth";
import {
  expirePendingPayment,
  getPaymentReconciliation,
  getPaymentReconciliationEvent,
  reconcilePaymentWithEvent,
} from "@/lib/payments/service";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
  searchParam,
} from "@/lib/mobile/response";

const statuses = new Set([
  "actionable",
  "all",
  "pending",
  "expired",
  "failed",
  "confirmed",
  "reconciled",
]);
type ReconciliationStatus =
  | "actionable"
  | "all"
  | "pending"
  | "expired"
  | "failed"
  | "confirmed"
  | "reconciled";

export async function GET(request: Request) {
  const gate = await requireMobileManager();
  const eventId = searchParam(request, "eventId");
  if (eventId && (!gate.ok || !isMobileEntityId(eventId))) {
    return mobileError("errors.notFound", 404);
  }
  if (!gate.ok) return mobileGate(gate)!;
  if (eventId) {
    const result = await getPaymentReconciliationEvent(eventId);
    if (!result.ok) return mobileError(result.error, 503);
    if (!result.data) return mobileError("errors.notFound", 404);
    return mobileOk(result.data);
  }
  const requestedStatus = searchParam(request, "status") ?? "actionable";
  const status = (statuses.has(requestedStatus)
    ? requestedStatus
    : "actionable") as ReconciliationStatus;
  const result = await getPaymentReconciliation({
    status,
    limit: Number(searchParam(request, "limit") ?? 100),
  });
  return result.ok ? mobileOk(result.data) : mobileError(result.error);
}

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileError("errors.invalidData");
  const input = body as Record<string, unknown>;
  const action = input.action?.toString().trim();
  const paymentId = input.paymentId?.toString().trim() ?? "";
  const reason = input.reason?.toString().trim() ?? "";
  if (!paymentId || reason.length < 3) return mobileError("errors.invalidData");

  if (action === "expire") {
    const result = await expirePendingPayment(paymentId);
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "mobile",
      action: "expire_provider_payment",
      entityType: "payment",
      entityId: paymentId,
      status: result.ok ? "succeeded" : "failed",
      metadata: { reason: reason.slice(0, 240) },
    });
    return mobileAction(result);
  }

  const eventId = input.eventId?.toString().trim() ?? "";
  if (action !== "reconcile" || !eventId) {
    return mobileError("errors.invalidData");
  }
  const authorization = await authorizeMobileSensitiveAction({
    request,
    storeId: gate.storeId,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "payment.reconcile",
    scope: `payment:${paymentId}:event:${eventId}`,
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  const result = await reconcilePaymentWithEvent({
    paymentId,
    eventId,
    actorId: gate.userId,
  });
  await writeAuditLog({
    actorUserId: gate.userId,
    source: "mobile",
    action: "reconcile_provider_payment",
    entityType: "payment",
    entityId: paymentId,
    status: result.ok ? "succeeded" : "failed",
    affectedRecords: [{ type: "payment_webhook_event", id: eventId }],
    metadata: { reason: reason.slice(0, 240) },
  });
  return mobileAction(result);
}
