import { createServiceProject } from "@/lib/actions/services";
import { getServiceDashboard } from "@/lib/data/services";
import { requireMobileServiceManager, requireMobileServiceSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileServiceSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;
  return mobileOk({ rows: (await getServiceDashboard(gate.storeId)).projects });
}

export async function POST(request: Request) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileAction(await createServiceProject(body as Parameters<typeof createServiceProject>[0]));
}
