import { getMobilePosData } from "@/lib/data/pos";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, searchParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (gate.ok === false) return mobileGate(gate);

  try {
    const includeProducts = searchParam(request, "includeProducts") !== "false";
    const includeProductIds = (searchParam(request, "includeProductIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 100);
    return mobileOk(await getMobilePosData(gate.storeId, gate.role, {
      includeProducts,
      includeProductIds,
    }));
  } catch {
    return mobileError("errors.serverError", 503);
  }
}
