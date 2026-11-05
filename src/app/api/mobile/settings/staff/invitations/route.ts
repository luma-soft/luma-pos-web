import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

// Legacy invitation records are retained for audit, not future provisioning.
export async function GET() {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  return mobileOk([]);
}

export async function POST() {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  return mobileError("errors.notFound", 404);
}

export async function DELETE() {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  return mobileError("errors.notFound", 404);
}
