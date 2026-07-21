import { permissionMatrixForRole } from "@/lib/auth/mobile-permissions";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate);

  return mobileOk({
    userId: gate.userId,
    role: gate.role,
    permissions: permissionMatrixForRole(gate.role),
  });
}
