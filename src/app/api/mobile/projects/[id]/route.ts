import { updateProject } from "@/lib/actions/extras";
import { getProjectDetail } from "@/lib/data/projects";
import { getServiceFormOptions } from "@/lib/data/services";
import { requireMobileManager, requireMobileUser } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { storeFeatureEnabled } from "@/lib/tenancy/store-features";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileUser();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const detail = await getProjectDetail(gate.storeId, id);
  if (!detail) return mobileError("errors.notFound", 404);
  if (detail.project.serviceType) {
    if (
      !storeFeatureEnabled(gate.features, "field_services")
      || !["owner", "manager", "technician"].includes(gate.role)
    ) return mobileError("errors.forbidden", 403);
  } else if (!["owner", "manager", "cashier"].includes(gate.role)) {
    return mobileError("errors.forbidden", 403);
  }
  if (detail.project.serviceType) {
    const options = await getServiceFormOptions(gate.storeId);
    return mobileOk({
      ...detail,
      installationOptions: { warehouses: options.warehouseOptions },
    });
  }
  return mobileOk(detail);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  return mobileAction(await updateProject({ ...(body as Record<string, unknown>), id } as Parameters<typeof updateProject>[0]));
}
