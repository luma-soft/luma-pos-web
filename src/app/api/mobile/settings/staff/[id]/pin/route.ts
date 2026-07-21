import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, profiles } from "@/db/schema";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { hashCashierPin, isValidCashierPin } from "@/lib/auth/cashier-pin";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { canResetStaffPin } from "@/lib/settings/staff-settings-mutation";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate);

  const { id } = await params;
  const body = await readJson(request);
  const pin = body && typeof body === "object" && "pin" in body
    ? String(body.pin).trim()
    : "";
  if (!isValidCashierPin(pin)) {
    return mobileError("errors.invalidData");
  }
  const [target] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1);
  if (!target) return mobileError("errors.notFound", 404);
  if (!canResetStaffPin({ actorRole: gate.role, targetRole: target.role })) {
    return mobileError("errors.forbidden", 403);
  }

  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "settings.sensitive",
    scope: `settings:staff-pin:${id}`,
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  const [updated] = await db
    .update(profiles)
    .set({
      cashierPinHash: hashCashierPin(pin),
      cashierPinFailedAttempts: 0,
      cashierPinLockedUntil: null,
      cashierPinUpdatedAt: new Date(),
    })
    .where(eq(profiles.id, id))
    .returning({ id: profiles.id, fullName: profiles.fullName });
  if (!updated) return mobileError("errors.notFound", 404);

  await db.insert(auditLogs).values({
    actorId: gate.userId,
    source: "mobile",
    action: "settings.cashier_pin_updated",
    entityType: "profile",
    entityId: updated.id,
    status: "succeeded",
    metadata: { targetName: updated.fullName },
  });
  return mobileOk({ id: updated.id, pinConfigured: true });
}
