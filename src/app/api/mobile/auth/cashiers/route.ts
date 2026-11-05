import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";

// Older mobile builds call this at bootstrap. Preserve an empty response shape.
export async function GET() {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate);
  return mobileOk([]);
}
