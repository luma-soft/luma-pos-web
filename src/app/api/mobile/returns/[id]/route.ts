import { updateReturnMetadata } from "@/lib/actions/returns";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import { getReturn } from "@/lib/data/returns";
import { requireMobileManager, requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  const detail = await getReturn(gate.storeId, id);
  if (!detail) return mobileError("errors.notFound", 404);
  const manager = gate.role === "owner" || gate.role === "manager";
  return mobileOk({ ...detail,
    canEdit: manager && detail.status === "completed",
    canCancel: manager && detail.status === "completed" && !detail.exchangeOrderId,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;
  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return mobileError("errors.invalidData", 400);
  return mobileAction(await updateReturnMetadata(id, body as Parameters<typeof updateReturnMetadata>[1]));
}
