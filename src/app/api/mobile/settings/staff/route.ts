import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

// Retired interface: preserve an empty read shape for older mobile builds.
export async function GET() {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  return mobileOk([]);
}

export async function PATCH() {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  return mobileError("errors.notFound", 404);
}
