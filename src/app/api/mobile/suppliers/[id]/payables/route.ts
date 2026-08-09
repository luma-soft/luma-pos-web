import { getSupplierPayableOverview } from "@/lib/data/supplier-payables";
import { requireMobileManager, requireMobileStockAccess } from "@/lib/mobile/auth";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";
import {
  createSupplierPayableEntryForUser,
  paySupplierPayableForUser,
} from "@/lib/payables/service";
import type {
  PaySupplierInput,
  SupplierPayableEntryInput,
} from "@/lib/payables/service-core";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  const overview = await getSupplierPayableOverview(id);
  return overview ? mobileOk(overview) : mobileError("errors.notFound", 404);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;
  const { id: supplierId } = await params;
  if (!isMobileEntityId(supplierId)) return mobileError("errors.notFound", 404);
  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const payload = body as Record<string, unknown>;
  if (payload.action === "pay") {
    return mobileAction(await paySupplierPayableForUser(
      gate.userId,
      { ...payload, supplierId } as PaySupplierInput,
      "mobile",
    ));
  }
  if (payload.action === "entry") {
    return mobileAction(await createSupplierPayableEntryForUser(
      gate.userId,
      { ...payload, supplierId } as SupplierPayableEntryInput,
      "mobile",
    ));
  }
  return mobileAction({ ok: false, error: "errors.invalidData" });
}
