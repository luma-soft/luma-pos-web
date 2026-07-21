import { issueEInvoiceForUser } from "@/lib/actions/einvoice";
import { requireMobileManager } from "@/lib/mobile/auth";
import {
  OFFLINE_ACTOR_HEADER,
  validateOfflineReplayActor,
} from "@/lib/mobile/offline-actor";
import {
  mobileAction,
  mobileError,
  mobileGate,
  readJson,
} from "@/lib/mobile/response";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;
  if (
    !validateOfflineReplayActor({
      header: request.headers.get(OFFLINE_ACTOR_HEADER),
      principalId: gate.principalId ?? gate.userId,
      actorId: gate.userId,
    })
  ) {
    return mobileError("offline.actorMismatch", 403);
  }

  const { id } = await params;
  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  return mobileAction(
    await issueEInvoiceForUser({
      ...(body as Record<string, unknown>),
      orderId: id,
    } as Parameters<typeof issueEInvoiceForUser>[0])
  );
}
