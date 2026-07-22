import { getMobilePosData } from "@/lib/data/pos";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  try {
    return mobileOk(await getMobilePosData());
  } catch {
    return mobileError("errors.serverError", 503);
  }
}
