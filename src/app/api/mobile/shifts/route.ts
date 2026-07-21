import { getShiftHistoryWithSummaries } from "@/lib/data/shifts";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, numberParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const limit = Math.min(50, Math.max(1, numberParam(request, "limit", 30)));
  return mobileOk({ rows: await getShiftHistoryWithSummaries(limit) });
}
