import { searchPosProductRows } from "@/lib/data/pos";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, searchParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const query = searchParam(request, "q", "") ?? "";
  return mobileOk(await searchPosProductRows(gate.storeId, query, { role: gate.role }));
}
