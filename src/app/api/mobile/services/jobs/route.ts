import { createServiceJob } from "@/lib/actions/services";
import { getServiceDashboard } from "@/lib/data/services";
import { requireMobileManager, requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  return mobileOk({ rows: (await getServiceDashboard()).jobs });
}

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileAction(await createServiceJob(body as Parameters<typeof createServiceJob>[0]));
}
