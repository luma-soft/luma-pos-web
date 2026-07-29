import { getFieldServiceJobs } from "@/lib/data/service-field";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, searchParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const scope = searchParam(request, "scope") === "today" ? "today" : "week";
  const rows = await getFieldServiceJobs({
    actor: { userId: gate.userId, role: gate.role },
    scope,
  });
  return mobileOk({ rows, scope });
}
