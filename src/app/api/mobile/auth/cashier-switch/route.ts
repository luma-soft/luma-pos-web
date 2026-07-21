import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import {
  cashierContextSecret,
  createCashierContextToken,
} from "@/lib/auth/cashier-pin";
import { verifyStaffPin } from "@/lib/auth/staff-pin-verifier";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import {
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

const CASHIER_CONTEXT_TTL_MS = 8 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate);

  const body = await readJson(request);
  const staffId = body && typeof body === "object" && "staffId" in body
    ? String(body.staffId).trim()
    : "";
  const pin = body && typeof body === "object" && "pin" in body
    ? String(body.pin).trim()
    : "";
  const verification = await verifyStaffPin(staffId, pin);
  if (!verification.ok) {
    if (verification.staff) {
      await db.insert(auditLogs).values({
        actorId: verification.staff.id,
        actorNameSnapshot: verification.staff.fullName,
        source: "mobile",
        action: "auth.cashier_pin_failed",
        entityType: "profile",
        entityId: verification.staff.id,
        status: "unauthorized",
        metadata: {
          principalId: gate.principalId,
          failedAttempts: verification.failedAttempts,
        },
      });
    }
    return mobileError(verification.error, verification.status);
  }
  const staff = verification.staff;
  if (staff.role === "warehouse") {
    return mobileError("errors.unauthorized", 401);
  }

  try {
    const principalId = gate.principalId ?? gate.userId;
    const issuedAt = Date.now();
    const token = createCashierContextToken(
      { principalId, cashierId: staff.id, role: staff.role },
      {
        secret: cashierContextSecret(),
        nowMs: issuedAt,
        ttlMs: CASHIER_CONTEXT_TTL_MS,
      },
    );
    const expiresAt = issuedAt + CASHIER_CONTEXT_TTL_MS;
    await db.insert(auditLogs).values({
      actorId: staff.id,
      actorNameSnapshot: staff.fullName,
      source: "mobile",
      action: "auth.cashier_switch",
      entityType: "profile",
      entityId: staff.id,
      status: "succeeded",
      metadata: { principalId },
    });
    return mobileOk({
      token,
      staffId: staff.id,
      fullName: staff.fullName,
      role: staff.role,
      expiresAt,
    });
  } catch (error) {
    console.error("cashier switch token failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
