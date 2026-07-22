import { releaseServiceJobMaterialReservations } from "@/lib/actions/services";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const body = await readJson(request);
  const materialId = body && typeof body === "object" && "materialId" in body && typeof body.materialId === "string" ? body.materialId : "";
  if (!materialId) return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileAction(await releaseServiceJobMaterialReservations(materialId));
}
