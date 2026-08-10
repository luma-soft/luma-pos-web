import { getReports } from "@/lib/data/reports";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, numberParam, searchParam } from "@/lib/mobile/response";

function daysForRange(request: Request) {
  const range = searchParam(request, "range", "month");
  if (range === "today") return 1;
  if (range === "week") return 7;
  if (range === "month") return 30;
  return numberParam(request, "days", 30);
}

export async function GET(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  return mobileOk(await getReports(gate.storeId, daysForRange(request)));
}
