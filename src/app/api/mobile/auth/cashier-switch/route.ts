import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate } from "@/lib/mobile/response";

// No new cashier/PIN contexts. Historical offline/audit identities remain.
export async function POST() {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate);
  return mobileError("errors.notFound", 404);
}
