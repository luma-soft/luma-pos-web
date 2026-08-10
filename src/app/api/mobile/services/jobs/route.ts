import { createServiceJob } from "@/lib/actions/services";
import { getFieldServiceJobs } from "@/lib/data/service-field";
import { requireMobileServiceManager, requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, mobileOk, readJson, searchParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const requestedScope = searchParam(request, "scope", "today");
  const scope = requestedScope === "week" ? "week" : "today";
  return mobileOk({
    rows: await getFieldServiceJobs({
      actor: { userId: gate.userId, role: gate.role },
      scope,
    }),
    scope,
  });
}

export async function POST(request: Request) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileAction(await createServiceJob(body as Parameters<typeof createServiceJob>[0]));
}
