import {
  createPriceBook,
  deletePriceBook,
  renamePriceBook,
} from "@/lib/actions/price-books";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { getPriceBooks } from "@/lib/data/price-books";
import { requireMobileManager } from "@/lib/mobile/auth";
import { priceBookApprovalScope } from "@/lib/pricing/price-book-approval";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  return mobileOk(await getPriceBooks());
}

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  const name =
    body && typeof body === "object"
      ? String((body as { name?: unknown }).name ?? "")
      : "";
  if (!name.trim()) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "settings.sensitive",
    scope: priceBookApprovalScope({ action: "create" }),
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  return mobileAction(await createPriceBook(name));
}

export async function PATCH(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  const payload = body as { id?: unknown; name?: unknown; delete?: unknown };
  if (typeof payload.id !== "string") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  const action = payload.delete === true ? "delete" : "rename";
  const name = String(payload.name ?? "");
  if (action === "rename" && !name.trim()) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "settings.sensitive",
    scope: priceBookApprovalScope({ action, id: payload.id }),
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  if (action === "delete") {
    return mobileAction(await deletePriceBook(payload.id));
  }

  return mobileAction(await renamePriceBook(payload.id, name));
}
