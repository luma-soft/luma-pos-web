import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate } from "@/lib/mobile/response";

// Staff PIN setup/reset is retired.
export async function PATCH() {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  return mobileError("errors.notFound", 404);
}
