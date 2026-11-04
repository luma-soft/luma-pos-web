import { getWalkInGrossProfit } from "@/lib/data/partners";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const search = new URL(request.url).searchParams;
  const grossProfit = await getWalkInGrossProfit(gate.storeId, {
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
  });
  return mobileOk({ grossProfit });
}
