import { updateSupplier } from "@/lib/actions/partners";
import { getSupplierPreview } from "@/lib/data/partners";
import { requireMobileManager, requireMobileStockAccess } from "@/lib/mobile/auth";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  const preview = await getSupplierPreview(id);
  if (!preview) return mobileError("errors.notFound", 404);
  return mobileOk(preview);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  return mobileAction(await updateSupplier({
    ...(body as Record<string, unknown>),
    id,
  } as Parameters<typeof updateSupplier>[0]));
}
