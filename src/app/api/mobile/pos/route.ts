import { getMobilePosData } from "@/lib/data/pos";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  if (gate.ok === false) return mobileGate(gate);

  try {
    return mobileOk(await getMobilePosData(gate.storeId, gate.role));
  } catch {
    return mobileError("errors.serverError", 503);
  }
}
