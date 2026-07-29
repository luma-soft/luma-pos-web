import { db } from "@/db";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { getWarrantyClaimForActorCore } from "@/lib/services/technician-warranty";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { id } = await params;
  const claim = await db.transaction((tx) => getWarrantyClaimForActorCore(tx, {
    actorId: gate.userId,
    role: gate.role,
    claimId: id,
  }));
  return claim ? mobileOk(claim) : mobileError("errors.notFound", 404);
}
