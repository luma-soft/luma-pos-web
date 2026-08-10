import { STAFF_ROLES, type Role } from "@/lib/auth/roles";
import {
  createStaffInvitation,
  listStaffInvitations,
  revokeStaffInvitation,
} from "@/lib/auth/staff-invitations";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  return mobileOk(await listStaffInvitations(gate.storeId));
}

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  const body = await readJson(request);
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const role = typeof payload.role === "string" ? payload.role : "";
  if (!STAFF_ROLES.includes(role as Role)) return mobileError("errors.invalidData");

  return mobileAction(await createStaffInvitation({
    storeId: gate.storeId,
    actorId: gate.userId,
    actorRole: gate.role,
    role: role as Role,
    email: typeof payload.email === "string" ? payload.email : null,
    phone: typeof payload.phone === "string" ? payload.phone : null,
  }));
}

export async function DELETE(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);
  const body = await readJson(request);
  const id = body && typeof body === "object" && "id" in body
    ? String(body.id).trim()
    : "";
  if (!id) return mobileError("errors.invalidData");
  return mobileAction(await revokeStaffInvitation(gate.storeId, id));
}
