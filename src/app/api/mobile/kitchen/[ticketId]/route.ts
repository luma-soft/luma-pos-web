import { serveTicketForUser, setTicketItemStatusForUser } from "@/lib/actions/kitchen";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { ticketId } = await params;
  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  const payload = body as {
    itemId?: unknown;
    scope?: unknown;
    status?: unknown;
  };
  if (payload.scope === "ticket" || payload.status === "servedAll") {
    return mobileAction(await serveTicketForUser(ticketId));
  }

  const status =
    payload.status === "preparing"
      ? "preparing"
      : payload.status === "ready"
        ? "ready"
        : payload.status === "served"
          ? "served"
          : "pending";
  const itemId =
    typeof payload.itemId === "string" ? payload.itemId : ticketId;

  return mobileAction(await setTicketItemStatusForUser(itemId, status));
}
